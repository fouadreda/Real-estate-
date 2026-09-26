import type { BillingFrequency, PaymentKind } from "@prisma/client";

const MONTHS_PER_PERIOD: Record<BillingFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

export const DEFAULT_GRACE_DAYS = 10;

export function monthsPerPeriod(frequency: BillingFrequency): number {
  return MONTHS_PER_PERIOD[frequency];
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

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
}

interface LeaseLike {
  startDate: Date;
  endDate: Date | null;
  /** First due date not yet paid at import time — billing starts here instead of startDate. */
  ledgerStartDate?: Date | null;
  rentAmount: number;
  billingFrequency: BillingFrequency;
}

interface PaymentLike {
  amount: number;
  kind?: PaymentKind;
  confirmed?: boolean;
  date?: Date;
}

const RENT_LIKE_KINDS: PaymentKind[] = ["RENT", "ARREARS"];

/**
 * Computes rent accrued to date, total paid, and a FIFO allocation of
 * payments across billing periods (oldest period paid first).
 *
 * Billing starts at `ledgerStartDate` when set (so old leases with unknown
 * pre-import history don't show years of false arrears), and a period only
 * counts as due once it is more than `graceDays` in the past. Only confirmed
 * rent/arrears payments dated on or after the billing start feed the pool —
 * deposits, advances, and unconfirmed report-comment payments don't count
 * toward rent owed.
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
  const allDates = leasePeriods(billingStart, end, lease.billingFrequency);
  const elapsedDates = allDates.filter((d) => d <= cutoff);

  const rentPayments = payments.filter(
    (p) =>
      (p.confirmed ?? true) &&
      (p.kind === undefined || RENT_LIKE_KINDS.includes(p.kind)) &&
      (p.date === undefined || p.date >= billingStart),
  );
  const totalPaid = rentPayments.reduce((sum, p) => sum + p.amount, 0);

  let pool = totalPaid;
  let oldestUnpaidDate: Date | null = null;
  const periods: LedgerPeriod[] = elapsedDates.map((dueDate, index) => {
    const amountDue = lease.rentAmount;
    const amountAllocated = Math.min(Math.max(pool, 0), amountDue);
    pool -= amountAllocated;
    const balance = amountDue - amountAllocated;
    const isPaid = balance <= 0.005;
    if (!isPaid && oldestUnpaidDate === null) oldestUnpaidDate = dueDate;
    return {
      index,
      dueDate,
      amountDue,
      amountAllocated,
      balance,
      isPaid,
      isOverdue: !isPaid && dueDate < asOf,
    };
  });

  const totalAccrued = elapsedDates.length * lease.rentAmount;
  const balance = totalAccrued - totalPaid;
  const unpaid = Math.max(balance, 0);
  const advance = Math.max(-balance, 0);

  return { periods, totalAccrued, totalPaid, balance, unpaid, advance, oldestUnpaidDate };
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
