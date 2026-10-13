import type { BillingFrequency, PaymentKind } from "@prisma/client";

const MONTHS_PER_PERIOD: Record<BillingFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

/** A month counts as due once it started more than this many days ago (a tenant paid until 30 Sept is not yet late on 6 Oct). */
export const DEFAULT_GRACE_DAYS = 10;

export function monthsPerPeriod(frequency: BillingFrequency): number {
  return MONTHS_PER_PERIOD[frequency];
}

/** Dates are stored at UTC midnight, so month arithmetic is done in UTC — it must not depend on the server's time zone. */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Rent paid is counted in whole months; this forgives a few francs when a month count has to be worked out from an amount. */
const AMOUNT_TOLERANCE = 100;

/** Due dates for every billing period of the lease, from start to end. */
export function leasePeriods(startDate: Date, endDate: Date, frequency: BillingFrequency): Date[] {
  const step = monthsPerPeriod(frequency);
  const dates: Date[] = [];
  let i = 0;
  while (true) {
    const due = addMonths(startDate, i * step);
    if (due > endDate) break;
    dates.push(due);
    i += 1;
  }
  return dates;
}

/** Monthly-equivalent rent, used for accrual revenue recognition. */
export function monthlyEquivalentRent(rentAmount: number, frequency: BillingFrequency): number {
  return rentAmount / monthsPerPeriod(frequency);
}

export interface LedgerPeriod {
  index: number;
  dueDate: Date;
  amountDue: number;
  amountAllocated: number;
  balance: number;
  isPaid: boolean;
  isOverdue: boolean;
}

export interface LeaseLedger {
  periods: LedgerPeriod[];
  totalAccrued: number;
  totalPaid: number;
  balance: number;
  unpaid: number;
  advance: number;
  oldestUnpaidDate: Date | null;
  /** Whole months of rent paid since billing started. */
  paidMonths: number;
  /** Last day the rent is paid up to: billing start + months paid − 1 day. */
  paidUntil: Date;
}

interface RentReviewLike {
  dueDate: Date;
  rate: number;
  appliedAt?: Date | null;
}

interface LeaseLike {
  startDate: Date;
  endDate: Date | null;
  /** First due date not yet paid at import time — billing starts here instead of startDate. */
  ledgerStartDate?: Date | null;
  rentAmount: number;
  billingFrequency: BillingFrequency;
  /** Applied rent reviews, used to bill each period at the rent that was actually in effect on its due date. */
  rentReviews?: RentReviewLike[];
}

interface PaymentLike {
  amount: number;
  kind?: PaymentKind;
  confirmed?: boolean;
  date?: Date;
  /** Whole months this payment pays for. When missing it is worked out from the amount and the rent. */
  monthsCovered?: number | null;
  /** Statement wording such as "… du 01/06/2025 au 31/08/2025", used to tell which periods a payment settled. */
  notes?: string | null;
}

const RENT_LIKE_KINDS: PaymentKind[] = ["RENT", "ARREARS"];

/**
 * True when the payment's own wording ("du dd/mm/yyyy au dd/mm/yyyy") says it settled periods that
 * both started and ended before `billingStart` — e.g. 2026 receipts for April–August 2025 when
 * billing starts on 1 Sept 2025. Those periods are already settled, so the money must not be used
 * to pay the periods billed from `billingStart`.
 */
function settlesEarlierPeriods(notes: string | null | undefined, billingStart: Date): boolean {
  if (!notes) return false;
  const dates = [...notes.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)].map(
    (m) => new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))),
  );
  if (dates.length < 2) return false;
  return dates[0] < billingStart && dates[1] < billingStart;
}

/**
 * `lease.rentAmount` only ever holds the current rent — applying a review multiplies
 * it in place with no history kept. Reconstructs the rent in effect on `date` by
 * undoing (dividing out) every applied review whose effective date is still in the
 * future relative to `date`, most recent first.
 */
function rentAmountAt(currentRentAmount: number, appliedReviews: RentReviewLike[], date: Date): number {
  const future = appliedReviews
    .filter((r) => r.appliedAt && r.dueDate > date)
    .sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());
  let amount = currentRentAmount;
  for (const review of future) {
    amount = amount / (1 + review.rate);
  }
  return amount;
}

