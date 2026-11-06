import "server-only";

import { prisma } from "@/lib/prisma";
import { cashAmount, computeLeaseLedger, monthlyEquivalentRent, paymentStatusFor } from "@/lib/ledger";
import { getSettings } from "@/lib/settings";
import { getDictionary, localeFor } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import { missingEmailSettings, sendEmail } from "@/lib/email";
import type { Language } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_DAYS = 60;
const SENT_PREFIX = "monthlyReport.sent.";

/**
 * The monthly email: the month just ended, worked out exactly like Reports filtered on that month
 * (cash in and out, then unpaid and advance at its last day), plus, as of today, the tenants the
 * Alerts page lists as very late and the leases ending within 60 days.
 */
export async function buildMonthlyReport(now = new Date()) {
  const { overdueDays } = await getSettings();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  const monthKey = from.toISOString().slice(0, 7);

  const [leases, payments, expenses, expiringAll, dismissed] = await Promise.all([
    // the leases Reports and Alerts count: not upcoming, not "to check"
    prisma.lease.findMany({
      where: { status: { not: "PENDING" }, needsReview: false },
      include: {
        tenant: true,
        property: { include: { building: true } },
        payments: true,
        rentReviews: { where: { appliedAt: { not: null } } },
      },
    }),
    // the cashbook counts every payment and expense of the month, like Reports
    prisma.payment.findMany({ where: { date: { gte: from, lte: to } }, include: { lease: { include: { property: { include: { building: true } } } } } }),
    prisma.expense.findMany({ where: { date: { gte: from, lte: to } }, include: { property: { include: { building: true } } } }),
    prisma.lease.findMany({
      where: { status: "ACTIVE", endDate: { not: null, lte: new Date(now.getTime() + EXPIRING_DAYS * DAY_MS) } },
      include: { tenant: true, property: { include: { building: true } } },
      orderBy: { endDate: "asc" },
    }),
    prisma.dismissedAlert.findMany({ where: { kind: { in: ["OVERDUE", "EXPIRING"] } }, select: { kind: true, refId: true, context: true } }),
  ]);
  const hidden = new Set(dismissed.map((d) => `${d.kind}:${d.refId}:${d.context}`));

  const inflow = payments.filter((p) => p.kind !== "DEPOSIT_REFUND").reduce((sum, p) => sum + p.amount, 0);
  const deposits = payments.filter((p) => p.kind === "DEPOSIT").reduce((sum, p) => sum + p.amount, 0);
  const refunds = payments.filter((p) => p.kind === "DEPOSIT_REFUND").reduce((sum, p) => sum + p.amount, 0);
  const expensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

  const byBuilding = new Map<string, { inflow: number; outflow: number }>();
  const add = (name: string | undefined, amount: number, side: "inflow" | "outflow") => {
    const key = name ?? "—";
    const row = byBuilding.get(key) ?? { inflow: 0, outflow: 0 };
    row[side] += amount;
    byBuilding.set(key, row);
  };
  for (const p of payments) {
    const cash = cashAmount(p);
    add(p.lease.property.building?.name, Math.abs(cash), cash < 0 ? "outflow" : "inflow");
  }
  for (const e of expenses) add(e.property.building?.name, e.amount, "outflow");

  let unpaidAtEnd = 0;
  let advanceAtEnd = 0;
  const late: { leaseId: string; tenant: string; place: string; unpaid: number; paidUntil: Date; daysLate: number; oldest: Date }[] = [];
  for (const lease of leases) {
    // at the month's last day, payments made after it not counted yet (as in Reports)
    const atEnd = computeLeaseLedger(lease, lease.payments.filter((p) => p.date <= to), to);
    unpaidAtEnd += atEnd.unpaid;
    advanceAtEnd += atEnd.advance;
    // today, with every payment (as on the Alerts page)
    const today = computeLeaseLedger(lease, lease.payments, now);
    const oldest = today.oldestUnpaidDate;
    if (!oldest || oldest >= now || hidden.has(`OVERDUE:${lease.id}:${oldest.toISOString()}`)) continue;
    const { daysLate } = paymentStatusFor(today.paidUntil, now, overdueDays);
    if (daysLate < overdueDays) continue;
    late.push({
      leaseId: lease.id,
      tenant: tenantDisplayName(lease.tenant),
      place: leaseLocationName(lease),
      unpaid: today.unpaid,
      paidUntil: today.paidUntil,
      daysLate,
      oldest,
    });
  }
  late.sort((a, b) => a.oldest.getTime() - b.oldest.getTime());

  const expiring = expiringAll
    .filter((l) => !hidden.has(`EXPIRING:${l.id}:${l.endDate!.toISOString()}`))
    .map((l) => ({
      leaseId: l.id,
      tenant: tenantDisplayName(l.tenant),
      place: leaseLocationName(l),
      endDate: l.endDate!,
      rent: monthlyEquivalentRent(l.rentAmount, l.billingFrequency),
      // days until the end date (the lease's last day): 0 on that day, negative once it has passed
      daysLeft: Math.ceil((l.endDate!.getTime() - now.getTime()) / DAY_MS),
    }));

  return {
    monthKey,
    from,
    to,
    overdueDays,
    cash: { inflow, deposits, refunds, expenses: expensesTotal, outflow: refunds + expensesTotal, net: inflow - refunds - expensesTotal },
    unpaidAtEnd,
    advanceAtEnd,
    byBuilding: [...byBuilding.entries()].sort(([a], [b]) => a.localeCompare(b, "fr")).map(([name, v]) => ({ name, ...v })),
    late,
    expiring,
  };
}

