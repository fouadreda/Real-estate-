"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { sendMonthlyReport, siteUrl } from "@/lib/monthlyReport";

const PAGE = "/settings/monthly-report";

/** Administrators send the monthly report to themselves only, to check it before the 1st. */
export async function sendMonthlyReportTest() {
  const admin = await requireAdmin();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost:3000"}`;
  const { results } = await sendMonthlyReport({ baseUrl: siteUrl(origin), onlyUserId: admin.id, test: true });
  const result = results[0];
  if (result?.ok) redirect(`${PAGE}?test=sent`);
  console.error("[monthly-report test]", result?.error);
  // only a short code goes in the address (e.g. "missing", "401"), never the provider's full message
  const reason = result?.error?.startsWith("missing") ? "missing" : (result?.error?.match(/^\d{3}/)?.[0] ?? "error");
  redirect(`${PAGE}?test=failed&reason=${reason}`);
}