/** Signed cash effect of a payment: a deposit refund leaves the cashbook, everything else enters it. */
export function cashAmount(payment: { amount: number; kind: PaymentKind }): number {
  return payment.kind === "DEPOSIT_REFUND" ? -payment.amount : payment.amount;
}

/** Rent counted payments are the confirmed rent/arrears ones that belong to the billing period (see computeLeaseLedger). */
function countedRentPayments(lease: LeaseLike, payments: PaymentLike[]): PaymentLike[] {
  const billingStart = lease.ledgerStartDate ?? lease.startDate;
  // Payments before the billing start are ignored only when it was set explicitly at import
  // (that older history is already settled). Without it the lease start is the real start,
  // so anything paid earlier is an advance. Compared by calendar month, so a payment made
  // a few days before a mid-month start still counts.
  const paymentsFrom = lease.ledgerStartDate
    ? new Date(Date.UTC(billingStart.getUTCFullYear(), billingStart.getUTCMonth(), 1))
    : null;
  return payments.filter(
    (p) =>
      (p.confirmed ?? true) &&
      (p.kind === undefined || RENT_LIKE_KINDS.includes(p.kind)) &&
      (p.date === undefined || paymentsFrom === null || p.date >= paymentsFrom) &&
      !(paymentsFrom !== null && settlesEarlierPeriods(p.notes, billingStart)),
  );
}

/** Whole months a payment pays for: the number chosen when it was recorded, else amount ÷ rent rounded down. */
export function monthsOfPayment(payment: PaymentLike, rentPerMonth: number): number {
  if (payment.monthsCovered != null && payment.monthsCovered >= 0) return Math.round(payment.monthsCovered);
  if (rentPerMonth <= 0) return 0;
  return Math.max(0, Math.floor((payment.amount + AMOUNT_TOLERANCE) / rentPerMonth));
}

/**
 * Rent is paid in whole months. Each rent payment says how many months it covers, and the lease
 * is paid up to: billing start + months paid − 1 day (so a lease starting 1 Jan that has paid
 * 3 months is paid until 31 March). Months due are the monthly periods that have started; the
 * ones beyond the months paid are unpaid, billed at the rent that applied on their date.
 *
 * Billing starts at `ledgerStartDate` when set (so old leases with unknown pre-import history
 * don't show years of false arrears). Only confirmed rent/arrears payments count — deposits,
 * advances at entry, and unconfirmed report-comment payments don't.
 */
export function computeLeaseLedger(
  lease: LeaseLike,
  payments: PaymentLike[],
  asOf: Date,
  graceDays: number = DEFAULT_GRACE_DAYS,
): LeaseLedger {
  const billingStart = lease.ledgerStartDate ?? lease.startDate;
  const end = lease.endDate ?? addMonths(asOf, 1);
  const cutoff = new Date(asOf.getTime() - graceDays * 24 * 60 * 60 * 1000);
  const step = monthsPerPeriod(lease.billingFrequency);
  const allDates = leasePeriods(billingStart, end, lease.billingFrequency);
  const elapsedDates = allDates.filter((d) => d <= cutoff);

  const rentPayments = countedRentPayments(lease, payments);
  const totalPaid = rentPayments.reduce((sum, p) => sum + p.amount, 0);
  const rentPerMonth = monthlyEquivalentRent(lease.rentAmount, lease.billingFrequency);
  const paidMonths = rentPayments.reduce((sum, p) => sum + monthsOfPayment(p, rentPerMonth), 0);
  const paidPeriods = Math.floor(paidMonths / step + 1e-9);

  const appliedReviews = lease.rentReviews ?? [];
  let oldestUnpaidDate: Date | null = null;
  const periods: LedgerPeriod[] = elapsedDates.map((dueDate, index) => {
    const amountDue = rentAmountAt(lease.rentAmount, appliedReviews, dueDate);
    const isPaid = index < paidPeriods;
    if (!isPaid && oldestUnpaidDate === null) oldestUnpaidDate = dueDate;
    return {
      index,
      dueDate,
      amountDue,
      amountAllocated: isPaid ? amountDue : 0,
      balance: isPaid ? 0 : amountDue,
      isPaid,
      isOverdue: !isPaid && dueDate < asOf,
    };
  });

  const totalAccrued = periods.reduce((sum, p) => sum + p.amountDue, 0);
  const unpaid = periods.reduce((sum, p) => sum + p.balance, 0);
  const paidUntil = new Date(addMonths(billingStart, paidMonths).getTime() - 24 * 60 * 60 * 1000);

  // Rent paid ahead: whole months between today and the Paid Until date.
  let monthsAhead = 0;
  const firstUnpaidDay = new Date(paidUntil.getTime() + 24 * 60 * 60 * 1000);
  while (monthsAhead < 240 && addMonths(asOf, monthsAhead + 1) <= firstUnpaidDay) monthsAhead += 1;
  const advance = monthsAhead * rentPerMonth;

  return {
    periods,
    totalAccrued,
    totalPaid,
    balance: unpaid > 0 ? unpaid : -advance,
    unpaid,
    advance,
    oldestUnpaidDate,
    paidMonths,
    paidUntil,
  };
}

