import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { ExpenseCategory, PaymentKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import {
  cashAmount,
  computeLeaseLedger,
  leaseDisplayStatus,
  monthlyEquivalentRent,
  monthsPerPeriod,
  paymentStatusFor,
  paymentsWithPaidUntil,
} from "@/lib/ledger";
import { propertyLabel } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";

/**
 * Read-only tools the assistant can call. They use the same rules as the app's pages (ledger.ts,
 * Reports, Alerts), so the assistant gives the figures staff see on screen. Nothing here writes.
 */

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "MAINTENANCE",
  "SALES_SERVICE_FEES",
  "TRANSPORT_COMMS",
  "OFFICE_SUPPLIES",
  "SALARY",
  "SITE_STAFF",
  "TAXES",
  "UTILITIES",
  "OFFICE_EQUIPMENT",
  "REPAIRS",
  "INSURANCE",
  "MANAGEMENT_FEE",
  "OTHER",
];
const PAYMENT_KINDS: PaymentKind[] = ["RENT", "ARREARS", "ADVANCE_AT_ENTRY", "DEPOSIT", "DEPOSIT_REFUND", "OTHER"];
const PAYMENT_FILTERS = ["late", "very_late", "up_to_date", "any"] as const;
const CONTRACT_FILTERS = ["current", "ending_soon", "expired_occupying", "upcoming", "ended", "any"] as const;
const LEASE_SORTS = ["most_unpaid", "most_days_late", "end_date", "name", "rent"] as const;

const BUILDING_PROP = {
  type: "string",
  description: 'Building or site name, or part of it (e.g. "La Paix", "Jean Paul", "Assigame"). Accents and case are ignored.',
};
const QUERY_PROP = {
  type: "string",
  description: "Text to look for in the tenant name, company, representative, unit code or unit name. Accents and case are ignored.",
};
const day = (what: string) => ({ type: "string", description: `${what}, as YYYY-MM-DD.` });

