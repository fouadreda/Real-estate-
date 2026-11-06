import "server-only";

/**
 * Sends one email through Brevo's transactional API (https://developers.brevo.com/reference/sendtransacemail).
 * Set in Vercel: BREVO_API_KEY, and EMAIL_FROM = the sender address verified in Brevo
 * (optionally EMAIL_FROM_NAME). Nothing is sent while they are missing.
 */
const BREVO_URL = process.env.BREVO_API_URL || "https://api.brevo.com/v3/smtp/email";
/** Well under the cron route's time limit: a stalled service is a failed send, not a killed run. */
const SEND_TIMEOUT_MS = 15_000;

export type EmailMessage = { to: { email: string; name?: string }; subject: string; html: string; text: string };

/** The settings that are still missing for sending emails (names only, never values). */
export function missingEmailSettings(): string[] {
  return ["BREVO_API_KEY", "EMAIL_FROM"].filter((name) => !process.env[name]?.trim());
}

export async function sendEmail(message: EmailMessage): Promise<{ ok: true } | { ok: false; error: string }> {
  const missing = missingEmailSettings();
  if (missing.length > 0) return { ok: false, error: `missing ${missing.join(", ")}` };
  try {
    const response = await fetch(BREVO_URL, {
      method: "POST",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: { "api-key": process.env.BREVO_API_KEY!.trim(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: process.env.EMAIL_FROM!.trim(), name: process.env.EMAIL_FROM_NAME?.trim() || "Les Cocotiers" },
        to: [message.to],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
    });
    if (response.ok) return { ok: true };
    // Brevo answers {code, message}; only those are kept (never the request, which holds the key)
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    return { ok: false, error: `${response.status} ${body?.code ?? ""} ${body?.message ?? ""}`.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}