export type MonthlyReport = Awaited<ReturnType<typeof buildMonthlyReport>>;

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The email for one person, in their language. Links point at the live site. */
export function renderMonthlyEmail(report: MonthlyReport, person: { name: string; language: Language }, baseUrl: string, test = false) {
  const t = getDictionary(person.language).monthlyEmail;
  const locale = localeFor(person.language);
  const money = (n: number) => formatMoney(n, locale);
  // inside tables: plain numbers, the currency once in the column title, so 4 columns fit on a phone
  const amount = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(n));
  const xof = (label: string) => `${label} (XOF)`;
  // dates are stored as UTC days: shown in UTC so the server's own time zone never moves them
  const dayFormat = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  const day = (d: Date) => dayFormat.format(d);
  const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(report.from);
  const reportUrl = `${baseUrl}/reports?from=${report.monthKey}-01&to=${report.to.toISOString().slice(0, 10)}`;
  const leaseUrl = (id: string) => `${baseUrl}/leases/${id}`;
  const subject = `${test ? "[Test] " : ""}${t.subject(month)}`;

  const cell = "padding:6px 8px;border-bottom:1px solid #e7e5e4;text-align:left;vertical-align:top";
  const num = `${cell};text-align:right;white-space:nowrap`;
  const head = "padding:6px 8px;border-bottom:2px solid #d6d3d1;text-align:left;font-size:12px;color:#57534e";
  const table = (headers: string[], rows: string[][], numeric: number[]) =>
    `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr>${headers
      .map((h, i) => `<th style="${head}${numeric.includes(i) ? ";text-align:right" : ""}">${escape(h)}</th>`)
      .join("")}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td style="${numeric.includes(i) ? num : cell}">${c}</td>`).join("")}</tr>`).join("")}</table>`;
  const h2 = (text: string) => `<h2 style="font-size:17px;margin:28px 0 8px;color:#1c1917">${escape(text)}</h2>`;
  const link = (href: string, text: string) => `<a href="${escape(href)}" style="color:#3f6212">${escape(text)}</a>`;

  const summary = table(
    [t.summaryHeading(month), ""],
    [
      [escape(t.inflow), escape(money(report.cash.inflow))],
      [escape(t.ofWhichDeposits), escape(money(report.cash.deposits))],
      [escape(t.outflow), escape(money(report.cash.outflow))],
      [escape(t.ofWhichExpenses), escape(money(report.cash.expenses))],
      [`<strong>${escape(t.net)}</strong>`, `<strong>${escape(money(report.cash.net))}</strong>`],
      [escape(t.unpaidAtEnd(day(report.to))), escape(money(report.unpaidAtEnd))],
      [escape(t.advanceAtEnd(day(report.to))), escape(money(report.advanceAtEnd))],
    ],
    [1],
  );
  const buildings = report.byBuilding.length
    ? table(
        [t.building, xof(t.inflow), xof(t.outflow), xof(t.net)],
        report.byBuilding.map((b) => [escape(b.name), escape(amount(b.inflow)), escape(amount(b.outflow)), escape(amount(b.inflow - b.outflow))]),
        [1, 2, 3],
      )
    : "";
  const lateTotal = report.late.reduce((sum, r) => sum + r.unpaid, 0);
  const late = report.late.length
    ? table(
        [t.colTenant, xof(t.colUnpaid), t.colPaidUntil, t.colDaysLate],
        [
          ...report.late.map((r) => [
            `${link(leaseUrl(r.leaseId), r.tenant)}<br><span style="color:#78716c;font-size:12px">${escape(r.place)}</span>`,
            escape(amount(r.unpaid)),
            escape(day(r.paidUntil)),
            escape(String(r.daysLate)),
          ]),
          [`<strong>${escape(t.total)}</strong>`, `<strong>${escape(amount(lateTotal))}</strong>`, "", ""],
        ],
        [1, 3],
      )
    : `<p style="color:#57534e">${escape(t.lateNone)}</p>`;
  const expiring = report.expiring.length
    ? table(
        [t.colTenant, t.colEndDate, xof(t.colRent)],
        report.expiring.map((r) => [
          `${link(leaseUrl(r.leaseId), r.tenant)}<br><span style="color:#78716c;font-size:12px">${escape(r.place)}</span>`,
          `${escape(day(r.endDate))}<br><span style="color:#78716c;font-size:12px">${escape(r.daysLeft > 0 ? t.endsIn(r.daysLeft) : r.daysLeft === 0 ? t.endsToday : t.endedAgo(-r.daysLeft))}</span>`,
          escape(amount(r.rent)),
        ]),
        [2],
      )
    : `<p style="color:#57534e">${escape(t.expiringNone)}</p>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f5f5f4">
<div style="max-width:640px;margin:0 auto;padding:20px 16px;font-family:Arial,Helvetica,sans-serif;color:#1c1917;background:#ffffff">
<p style="font-size:13px;color:#78716c;margin:0 0 16px">Les Cocotiers</p>
<p>${escape(t.greeting(person.name))}</p>
<p>${escape(t.intro(month))}</p>
${summary}
<p style="margin:12px 0 0">${link(reportUrl, t.openReport)}</p>
${buildings ? `${h2(t.byBuilding)}${buildings}` : ""}
${h2(t.lateHeading(report.overdueDays, report.late.length))}
${late}
${h2(t.expiringHeading(EXPIRING_DAYS, report.expiring.length))}
${expiring}
<p style="margin:24px 0 0">${link(`${baseUrl}/alerts`, t.openAlerts)}</p>
<p style="font-size:12px;color:#78716c;margin:28px 0 0">${escape(t.footer)}</p>
</div></body></html>`;

  const lines = [
    t.greeting(person.name),
    "",
    t.intro(month),
    "",
    `${t.inflow}: ${money(report.cash.inflow)} (${t.ofWhichDeposits.toLowerCase()}: ${money(report.cash.deposits)})`,
    `${t.outflow}: ${money(report.cash.outflow)} (${t.ofWhichExpenses.toLowerCase()}: ${money(report.cash.expenses)})`,
    `${t.net}: ${money(report.cash.net)}`,
    `${t.unpaidAtEnd(day(report.to))}: ${money(report.unpaidAtEnd)}`,
    `${t.advanceAtEnd(day(report.to))}: ${money(report.advanceAtEnd)}`,
    reportUrl,
    "",
    t.lateHeading(report.overdueDays, report.late.length),
    ...(report.late.length
      ? report.late.map((r) => `- ${r.tenant} (${r.place}): ${money(r.unpaid)}, ${t.colPaidUntil.toLowerCase()} ${day(r.paidUntil)}, ${t.daysLateShort(r.daysLate)} — ${leaseUrl(r.leaseId)}`)
      : [t.lateNone]),
    "",
    t.expiringHeading(EXPIRING_DAYS, report.expiring.length),
    ...(report.expiring.length
      ? report.expiring.map((r) => `- ${r.tenant} (${r.place}): ${day(r.endDate)} (${r.daysLeft > 0 ? t.endsIn(r.daysLeft) : r.daysLeft === 0 ? t.endsToday : t.endedAgo(-r.daysLeft)}) — ${leaseUrl(r.leaseId)}`)
      : [t.expiringNone]),
    "",
    t.footer,
  ];
  return { subject, html, text: lines.join("\n") };
}