/** Tool definitions sent to Claude. Kept in a fixed order so the prompt cache stays valid. */
export const ASSISTANT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "portfolio_overview",
    description:
      "Today's figures for the whole portfolio, or for one building: units (occupied / vacant), current leases, monthly rent roll, unpaid rent, rent paid in advance, how many tenants are late and very late, leases ending in the next 90 days, money collected and expenses this month and last month, and one line per building. Leases flagged 'to check' are left out of the money totals (their number is given), exactly like the Reports page.",
    input_schema: { type: "object", properties: { building: BUILDING_PROP }, additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "find_leases",
    description:
      "Search leases (one row = one tenant in one unit) with their payment situation today: paid-until date, payment status, days late, unpaid amount, months unpaid, rent paid ahead, contract dates and status, tenant contacts (phone, email, representative) and the lease_id. Use it to answer who is late, what someone owes, who pays what, which contracts end soon, and to find the lease_id for lease_details. Filters combine. Returns at most `limit` rows plus totals over all matching leases.",
    input_schema: {
      type: "object",
      properties: {
        query: QUERY_PROP,
        building: BUILDING_PROP,
        payment: {
          type: "string",
          enum: [...PAYMENT_FILTERS],
          description:
            "late = has unpaid rent today (the Reports 'unpaid' list and the Alerts page); very_late = status 'Très en retard' (the Settings number of days or more past the paid-until date); up_to_date = nothing unpaid; any (default).",
        },
        contract: {
          type: "string",
          enum: [...CONTRACT_FILTERS],
          description:
            "current (default) = active, ending soon, expired but still occupied, or upcoming; ending_soon = ends within 3 months; expired_occupying = end date passed but not closed; upcoming = not started yet; ended = closed in the app; any = all.",
        },
        sort: {
          type: "string",
          enum: [...LEASE_SORTS],
          description: "Order of the rows. Default most_unpaid.",
        },
        limit: { type: "integer", minimum: 1, maximum: 150, description: "Rows to return (default 40)." },
        include_to_check: {
          type: "boolean",
          description:
            "Also list leases flagged 'to check' (unreliable imported data, left out of all totals). Default: only when `query` is given; otherwise they are left out and only counted.",
        },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "lease_details",
    description:
      "Everything about one lease: tenant and contacts, unit, rent and its scheduled or applied reviews, deposit, contract dates and status, paid-until date, each unpaid month with its amount, all payments (newest first, with the months each one paid and the paid-until date after it), collection follow-ups and payment promises, open data issues, and the app link.",
    input_schema: {
      type: "object",
      properties: { lease_id: { type: "string", description: "The lease_id returned by find_leases." } },
      required: ["lease_id"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "list_payments",
    description:
      "Money received (and deposit refunds paid out) in a period, newest first, with totals by payment type and by month. Filter by dates, building, tenant/unit text and payment type. In the totals a deposit refund counts as money going out.",
    input_schema: {
      type: "object",
      properties: {
        from: day("First day included"),
        to: day("Last day included"),
        building: BUILDING_PROP,
        query: QUERY_PROP,
        kind: { type: "string", enum: [...PAYMENT_KINDS], description: "Payment type." },
        limit: { type: "integer", minimum: 1, maximum: 300, description: "Rows to return (default 60). Totals always cover every match." },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "list_expenses",
    description:
      "Company expenses in a period, newest first, with totals by category, by building and by month. Filter by dates, building, category and text in the description.",
    input_schema: {
      type: "object",
      properties: {
        from: day("First day included"),
        to: day("Last day included"),
        building: BUILDING_PROP,
        category: { type: "string", enum: [...EXPENSE_CATEGORIES], description: "Expense category." },
        query: { type: "string", description: "Text to look for in the description or unit. Accents and case are ignored." },
        limit: { type: "integer", minimum: 1, maximum: 300, description: "Rows to return (default 60). Totals always cover every match." },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "upcoming_events",
    description:
      "What is coming up or needs action in the next `days` days: contracts ending (time to propose the renewal and a new rent), contracts already past their end date but still occupied, scheduled rent reviews not yet applied (with whether the letter was sent), payment promises due or broken, and leases starting soon.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 365, description: "How far ahead to look (default 90)." } },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
];

/** A tool input Claude got wrong (or that matches nothing): sent back to it as an error so it can correct the call. */
export class ToolInputError extends Error {}

type Input = Record<string, unknown>;

/**
 * Runs one tool call and returns its result as JSON text. Inputs are checked here because, with
 * eager input streaming, the API passes them through without validating them against the schema.
 */
export async function runAssistantTool(name: string, input: unknown): Promise<string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ToolInputError("The tool input must be a JSON object.");
  }
  const args = input as Input;
  const known = ASSISTANT_TOOLS.find((tool) => tool.name === name);
  if (!known) throw new ToolInputError(`Unknown tool "${name}".`);
  const allowed = Object.keys((known.input_schema as { properties?: object }).properties ?? {});
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new ToolInputError(`Unknown field(s): ${extra.join(", ")}. Allowed: ${allowed.join(", ") || "none"}.`);

  switch (name) {
    case "portfolio_overview":
      return JSON.stringify(await portfolioOverview(args));
    case "find_leases":
      return JSON.stringify(await findLeases(args));
    case "lease_details":
      return JSON.stringify(await leaseDetails(args));
    case "list_payments":
      return JSON.stringify(await listPayments(args));
    case "list_expenses":
      return JSON.stringify(await listExpenses(args));
    case "upcoming_events":
      return JSON.stringify(await upcomingEvents(args));
    default:
      throw new ToolInputError(`Unknown tool "${name}".`);
  }
}

// ---------- input checks ----------

function optString(args: Input, key: string, max = 200): string | null {
  const value = args[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ToolInputError(`"${key}" must be a string.`);
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

function optEnum<T extends string>(args: Input, key: string, values: readonly T[]): T | null {
  const value = optString(args, key);
  if (value === null) return null;
  if (!(values as readonly string[]).includes(value)) throw new ToolInputError(`"${key}" must be one of: ${values.join(", ")}.`);
  return value as T;
}

function optBool(args: Input, key: string): boolean | null {
  const value = args[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new ToolInputError(`"${key}" must be true or false.`);
  return value;
}

function optInt(args: Input, key: string, min: number, max: number): number | null {
  const value = args[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolInputError(`"${key}" must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

/** A YYYY-MM-DD day; `endOfDay` makes it inclusive as the last day of a range. */
function optDay(args: Input, key: string, endOfDay = false): Date | null {
  const value = optString(args, key, 10);
  if (value === null) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}Z`) : null;
  if (!date || Number.isNaN(date.getTime())) throw new ToolInputError(`"${key}" must be a date written YYYY-MM-DD.`);
  return date;
}

// ---------- shared helpers ----------

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const isoDay = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);
const money = (amount: number) => Math.round(amount);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Pseudo units that only hold collected electricity / maintenance fees (not rentable), as on the dashboard. */
const isChargesUnit = (p: { category: string; unitCode: string | null }) => p.category === "OTHER" && p.unitCode === "Charges collectées";

/** Building ids whose name contains the text (or null when no building filter was asked). */
async function resolveBuildings(name: string | null): Promise<{ ids: Set<string>; names: string[] } | null> {
  if (!name) return null;
  const buildings = await prisma.building.findMany({ orderBy: { name: "asc" } });
  const wanted = normalize(name);
  const matches = buildings.filter((b) => normalize(b.name).includes(wanted) || wanted.includes(normalize(b.name)));
  if (matches.length === 0) {
    throw new ToolInputError(`No building matches "${name}". Buildings: ${buildings.map((b) => b.name).join(", ")}.`);
  }
  return { ids: new Set(matches.map((b) => b.id)), names: matches.map((b) => b.name) };
}

type TenantFields = { firstName: string | null; lastName: string | null; company: string | null; representative: string | null };
type PropertyFields = Parameters<typeof propertyLabel>[0];

function matchesText(query: string | null, tenant: TenantFields, property: PropertyFields): boolean {
  if (!query) return true;
  const wanted = normalize(query);
  const haystack = normalize(
    [
      tenantDisplayName(tenant),
      tenant.firstName,
      tenant.lastName,
      tenant.company,
      tenant.representative,
      property.unitCode,
      property.name,
      property.building?.name,
    ]
      .filter(Boolean)
      .join(" | "),
  );
  return wanted.split(" ").every((word) => haystack.includes(word));
}

const leaseInclude = {
  tenant: true,
  property: { include: { building: true } },
  payments: true,
  rentReviews: true,
} as const;

type LeaseWithLedgerData = Awaited<ReturnType<typeof loadLeases>>[number];

function loadLeases() {
  return prisma.lease.findMany({ include: leaseInclude });
}

/** One lease as the assistant sees it — the same figures as the lease page. */
function leaseRow(lease: LeaseWithLedgerData, now: Date, overdueDays: number) {
  const ledger = computeLeaseLedger(lease, lease.payments, now);
  const contract = leaseDisplayStatus(lease, now);
  const billed = contract === "ACTIVE" || contract === "ENDING_SOON" || contract === "EXPIRED_OCCUPYING";
  const hasRent = lease.rentAmount > 0;
  const pay = paymentStatusFor(ledger.paidUntil, now, overdueDays);
  const unpaidPeriods = ledger.periods.filter((p) => p.balance > 0.005).length;
  return {
    lease_id: lease.id,
    tenant: tenantDisplayName(lease.tenant),
    company: lease.tenant.company,
    representative: lease.tenant.representative,
    phone: lease.tenant.phone,
    email: lease.tenant.email,
    unit: propertyLabel(lease.property),
    building: lease.property.building?.name ?? null,
    charges_unit: isChargesUnit(lease.property) || undefined,
    rent: money(lease.rentAmount),
    billing: lease.billingFrequency,
    rent_per_month: money(monthlyEquivalentRent(lease.rentAmount, lease.billingFrequency)),
    start: isoDay(lease.startDate),
    end: isoDay(lease.endDate),
    closed_on: isoDay(lease.closedAt),
    contract_status: contract,
    paid_until: hasRent ? isoDay(ledger.paidUntil) : null,
    payment_status: billed && hasRent ? pay.status : null,
    days_late: billed && hasRent ? pay.daysLate : 0,
    unpaid: money(ledger.unpaid),
    months_unpaid: unpaidPeriods * monthsPerPeriod(lease.billingFrequency),
    oldest_unpaid_due: isoDay(ledger.oldestUnpaidDate),
    paid_ahead: money(ledger.advance),
    deposit: money(lease.depositAmount),
    deposit_note: lease.depositLabel,
    to_check: lease.needsReview ? lease.reviewReason || "data to check" : undefined,
    link: `/leases/${lease.id}`,
  };
}

/** Same set as the Reports totals: every lease except upcoming ones and the ones flagged to check. */
const countsInTotals = (lease: { status: string; needsReview: boolean }) => lease.status !== "PENDING" && !lease.needsReview;

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function monthRange(now: Date, offset: number) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1) - 1);
  return { start, end };
}

// ---------- tools ----------

async function portfolioOverview(args: Input) {
  const building = await resolveBuildings(optString(args, "building"));
  const now = new Date();
  const { overdueDays } = await getSettings();
  const [leasesAll, propertiesAll, payments, expenses, buildings] = await Promise.all([
    loadLeases(),
    prisma.property.findMany({ include: { building: true } }),
    prisma.payment.findMany({ include: { lease: { select: { property: { select: { buildingId: true } } } } } }),
    prisma.expense.findMany({ include: { property: { select: { buildingId: true } } } }),
    prisma.building.findMany({ orderBy: { name: "asc" } }),
  ]);
  const inScope = (buildingId: string | null) => !building || (buildingId !== null && building.ids.has(buildingId));

  const leases = leasesAll.filter((l) => inScope(l.property.buildingId));
  const properties = propertiesAll.filter((p) => inScope(p.buildingId) && !isChargesUnit(p));
  const thisMonth = monthRange(now, 0);
  const lastMonth = monthRange(now, -1);
  const in90Days = new Date(now.getTime() + 90 * DAY_MS);

  function figures(scopeLeases: typeof leases, scopeProperties: typeof properties, buildingIds: Set<string> | null) {
    let unpaid = 0;
    let paidAhead = 0;
    let late = 0;
    let veryLate = 0;
    for (const lease of scopeLeases.filter(countsInTotals)) {
      const row = leaseRow(lease, now, overdueDays);
      unpaid += row.unpaid;
      paidAhead += row.paid_ahead;
      if (row.unpaid > 0) late += 1;
      if (row.payment_status === "OVERDUE") veryLate += 1;
    }
    const activeLeases = scopeLeases.filter((l) => l.status === "ACTIVE" && !l.needsReview);
    const inBuildings = (buildingId: string | null) => !buildingIds || (buildingId !== null && buildingIds.has(buildingId));
    const cashIn = (range: { start: Date; end: Date }) =>
      money(
        payments
          .filter((p) => inBuildings(p.lease.property.buildingId) && p.date >= range.start && p.date <= range.end)
          .reduce((sum, p) => sum + cashAmount(p), 0),
      );
    const spent = (range: { start: Date; end: Date }) =>
      money(
        expenses
          .filter((e) => inBuildings(e.property.buildingId) && e.date >= range.start && e.date <= range.end)
          .reduce((sum, e) => sum + e.amount, 0),
      );
    return {
      units: scopeProperties.length,
      occupied: scopeProperties.filter((p) => p.status === "OCCUPIED").length,
      vacant: scopeProperties.filter((p) => p.status === "VACANT").length,
      under_maintenance: scopeProperties.filter((p) => p.status === "MAINTENANCE").length,
      active_leases: activeLeases.length,
      monthly_rent_roll: money(activeLeases.reduce((sum, l) => sum + monthlyEquivalentRent(l.rentAmount, l.billingFrequency), 0)),
      unpaid_rent: money(unpaid),
      rent_paid_ahead: money(paidAhead),
      tenants_late: late,
      tenants_very_late: veryLate,
      leases_to_check_not_in_totals: scopeLeases.filter((l) => l.needsReview).length,
      leases_ending_next_90_days: scopeLeases.filter(
        (l) => l.status === "ACTIVE" && l.endDate && l.endDate >= now && l.endDate <= in90Days,
      ).length,
      collected_this_month: cashIn(thisMonth),
      expenses_this_month: spent(thisMonth),
      collected_last_month: cashIn(lastMonth),
      expenses_last_month: spent(lastMonth),
    };
  }

  const scopedBuildings = buildings.filter((b) => inScope(b.id));
  return {
    as_of: isoDay(now),
    overdue_days_setting: overdueDays,
    scope: building ? building.names : "all buildings",
    totals: figures(leases, properties, building?.ids ?? null),
    by_building: scopedBuildings.map((b) => ({
      building: b.name,
      type: b.type,
      ...figures(
        leases.filter((l) => l.property.buildingId === b.id),
        properties.filter((p) => p.buildingId === b.id),
        new Set([b.id]),
      ),
    })),
  };
}

async function findLeases(args: Input) {
  const query = optString(args, "query");
  const building = await resolveBuildings(optString(args, "building"));
  const payment = optEnum(args, "payment", PAYMENT_FILTERS) ?? "any";
  const contract = optEnum(args, "contract", CONTRACT_FILTERS) ?? "current";
  const sort = optEnum(args, "sort", LEASE_SORTS) ?? "most_unpaid";
  const limit = optInt(args, "limit", 1, 150) ?? 40;
  // their figures are unreliable (e.g. years of "unpaid" rent from old imports): only listed when asked for or searched by name
  const includeToCheck = optBool(args, "include_to_check") ?? Boolean(query);
  const now = new Date();
  const { overdueDays } = await getSettings();

  const leases = (await loadLeases()).filter(
    (l) =>
      (!building || (l.property.buildingId !== null && building.ids.has(l.property.buildingId))) &&
      matchesText(query, l.tenant, l.property),
  );
  let toCheckLeftOut = 0;
  const rows = leases
    .map((lease) => ({ lease, row: leaseRow(lease, now, overdueDays) }))
    .filter(({ lease }) => {
      if (includeToCheck || !lease.needsReview) return true;
      toCheckLeftOut += 1;
      return false;
    })
    .filter(({ row }) => {
      const status = row.contract_status;
      const contractOk =
        contract === "any" ||
        (contract === "current" && status !== "ENDED") ||
        (contract === "ending_soon" && status === "ENDING_SOON") ||
        (contract === "expired_occupying" && status === "EXPIRED_OCCUPYING") ||
        (contract === "upcoming" && status === "UPCOMING") ||
        (contract === "ended" && status === "ENDED");
      const paymentOk =
        payment === "any" ||
        (payment === "late" && row.unpaid > 0) ||
        (payment === "very_late" && row.payment_status === "OVERDUE") ||
        (payment === "up_to_date" && row.unpaid === 0);
      return contractOk && paymentOk;
    });

  const byName = (a: { row: { tenant: string } }, b: { row: { tenant: string } }) => a.row.tenant.localeCompare(b.row.tenant, "fr");
  rows.sort((a, b) => {
    switch (sort) {
      case "most_days_late":
        return b.row.days_late - a.row.days_late || b.row.unpaid - a.row.unpaid;
      case "end_date":
        return (a.row.end ?? "9999").localeCompare(b.row.end ?? "9999") || byName(a, b);
      case "name":
        return byName(a, b);
      case "rent":
        return b.row.rent_per_month - a.row.rent_per_month;
      default:
        return b.row.unpaid - a.row.unpaid || b.row.days_late - a.row.days_late || byName(a, b);
    }
  });

  const counted = rows.filter(({ lease }) => countsInTotals(lease));
  return {
    as_of: isoDay(now),
    overdue_days_setting: overdueDays,
    matches: rows.length,
    shown: Math.min(rows.length, limit),
    leases_to_check_not_listed: includeToCheck ? undefined : toCheckLeftOut,
    totals_over_all_matches: {
      unpaid: money(counted.reduce((sum, { row }) => sum + row.unpaid, 0)),
      paid_ahead: money(counted.reduce((sum, { row }) => sum + row.paid_ahead, 0)),
      rent_per_month: money(counted.reduce((sum, { row }) => sum + row.rent_per_month, 0)),
      left_out_of_totals: rows.length - counted.length,
    },
    leases: rows.slice(0, limit).map(({ row }) => row),
  };
}

async function leaseDetails(args: Input) {
  const leaseId = optString(args, "lease_id", 60);
  if (!leaseId) throw new ToolInputError('"lease_id" is required.');
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: {
      ...leaseInclude,
      followUps: { orderBy: { date: "desc" }, take: 30 },
      issues: { where: { status: { not: "FIXED" } } },
      attachments: { select: { id: true } },
    },
  });
  if (!lease) throw new ToolInputError(`No lease has the id "${leaseId}". Use find_leases to get the lease_id.`);

  const now = new Date();
  const { overdueDays } = await getSettings();
  const ledger = computeLeaseLedger(lease, lease.payments, now);
  const monthsByPayment = paymentsWithPaidUntil(lease, lease.payments);
  const payments = [...lease.payments].sort((a, b) => b.date.getTime() - a.date.getTime());
  const otherLeases = await prisma.lease.findMany({
    where: { tenantId: lease.tenantId, id: { not: lease.id } },
    include: { property: { include: { building: true } } },
  });

  return {
    ...leaseRow(lease, now, overdueDays),
    as_of: isoDay(now),
    tenant_details: {
      first_name: lease.tenant.firstName,
      last_name: lease.tenant.lastName,
      po_box: lease.tenant.poBox,
      address: [lease.tenant.address, lease.tenant.city].filter(Boolean).join(", ") || null,
      notes: lease.tenant.notes,
      link: `/tenants/${lease.tenantId}`,
      other_leases: otherLeases.map((l) => ({ lease_id: l.id, unit: propertyLabel(l.property), status: l.status })),
    },
    billing_starts: isoDay(lease.ledgerStartDate ?? lease.startDate),
    unpaid_months: ledger.periods
      .filter((p) => p.balance > 0.005)
      .map((p) => ({ due: isoDay(p.dueDate), amount: money(p.balance) })),
    rent_reviews: lease.rentReviews
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .map((r) => ({
        due: isoDay(r.dueDate),
        increase_percent: Math.round(r.rate * 1000) / 10,
        letter_sent: isoDay(r.letterSentAt),
        applied: isoDay(r.appliedAt),
      })),
    payments_total: payments.length,
    payments: payments.slice(0, 80).map((p) => {
      const months = monthsByPayment.get(p.id);
      return {
        date: isoDay(p.date),
        amount: money(p.amount),
        kind: p.kind,
        months_paid: months?.months,
        paid_until_after: months ? isoDay(months.paidUntil) : undefined,
        not_counted_in_rent: months ? undefined : p.kind === "RENT" || p.kind === "ARREARS" ? true : undefined,
        receipt: p.receiptNumber,
        method: p.method,
        unconfirmed: p.confirmed ? undefined : true,
        notes: p.notes,
      };
    }),
    follow_ups: lease.followUps.map((f) => ({
      date: isoDay(f.date),
      action: f.action,
      response: f.response,
      promise_date: isoDay(f.promiseDate),
      promise_amount: f.promiseAmount === null ? null : money(f.promiseAmount),
      result: f.result,
    })),
    open_data_issues: lease.issues.map((i) => ({ problem: i.problem, action: i.action, status: i.status })),
    documents_uploaded: lease.attachments.length,
  };
}

async function listPayments(args: Input) {
  const from = optDay(args, "from");
  const to = optDay(args, "to", true);
  const building = await resolveBuildings(optString(args, "building"));
  const query = optString(args, "query");
  const kind = optEnum(args, "kind", PAYMENT_KINDS);
  const limit = optInt(args, "limit", 1, 300) ?? 60;

  const payments = await prisma.payment.findMany({
    where: {
      ...(kind ? { kind } : {}),
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(building ? { lease: { property: { buildingId: { in: [...building.ids] } } } } : {}),
    },
    include: { lease: { include: { tenant: true, property: { include: { building: true } } } } },
    orderBy: { date: "desc" },
  });
  const rows = payments.filter((p) => matchesText(query, p.lease.tenant, p.lease.property));

  const byKind: Record<string, number> = {};
  const byMonth: Record<string, { money_in: number; money_out: number }> = {};
  for (const p of rows) {
    byKind[p.kind] = money((byKind[p.kind] ?? 0) + p.amount);
    const bucket = (byMonth[monthKey(p.date)] ??= { money_in: 0, money_out: 0 });
    if (p.kind === "DEPOSIT_REFUND") bucket.money_out = money(bucket.money_out + p.amount);
    else bucket.money_in = money(bucket.money_in + p.amount);
  }
  return {
    period: { from: isoDay(from), to: isoDay(to) },
    matches: rows.length,
    shown: Math.min(rows.length, limit),
    net_total: money(rows.reduce((sum, p) => sum + cashAmount(p), 0)),
    by_kind: byKind,
    by_month: Object.fromEntries(Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))),
    payments: rows.slice(0, limit).map((p) => ({
      date: isoDay(p.date),
      amount: money(p.amount),
      kind: p.kind,
      tenant: tenantDisplayName(p.lease.tenant),
      unit: propertyLabel(p.lease.property),
      months_paid: p.monthsCovered ?? undefined,
      receipt: p.receiptNumber,
      method: p.method,
      unconfirmed: p.confirmed ? undefined : true,
      notes: p.notes,
      entered_in_app: p.recordedById ? true : undefined,
      lease_id: p.leaseId,
    })),
  };
}

async function listExpenses(args: Input) {
  const from = optDay(args, "from");
  const to = optDay(args, "to", true);
  const building = await resolveBuildings(optString(args, "building"));
  const category = optEnum(args, "category", EXPENSE_CATEGORIES);
  const query = optString(args, "query");
  const limit = optInt(args, "limit", 1, 300) ?? 60;

  const expenses = await prisma.expense.findMany({
    where: {
      ...(category ? { category } : {}),
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(building ? { property: { buildingId: { in: [...building.ids] } } } : {}),
    },
    include: { property: { include: { building: true } } },
    orderBy: { date: "desc" },
  });
  const wanted = query ? normalize(query) : null;
  const rows = wanted
    ? expenses.filter((e) => normalize(`${e.description ?? ""} | ${propertyLabel(e.property)}`).includes(wanted))
    : expenses;

  const add = (acc: Record<string, number>, key: string, amount: number) => {
    acc[key] = money((acc[key] ?? 0) + amount);
  };
  const byCategory: Record<string, number> = {};
  const byBuilding: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  for (const e of rows) {
    add(byCategory, e.category, e.amount);
    add(byBuilding, e.property.building?.name ?? propertyLabel(e.property), e.amount);
    add(byMonth, monthKey(e.date), e.amount);
  }
  return {
    period: { from: isoDay(from), to: isoDay(to) },
    matches: rows.length,
    shown: Math.min(rows.length, limit),
    total: money(rows.reduce((sum, e) => sum + e.amount, 0)),
    by_category: byCategory,
    by_building: byBuilding,
    by_month: Object.fromEntries(Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))),
    expenses: rows.slice(0, limit).map((e) => ({
      date: isoDay(e.date),
      amount: money(e.amount),
      category: e.category,
      description: e.description,
      unit: propertyLabel(e.property),
      entered_in_app: e.recordedById ? true : undefined,
    })),
  };
}

