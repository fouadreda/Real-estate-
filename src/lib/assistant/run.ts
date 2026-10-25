import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { Language, Role } from "@prisma/client";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/assistant/prompt";
import { ASSISTANT_TOOLS, ToolInputError, runAssistantTool } from "@/lib/assistant/tools";

export const ASSISTANT_MODEL = "claude-opus-5-5";

/** Model calls allowed for one question (each tool round is one call). */
const MAX_STEPS = 10;
/** No new model call is started after this long. */
const TIME_BUDGET_MS = 240_000;
/** A call still running at this point is stopped, so the answer ends before the server's 300 s limit with a clear message. */
const DEADLINE_MS = 285_000;
/**
 * Past this many prompt tokens the conversation is full: the answer is kept, then the person is asked
 * to start a new conversation. Keeps each question's cost reasonable and stays far from the model's limit.
 */
const CONVERSATION_TOKEN_LIMIT = 250_000;

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

export type AssistantErrorCode =
  | "auth"
  | "billing"
  | "rate"
  | "overloaded"
  | "network"
  | "timeout"
  | "conversation_too_long"
  | "request"
  | "too_long"
  | "internal";

/** What the browser receives, one JSON object per line. */
export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  /** The model call that just streamed is being redone: drop the text it showed. */
  | { type: "step_discard" }
  /** One model call finished; the next one's text starts a new paragraph. */
  | { type: "step_end" }
  /** `full`: the conversation reached its size limit; the next question needs a new conversation. */
  | { type: "done"; history: MessageParam[]; note?: "truncated" | "too_many_steps"; full?: boolean; signature?: string }
  /** Declined by Claude's safeguards (after the automatic retry on another model): nothing is kept. */
  | { type: "refusal" }
  | { type: "error"; code: AssistantErrorCode; detail?: string };

export function assistantConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** The line added in front of every question: today's date and who is asking (kept out of the system prompt so it stays cached). */
function contextLine(user: { name: string; role: Role; language: Language }, now: Date): string {
  const french = user.language === "FR";
  const today = new Intl.DateTimeFormat(french ? "fr-FR" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
  const role = user.role === "ADMIN" ? (french ? "administrateur" : "administrator") : french ? "gestionnaire" : "manager";
  return french
    ? `[Contexte] Aujourd'hui : ${today} (${now.toISOString().slice(0, 10)}). Demandé par : ${user.name} (${role}). Langue de l'application : français.`
    : `[Context] Today: ${today} (${now.toISOString().slice(0, 10)}). Asked by: ${user.name} (${role}). App language: English.`;
}

/**
 * After a mid-answer switch to a fallback model, the content before the last `fallback` marker came
 * from the declined attempt: only its text is kept (the API's rule for echoing such turns back).
 */
function keptContent(content: ContentBlock[]): ContentBlock[] {
  const lastFallback = content.map((block) => block.type).lastIndexOf("fallback");
  return content.filter((block, index) => block.type !== "fallback" && (index > lastFallback || block.type === "text"));
}

/** The API's own explanation (the inner `error.message`), rather than the raw JSON body. */
function apiMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const inner = body?.error?.message;
  return (typeof inner === "string" && inner ? inner : err.message).slice(0, 300);
}

/** Overloaded or a server-side hiccup: worth one more try. */
function isTransient(err: unknown): boolean {
  return (
    err instanceof Anthropic.InternalServerError ||
    (err instanceof Anthropic.APIError && (err.type === "overloaded_error" || err.type === "api_error" || err.type === "timeout_error"))
  );
}

function errorEvent(err: unknown): AssistantEvent {
  if (!(err instanceof Anthropic.APIError)) return { type: "error", code: "internal" };
  // the type comes from the API's error body, so errors that arrive mid-stream are recognised too
  if (err instanceof Anthropic.APIConnectionError) return { type: "error", code: "network" };
  if (err.type === "billing_error") return { type: "error", code: "billing" };
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError ||
    err.type === "authentication_error" ||
    err.type === "permission_error"
  ) {
    return { type: "error", code: "auth" };
  }
  if (err instanceof Anthropic.RateLimitError || err.type === "rate_limit_error") return { type: "error", code: "rate" };
  if (isTransient(err)) return { type: "error", code: "overloaded" };
  const detail = apiMessage(err);
  // a request that is too big has no error type of its own: it is an invalid_request_error that says so
  if (err.status === 413 || (err instanceof Anthropic.BadRequestError && /prompt is too long|context window/i.test(detail))) {
    return { type: "error", code: "conversation_too_long" };
  }
  return { type: "error", code: "request", detail };
}

/**
 * Answers one question. The conversation so far (`history`, exactly as returned by the previous
 * answer) is only ever appended to, never rewritten, so Claude's earlier reasoning stays valid and
 * the prompt cache keeps working. The updated history is sent back in the `done` event.
 */
