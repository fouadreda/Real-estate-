import { runMonthlyReport, siteUrl } from "@/lib/monthlyReport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called by Vercel Cron on the 1st of each month (vercel.json). Vercel sends the CRON_SECRET set in the
 * project as "Authorization: Bearer <secret>"; anything else is refused, so nobody else can trigger it.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runMonthlyReport({ baseUrl: siteUrl(new URL(request.url).origin) });
  if (result.status === "failed" || result.status === "sent") {
    // the server log shows who received it (never the email content or any key)
    console.log("[monthly-report]", result.status, result.monthKey, result.results.map((r) => `${r.email}:${r.ok ? "ok" : r.error}`).join(" "));
  }
  return Response.json(result, { status: result.status === "failed" ? 502 : 200 });
}