/** The site address used in the email links: APP_URL if set, else the production domain Vercel provides. */
export function siteUrl(fallbackOrigin: string): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return production ? `https://${production}` : fallbackOrigin;
}

/** Sends the report to every active account (administrators and managers), or only to one person for a test. */
export async function sendMonthlyReport(opts: { baseUrl: string; onlyUserId?: string; test?: boolean; now?: Date }) {
  const report = await buildMonthlyReport(opts.now);
  const people = await prisma.user.findMany({
    where: { active: true, ...(opts.onlyUserId ? { id: opts.onlyUserId } : {}) },
    select: { name: true, email: true, language: true },
    orderBy: { name: "asc" },
  });
  const results: { email: string; ok: boolean; error?: string }[] = [];
  for (const person of people) {
    const message = renderMonthlyEmail(report, person, opts.baseUrl, opts.test);
    const sent = await sendEmail({ to: { email: person.email, name: person.name }, ...message });
    results.push(sent.ok ? { email: person.email, ok: true } : { email: person.email, ok: false, error: sent.error });
  }
  return { monthKey: report.monthKey, results };
}

/**
 * The automatic run on the 1st. Each month is sent once: the month is claimed first (a second run,
 * a retry or a duplicate call finds the claim and stops). If nothing could be sent, the claim is
 * released so the run can be started again once the problem is fixed.
 */
