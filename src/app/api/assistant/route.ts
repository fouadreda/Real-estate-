import { createHash, createHmac, timingSafeEqual } from "crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { getCurrentUser } from "@/lib/auth";
import { assistantConfigured, runAssistantTurn, type AssistantEvent } from "@/lib/assistant/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// a question that needs several look-ups can take a minute or two
export const maxDuration = 300;

const MAX_QUESTION_CHARS = 4000;
/** Past this the conversation is too long to send back each time: the person starts a new one. */
const MAX_HISTORY_BYTES = 800_000;

function json(status: number, body: object) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** The conversation comes back from the browser as it was handed out; only its outline is checked here (the signature covers the rest). */
function isHistory(value: unknown): value is Anthropic.Beta.BetaMessageParam[] {
  return (
    Array.isArray(value) &&
    value.every(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m.role === "user" || m.role === "assistant") &&
        (typeof m.content === "string" || Array.isArray(m.content)),
    ) &&
    (value.length === 0 || value[0].role === "user")
  );
}

/**
 * Signs a conversation for the person it belongs to. The browser keeps the conversation and sends it
 * back with each question; only one this server handed to this person is accepted, so nobody can slip
 * in made-up answers or tool results, or carry on someone else's conversation. The key is derived from
 * the Anthropic key (server-only), so changing that key simply starts conversations afresh.
 */
function signature(userId: string, history: unknown[]): string {
  const key = createHash("sha256").update(`cocotiers-assistant-history:${process.env.ANTHROPIC_API_KEY ?? ""}`).digest();
  return createHmac("sha256", key).update(`${userId}\n${JSON.stringify(history)}`).digest("hex");
}

function signatureMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string" || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json(401, { error: "signedOut" });

  // only the app's own pages may call this (the session cookie is not sent cross-site for POST anyway)
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return json(403, { error: "forbidden" });

  if (!assistantConfigured()) return json(503, { error: "notConfigured" });

  const raw = await request.text();
  if (raw.length > MAX_HISTORY_BYTES) return json(413, { error: "tooLong" });
  let body: { history?: unknown; question?: unknown; signature?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "badRequest" });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const history = body.history ?? [];
  if (!question || question.length > MAX_QUESTION_CHARS || !isHistory(history)) return json(400, { error: "badRequest" });
  if (history.length > 0 && !signatureMatches(signature(user.id, history), body.signature)) {
    return json(409, { error: "invalidConversation" });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AssistantEvent) => {
        if (request.signal.aborted) return;
        const sent = event.type === "done" ? { ...event, signature: signature(user.id, event.history) } : event;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(sent)}\n`));
        } catch {
          // the browser went away mid-answer
        }
      };
      await runAssistantTurn({
        history,
        question,
        user: { name: user.name, role: user.role, language: user.language },
        signal: request.signal,
        emit,
      });
      try {
        controller.close();
      } catch {
        // the browser already went away
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
