import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { Language, Role } from "@prisma/client";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/assistant/prompt";
import { ASSISTANT_TOOLS, ToolInputError, runAssistantTool } from "@/lib/assistant/tools";

export const ASSISTANT_MODEL = "claude-opus-5-5";

/** Model calls allowed for one question (each tool round is one call). */
const MAX_STEPS = 10;
/** No new model call is started after this long, so the answer ends before the server time limit. */
const TIME_BUDGET_MS = 240_000;

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

/** What the browser receives, one JSON object per line. */
export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  /** The model call that just streamed is being redone: drop the text it showed. */
  | { type: "step_discard" }
  /** One model call finished; the next one's text starts a new paragraph. */
  | { type: "step_end" }
  | { type: "done"; history: MessageParam[]; note?: "truncated" | "too_many_steps" }
  /** Declined by Claude's safeguards (after the automatic retry on another model): nothing is kept. */
  | { type: "refusal" }
  | { type: "error"; code: "auth" | "rate" | "overloaded" | "request" | "too_long" | "internal"; detail?: string };

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

function errorEvent(err: unknown): AssistantEvent {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { type: "error", code: "auth" };
  }
  if (err instanceof Anthropic.RateLimitError) return { type: "error", code: "rate" };
  if (err instanceof Anthropic.InternalServerError) return { type: "error", code: "overloaded" };
  if (err instanceof Anthropic.APIError) return { type: "error", code: "request", detail: err.message.slice(0, 400) };
  return { type: "error", code: "internal" };
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
  const { question, user, signal, emit } = opts;
  const started = Date.now();
  const client = new Anthropic();
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
  try {
    for (let step = 0; ; step++) {
      const stream = client.beta.messages.stream(
        {
          model: ASSISTANT_MODEL,
          max_tokens: 32000,
          system: ASSISTANT_SYSTEM_PROMPT,
          tools: ASSISTANT_TOOLS,
          messages,
          // caches everything up to the newest message, so each step and each follow-up question re-reads it cheaply
          cache_control: { type: "ephemeral" },
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
        // with eager input streaming a tool input can arrive as JSON that does not parse: redo that call (twice at most)
        if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err;
        emit({ type: "step_discard" });
        continue;
      }

      const dropped = (message.input_transformations ?? []).filter(
        (t) => t.type === "thinking_dropped" && "reason" in t && t.reason === "prefix_binding_mismatch",
      );
      if (dropped.length > 0) console.warn("assistant: earlier reasoning dropped, history changed", dropped);

      if (message.stop_reason === "refusal") {
        emit({ type: "refusal" });
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

      if (message.stop_reason === "pause_turn") continue;
      if (toolUses.length === 0) {
        emit({ type: "done", history: messages, ...(message.stop_reason === "max_tokens" ? { note: "truncated" as const } : {}) });
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
        emit({ type: "done", history: messages, note: "too_many_steps" });
        return;
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    if (!(err instanceof Anthropic.APIError)) console.error("assistant failed", err);
    emit(errorEvent(err));
  }
}