export type PaymentStatus = "PAID" | "DUE" | "OVERDUE";

/** Paid: today is on or before Paid Until. Due: 1 to (overdueDays − 1) days past it. Overdue: overdueDays or more. */
export function paymentStatusFor(
  paidUntil: Date,
  asOf: Date,
  overdueDays: number,
  graceDays: number = DEFAULT_GRACE_DAYS,
): { status: PaymentStatus; daysLate: number } {
  const daysLate = asOf > paidUntil ? Math.max(0, daysBetween(paidUntil, asOf) - graceDays) : 0;
  if (daysLate <= 0) return { status: "PAID", daysLate: 0 };
  return { status: daysLate >= overdueDays ? "OVERDUE" : "DUE", daysLate };
}

export type LeaseDisplayStatus = "UPCOMING" | "ACTIVE" | "ENDING_SOON" | "ENDED" | "EXPIRED_OCCUPYING";

/** Lease status shown to staff — worked out from the dates, so nobody has to keep it up to date. */
export function leaseDisplayStatus(
  lease: { status: string; startDate: Date; endDate: Date | null },
  asOf: Date,
  endingSoonMonths = 3,
): LeaseDisplayStatus {
  if (lease.status === "ENDED" || lease.status === "TERMINATED") return "ENDED";
  if (lease.status === "PENDING" || lease.startDate > asOf) return "UPCOMING";
  if (lease.endDate) {
    if (lease.endDate < asOf) return "EXPIRED_OCCUPYING";
    if (lease.endDate <= addMonths(asOf, endingSoonMonths)) return "ENDING_SOON";
  }
  return "ACTIVE";
}

/**
 * Month-by-month history of a lease's rent payments: how many months each pays for and the
 * Paid Until date after it, oldest first. Payments are counted in date order from the billing start.
 */
export function paymentsWithPaidUntil<T extends PaymentLike & { id: string; date: Date }>(
  lease: LeaseLike,
  payments: T[],
): Map<string, { months: number; paidUntil: Date }> {
  const billingStart = lease.ledgerStartDate ?? lease.startDate;
  const rentPerMonth = monthlyEquivalentRent(lease.rentAmount, lease.billingFrequency);
  const counted = new Set(countedRentPayments(lease, payments).map((p) => (p as T).id));
  const result = new Map<string, { months: number; paidUntil: Date }>();
  let cumulative = 0;
  for (const p of [...payments].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    if (!counted.has(p.id)) continue;
    const months = monthsOfPayment(p, rentPerMonth);
    cumulative += months;
    result.set(p.id, {
      months,
      paidUntil: new Date(addMonths(billingStart, cumulative).getTime() - 24 * 60 * 60 * 1000),
    });
  }
  return result;
}

export type AgingBuckets = { d0_30: number; d31_60: number; d61_90: number; d90plus: number };

export function emptyAgingBuckets(): AgingBuckets {
  return { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
}

export function addToAgingBuckets(buckets: AgingBuckets, daysOverdue: number, amount: number): void {
  if (daysOverdue <= 30) buckets.d0_30 += amount;
  else if (daysOverdue <= 60) buckets.d31_60 += amount;
  else if (daysOverdue <= 90) buckets.d61_90 += amount;
  else buckets.d90plus += amount;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/** Whether a lease has any billing activity during [rangeStart, rangeEnd]. */
export function leaseActiveInRange(lease: LeaseLike, rangeStart: Date, rangeEnd: Date): boolean {
  const end = lease.endDate ?? rangeEnd;
  return lease.startDate <= rangeEnd && end >= rangeStart;
}