export async function runMonthlyReport(opts: { baseUrl: string; now?: Date }) {
  const missing = missingEmailSettings();
  if (missing.length > 0) return { status: "not-configured" as const, missing };
  const now = opts.now ?? new Date();
  const monthKey = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const key = `${SENT_PREFIX}${monthKey}`;
  const claim = JSON.stringify({ at: now.toISOString(), status: "sending" });
  try {
    await prisma.appSetting.create({ data: { key, value: claim } });
  } catch (err) {
    // P2002: the month is already claimed (sent, or being sent by another run)
    if ((err as { code?: string }).code !== "P2002") throw err;
    if (!(await takeOverStalledClaim(key, claim, now))) return { status: "already-sent" as const, monthKey };
  }
  let results: Awaited<ReturnType<typeof sendMonthlyReport>>["results"];
  try {
    ({ results } = await sendMonthlyReport({ baseUrl: opts.baseUrl, now }));
  } catch (err) {
    // the report could not be built or the people not read: nobody was sent anything
    await prisma.appSetting.delete({ where: { key } }).catch(() => undefined);
    throw err;
  }
  const sent = results.filter((r) => r.ok).length;
  if (sent === 0) {
    await prisma.appSetting.delete({ where: { key } }).catch(() => undefined);
    return { status: "failed" as const, monthKey, results };
  }
  // emails went out: the month stays claimed even if this note cannot be saved, so it is never sent twice
  await prisma.appSetting
    .update({ where: { key }, data: { value: JSON.stringify({ at: now.toISOString(), sent, failed: results.filter((r) => !r.ok).map((r) => r.email) }) } })
    .catch((err) => console.error("[monthly-report] result not saved", err));
  return { status: "sent" as const, monthKey, results };
}

/**
 * A run killed mid-way leaves its claim saying "sending" for ever, which would block the month. Once
 * that claim is older than any run can last it can be taken over, by one run only (the update only
 * matches the claim as it was read).
 */
async function takeOverStalledClaim(key: string, claim: string, now: Date) {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row || !isStalled(row.value, now)) return false;
  const { count } = await prisma.appSetting.updateMany({ where: { key, value: row.value }, data: { value: claim } });
  return count === 1;
}

const STALLED_AFTER_MS = 10 * 60 * 1000;
function isStalled(value: string, now: Date) {
  try {
    const info = JSON.parse(value) as { at?: string; status?: string };
    return info.status === "sending" && now.getTime() - new Date(info.at ?? 0).getTime() > STALLED_AFTER_MS;
  } catch {
    return false;
  }
}

/** The last months sent automatically (newest first), for the settings page. */
export async function sentMonths(limit = 6) {
  const rows = await prisma.appSetting
    .findMany({ where: { key: { startsWith: SENT_PREFIX } }, orderBy: { key: "desc" }, take: limit })
    .catch(() => []);
  return rows.map((r) => {
    let info: { at?: string; sent?: number; failed?: string[]; status?: string } = {};
    try {
      info = JSON.parse(r.value);
    } catch {}
    return {
      month: r.key.slice(SENT_PREFIX.length),
      at: info.at ? new Date(info.at) : r.updatedAt,
      sent: info.sent ?? 0,
      failed: info.failed ?? [],
      unfinished: info.status === "sending",
    };
  });
}