export async function runAssistantTurn(opts: {
  history: MessageParam[];
  question: string;
  user: { name: string; role: Role; language: Language };
  signal: AbortSignal;
  emit: (event: AssistantEvent) => void;
}): Promise<void> {
  const { question, user, emit } = opts;
  const started = Date.now();
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  // stops the call in flight when the person presses Stop or leaves, or when the time is up
  const signal = AbortSignal.any([opts.signal, deadline]);
  const client = new Anthropic({ maxRetries: 1 });
  const messages: MessageParam[] = [
    ...opts.history,
    {
      role: "user",
      content: [
        { type: "text", text: contextLine(user, new Date()) },
        { type: "text", text: question },
      ],
    },
  ];

  let jsonRetries = 0;
  let transientRetries = 0;
  let promptTokens = 0;
  try {
    for (let step = 0; ; step++) {
      // only a redone call (or a paused one) gets here late: a finished tool round ends the answer itself below
      if (step > 0 && Date.now() - started > TIME_BUDGET_MS) {
        emit({ type: "error", code: "timeout" });
        return;
      }
      const stream = client.beta.messages.stream(
        {
          model: ASSISTANT_MODEL,
          max_tokens: 32000,
          system: ASSISTANT_SYSTEM_PROMPT,
          tools: ASSISTANT_TOOLS,
          messages,
          // caches everything up to the newest message for an hour, so each step and each follow-up question re-reads it cheaply
          cache_control: { type: "ephemeral", ttl: "1h" },
          output_config: { effort: "medium" },
          // if an earlier turn ever comes back altered, its old reasoning is dropped instead of failing the request
          thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
          // a request declined by Claude's safeguards is retried once on Anthropic's recommended fallback model
          fallbacks: "default",
          betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
        },
        { signal },
      );

      let message: Anthropic.Beta.BetaMessage;
      try {
        for await (const event of stream) {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            emit({ type: "tool", name: event.content_block.name });
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            emit({ type: "text", text: event.delta.text });
          }
        }
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (signal.aborted) throw err;
        // an overload or server hiccup in the middle of an answer: try that call once more
        if (isTransient(err) && transientRetries++ < 1) {
          emit({ type: "step_discard" });
          continue;
        }
        // with eager input streaming a tool input can arrive as JSON that does not parse: redo that call (twice at most)
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        emit({ type: "step_discard" });
        continue;
      }

      const usage = message.usage;
      promptTokens = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      const dropped = (message.input_transformations ?? []).filter(
        (t) => t.type === "thinking_dropped" && "reason" in t && t.reason === "prefix_binding_mismatch",
      );
      if (dropped.length > 0) console.warn("assistant: earlier reasoning dropped, history changed", dropped);

      if (message.stop_reason === "refusal") {
        emit({ type: "refusal" });
        return;
      }
      if (message.stop_reason === "model_context_window_exceeded") {
        emit({ type: "error", code: "conversation_too_long" });
        return;
      }

      const content = keptContent(message.content);
      const toolUses = content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (message.stop_reason === "max_tokens" && toolUses.length > 0) {
        emit({ type: "error", code: "too_long" });
        return;
      }

      messages.push({ role: "assistant", content });
      emit({ type: "step_end" });
      const full = promptTokens > CONVERSATION_TOKEN_LIMIT || undefined;

      if (message.stop_reason === "pause_turn") continue;
      if (toolUses.length === 0) {
        emit({ type: "done", history: messages, full, ...(message.stop_reason === "max_tokens" ? { note: "truncated" as const } : {}) });
        return;
      }

      const results = await Promise.all(
        toolUses.map(async (tool): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          try {
            return { type: "tool_result", tool_use_id: tool.id, content: await runAssistantTool(tool.name, tool.input) };
          } catch (err) {
            if (!(err instanceof ToolInputError)) console.error("assistant tool failed", tool.name, err);
            const text = err instanceof ToolInputError ? err.message : "The tool failed on the server. Try again or answer without it.";
            return { type: "tool_result", tool_use_id: tool.id, content: text, is_error: true };
          }
        }),
      );
      messages.push({ role: "user", content: results });

      if (step + 1 >= MAX_STEPS || Date.now() - started > TIME_BUDGET_MS) {
        emit({ type: "done", history: messages, note: "too_many_steps", full });
        return;
      }
    }
  } catch (err) {
    if (opts.signal.aborted) return; // the person pressed Stop or left: nobody is listening
    if (deadline.aborted) {
      emit({ type: "error", code: "timeout" });
      return;
    }
    if (!(err instanceof Anthropic.APIError)) console.error("assistant failed", err);
    emit(errorEvent(err));
  }
}
