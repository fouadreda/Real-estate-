import type Anthropic from "@anthropic-ai/sdk";
import { getCurrentUser } from "@/lib/auth";
import { assistantConfigured, runAssistantTurn, type AssistantEvent } from "@/lib/assistant/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// a question that needs several look-ups can take a minute or two
export const maxDuration = 300;

const MAX_QUESTION_CHARS = 4000;
/** Past this the conversation is too long to send back each time: the person starts a new one. */
const MAX_HISTORY_BYTES = 3_000_000;

function json(status: number, body: object) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** The conversation comes back from the browser as it was handed out; only its outline is checked here (Claude's API checks the rest). */
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

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json(401, { error: "signedOut" });

  // only the app's own pages may call this (the session cookie is not sent cross-site for POST anyway)
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return json(403, { error: "forbidden" });

  if (!assistantConfigured()) return json(503, { error: "notConfigured" });

  const raw = await request.text();
  if (raw.length > MAX_HISTORY_BYTES) return json(413, { error: "tooLong" });
  let body: { history?: unknown; question?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "badRequest" });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const history = body.history ?? [];
  if (!question || question.length > MAX_QUESTION_CHARS || !isHistory(history)) return json(400, { error: "badRequest" });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AssistantEvent) => {
        if (request.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
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
