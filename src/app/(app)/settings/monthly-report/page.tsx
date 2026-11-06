import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUserWithDictionary } from "@/lib/auth";
import { missingEmailSettings } from "@/lib/email";
import { buildMonthlyReport, renderMonthlyEmail, sentMonths, siteUrl } from "@/lib/monthlyReport";
import { sendMonthlyReportTest } from "@/lib/actions/monthlyReport";
import { formatDate } from "@/lib/format";
import SubmitButton from "@/components/SubmitButton";

/** Admin page: who receives the monthly email, whether sending is set up, a test send, and the email itself. */
export default async function MonthlyReportPage({ searchParams }: { searchParams: Promise<{ test?: string; reason?: string }> }) {
  await requireAdmin();
  const { user, t, locale } = await requireUserWithDictionary();
  const m = t.monthlyEmail;
  const { test, reason } = await searchParams;

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost:3000"}`;
  const [report, recipients, sent] = await Promise.all([
    buildMonthlyReport(),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
    sentMonths(),
  ]);
  const email = renderMonthlyEmail(report, user, siteUrl(origin));
  const missing = missingEmailSettings();
  const cronMissing = process.env.CRON_SECRET?.trim() ? [] : ["CRON_SECRET"];
  const monthName = (key: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-brand-600 hover:underline">
          ← {t.users.backToSettings}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{m.pageTitle}</h1>
        <p className="mt-1 text-sm text-stone-500">{m.pageSubtitle}</p>
      </div>

      {test === "sent" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">{m.testSent}</p>}
      {test === "failed" && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {m.testFailed(reason === "missing" ? missing.join(", ") || "—" : (reason ?? "—").slice(0, 20))}
        </p>
      )}

      <div className="card space-y-3 text-sm">
        {missing.length > 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
            {m.notConfigured} <strong>{missing.join(", ")}</strong>
          </p>
        ) : cronMissing.length > 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
            {m.cronMissing} <strong>{cronMissing.join(", ")}</strong>
          </p>
        ) : (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">{m.configured}</p>
        )}

        <div>
          <h2 className="font-semibold text-stone-900">{m.recipients(recipients.length)}</h2>
          <ul className="mt-1 space-y-0.5 text-stone-600">
            {recipients.map((r) => (
              <li key={r.id} className="break-words">
                {r.name} · {r.email} · {r.role === "ADMIN" ? t.nav.admin : t.nav.manager}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="font-semibold text-stone-900">{m.lastSent}</h2>
          {sent.length === 0 ? (
            <p className="text-stone-500">{m.neverSent}</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-stone-600">
              {sent.map((s) => (
                <li key={s.month}>
                  {s.unfinished ? m.unfinishedLine(monthName(s.month)) : m.sentLine(monthName(s.month), formatDate(s.at, locale), s.sent)}
                  {s.failed.length > 0 && <span className="text-red-600"> · {m.failedTo(s.failed.join(", "))}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <form action={sendMonthlyReportTest}>
          <SubmitButton className="btn-secondary" pendingLabel={t.leaseDetail.saving}>{m.sendTest}</SubmitButton>
        </form>
      </div>

      <div className="card space-y-2 p-0">
        <h2 className="px-5 pt-4 font-semibold text-stone-900">
          {m.preview} · {email.subject}
        </h2>
        {/* the email exactly as sent, isolated from the app's styles */}
        <iframe
          title={email.subject}
          srcDoc={email.html.replace("<head>", '<head><base target="_blank">')}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className="h-[900px] w-full rounded-b-2xl border-0"
        />
      </div>
    </div>
  );
}