async function upcomingEvents(args: Input) {
  const days = optInt(args, "days", 1, 365) ?? 90;
  const now = new Date();
  const until = new Date(now.getTime() + days * DAY_MS);
  const { overdueDays } = await getSettings();
  const [leases, reviews, promises] = await Promise.all([
    loadLeases(),
    prisma.rentReview.findMany({
      where: { appliedAt: null, dueDate: { lte: until } },
      include: { lease: { include: { tenant: true, property: { include: { building: true } } } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.followUp.findMany({
      where: {
        OR: [
          { result: "BROKEN" },
          { result: "PENDING", promiseDate: { not: null, lte: until } },
        ],
      },
      include: { lease: { include: { tenant: true, property: { include: { building: true } } } } },
      orderBy: { promiseDate: "asc" },
    }),
  ]);

  const rows = leases.map((lease) => ({ lease, row: leaseRow(lease, now, overdueDays) }));
  const brief = ({ row }: (typeof rows)[number]) => ({
    lease_id: row.lease_id,
    tenant: row.tenant,
    unit: row.unit,
    phone: row.phone,
    rent: row.rent,
    billing: row.billing,
    start: row.start,
    end: row.end,
    paid_until: row.paid_until,
    unpaid: row.unpaid,
    to_check: row.to_check,
    link: row.link,
  });

  return {
    as_of: isoDay(now),
    looking_ahead_days: days,
    contracts_ending: rows
      .filter(({ lease }) => lease.status === "ACTIVE" && lease.endDate && lease.endDate >= new Date(now.getTime() - DAY_MS) && lease.endDate <= until)
      .sort((a, b) => a.lease.endDate!.getTime() - b.lease.endDate!.getTime())
      .map((r) => ({ ...brief(r), days_left: Math.ceil((r.lease.endDate!.getTime() - now.getTime()) / DAY_MS) })),
    expired_but_occupied: rows
      .filter(({ row }) => row.contract_status === "EXPIRED_OCCUPYING")
      .sort((a, b) => a.lease.endDate!.getTime() - b.lease.endDate!.getTime())
      .map(brief),
    rent_reviews_not_applied: reviews.map((r) => ({
      lease_id: r.leaseId,
      tenant: tenantDisplayName(r.lease.tenant),
      unit: propertyLabel(r.lease.property),
      due: isoDay(r.dueDate),
      increase_percent: Math.round(r.rate * 1000) / 10,
      current_rent: money(r.lease.rentAmount),
      new_rent: money(r.lease.rentAmount * (1 + r.rate)),
      letter_sent: isoDay(r.letterSentAt),
      link: `/leases/${r.leaseId}`,
    })),
    payment_promises: promises.map((f) => ({
      lease_id: f.leaseId,
      tenant: tenantDisplayName(f.lease.tenant),
      unit: propertyLabel(f.lease.property),
      promised_on: isoDay(f.date),
      promise_date: isoDay(f.promiseDate),
      promise_amount: f.promiseAmount === null ? null : money(f.promiseAmount),
      result: f.result,
      response: f.response,
      link: `/leases/${f.leaseId}`,
    })),
    leases_starting: rows
      .filter(({ lease }) => lease.startDate > now && lease.startDate <= until)
      .sort((a, b) => a.lease.startDate.getTime() - b.lease.startDate.getTime())
      .map(brief),
  };
}
