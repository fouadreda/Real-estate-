import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import {
  computeLeaseLedger,
  monthlyEquivalentRent,
  leaseActiveInRange,
  emptyAgingBuckets,
  addToAgingBuckets,
  daysBetween,
} from "@/lib/ledger";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import Badge from "@/components/Badge";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { t, locale } = await requireUserWithDictionary();
  const { from: fromParam, to: toParam } = await searchParams;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const rangeFrom = fromParam ? new Date(`${fromParam}T00:00:00`) : null;
  const rangeTo = toParam ? new Date(`${toParam}T23:59:59.999`) : null;
  const hasFilter = Boolean(rangeFrom || rangeTo);
  const asOf = rangeTo ?? now;

  const [leasesAll, payments, expenses] = await Promise.all([
    prisma.lease.findMany({
      where: { status: { not: "PENDING" } },
      include: { tenant: true, property: { include: { building: true } }, payments: true },
    }),
    prisma.payment.findMany({
      include: { lease: { include: { tenant: true, property: { include: { building: true } } } } },
      orderBy: { date: "desc" },
    }),
    prisma.expense.findMany({ include: { property: true }, orderBy: { date: "desc" } }),
  ]);

  const needsReviewCount = leasesAll.filter((l) => l.needsReview).length;
  const leases = leasesAll.filter((l) => !l.needsReview);

  const revenueThisMonth = leases
    .filter((l) => leaseActiveInRange(l, monthStart, monthEnd))
    .reduce((sum, l) => sum + monthlyEquivalentRent(l.rentAmount, l.billingFrequency), 0);

  const expensesThisMonth = expenses
    .filter((e) => e.date >= monthStart && e.date <= monthEnd)
    .reduce((sum, e) => sum + e.amount, 0);

  const netIncomeThisMonth = revenueThisMonth - expensesThisMonth;

  const cashCollectedThisMonth = payments
    .filter((p) => p.date >= monthStart && p.date <= monthEnd)
    .reduce((sum, p) => sum + p.amount, 0);

  const aging = emptyAgingBuckets();
  let totalUnpaid = 0;
  let totalAdvance = 0;
  const arRows: { lease: (typeof leases)[number]; unpaid: number; oldestUnpaidDate: Date | null }[] = [];

  for (const lease of leases) {
    const ledger = computeLeaseLedger(lease, lease.payments, asOf);
    totalUnpaid += ledger.unpaid;
    totalAdvance += ledger.advance;
    if (ledger.unpaid > 0.005) {
      arRows.push({ lease, unpaid: ledger.unpaid, oldestUnpaidDate: ledger.oldestUnpaidDate });
      for (const period of ledger.periods) {
        if (period.balance > 0.005) {
          addToAgingBuckets(aging, Math.max(daysBetween(period.dueDate, asOf), 0), period.balance);
        }
      }
    }
  }

  arRows.sort((a, b) => (a.oldestUnpaidDate?.getTime() ?? 0) - (b.oldestUnpaidDate?.getTime() ?? 0));

  const filteredPayments = payments.filter(
    (p) => (!rangeFrom || p.date >= rangeFrom) && (!rangeTo || p.date <= rangeTo),
  );
  const filteredExpenses = expenses.filter(
    (e) => (!rangeFrom || e.date >= rangeFrom) && (!rangeTo || e.date <= rangeTo),
  );

  const totalExpensesFiltered = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const expensesByCategory = filteredExpenses.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + e.amount;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{t.reports.title}</h1>
        <p className="mt-1 text-sm text-stone-500">{t.reports.subtitle}</p>
      </div>

      <div className="card space-y-3">
        <form action="/reports" method="GET" className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="from">{t.reports.dateFrom}</label>
            <input className="input" type="date" id="from" name="from" defaultValue={fromParam ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="to">{t.reports.dateTo}</label>
            <input className="input" type="date" id="to" name="to" defaultValue={toParam ?? ""} />
          </div>
          <button type="submit" className="btn-secondary">{t.reports.applyFilter}</button>
          {hasFilter && (
            <Link href="/reports" className="text-sm text-stone-500 hover:underline">
              {t.reports.clearFilter}
            </Link>
          )}
        </form>
        <p className="text-xs text-stone-500">{t.reports.filterHint}</p>
      </div>

      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-400">{t.reports.thisMonthHeading}</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="stat-tile">
            <p className="stat-label">{t.reports.revenueEarned}</p>
            <p className="stat-value">{formatMoney(revenueThisMonth, locale)}</p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t.reports.expenses}</p>
            <p className="stat-value">{formatMoney(expensesThisMonth, locale)}</p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t.reports.netIncome}</p>
            <p className={`stat-value ${netIncomeThisMonth >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {formatMoney(netIncomeThisMonth, locale)}
            </p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t.reports.cashCollected}</p>
            <p className="stat-value">{formatMoney(cashCollectedThisMonth, locale)}</p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-400">{t.reports.rightNowHeading}</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="stat-tile">
            <p className="stat-label">{t.reports.outstanding}</p>
            <p className="stat-value text-red-600">{formatMoney(totalUnpaid, locale)}</p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t.reports.advanceReceived}</p>
            <p className="stat-value text-emerald-600">{formatMoney(totalAdvance, locale)}</p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t.reports.aging0_30}</p>
            <p className="stat-value">{formatMoney(aging.d0_30, locale)}</p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t.reports.aging90plus}</p>
            <p className="stat-value text-red-600">{formatMoney(aging.d90plus, locale)}</p>
          </div>
        </div>
        {needsReviewCount > 0 && (
          <p className="mt-2 text-xs text-amber-700">{t.reports.needsReviewExcluded(needsReviewCount)}</p>
        )}
      </div>

      <div>
        <h2 className="mb-4 font-semibold text-stone-900">{t.reports.unpaidHeading(arRows.length)}</h2>
        {arRows.length === 0 ? (
          <div className="card text-sm text-stone-500">{t.reports.allPaid}</div>
        ) : (
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">{t.reports.tenantHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.reports.propertyHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.reports.oldestDueHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.reports.amountHeader}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {arRows.map(({ lease, unpaid, oldestUnpaidDate }) => (
                    <tr key={lease.id}>
                      <td className="px-5 py-3">
                        <Link href={`/leases/${lease.id}`} className="font-medium text-stone-900 hover:underline">
                          {tenantDisplayName(lease.tenant)}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-stone-600">{leaseLocationName(lease)}</td>
                      <td className="px-5 py-3 text-stone-600">
                        {oldestUnpaidDate ? formatDate(oldestUnpaidDate, locale) : "—"}
                      </td>
                      <td className="px-5 py-3 font-medium text-red-600">{formatMoney(unpaid, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="font-semibold text-stone-900">{t.reports.cashLogHeading(filteredPayments.length)}</h2>
          {filteredPayments.length === 0 ? (
            <div className="card text-sm text-stone-500">{t.reports.noPayments}</div>
          ) : (
            <div className="card overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">{t.reports.dueHeader}</th>
                      <th className="px-5 py-3 font-medium">{t.reports.tenantHeader}</th>
                      <th className="px-5 py-3 font-medium">{t.reports.amountHeader}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredPayments.slice(0, 25).map((payment) => (
                      <tr key={payment.id}>
                        <td className="px-5 py-3 text-stone-600">{formatDate(payment.date, locale)}</td>
                        <td className="px-5 py-3 text-stone-900">
                          {tenantDisplayName(payment.lease.tenant)}
                        </td>
                        <td className="px-5 py-3 text-stone-600">{formatMoney(payment.amount, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="card h-fit">
          <h2 className="mb-1 font-semibold text-stone-900">{t.reports.expensesByCategory}</h2>
          <p className="mb-4 text-xs text-stone-500">
            {formatMoney(totalExpensesFiltered, locale)} {hasFilter ? t.reports.selectedPeriod : t.reports.allTime}
          </p>
          {Object.keys(expensesByCategory).length === 0 ? (
            <p className="text-sm text-stone-500">{t.reports.noExpenses}</p>
          ) : (
            <ul className="space-y-3">
              {Object.entries(expensesByCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([category, amount]) => (
                  <li key={category} className="flex items-center justify-between text-sm">
                    <Badge status={category} label={t.status[category as keyof typeof t.status]} />
                    <span className="font-medium text-stone-900">{formatMoney(amount, locale)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="font-semibold text-stone-900">{t.reports.expenseReportHeading(filteredExpenses.length)}</h2>
        {filteredExpenses.length === 0 ? (
          <div className="card text-sm text-stone-500">{t.reports.noExpenses}</div>
        ) : (
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">{t.expenses.dateHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.expenses.propertyHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.expenses.categoryHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.expenses.descriptionHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.expenses.amountHeader}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredExpenses.slice(0, 25).map((expense) => (
                    <tr key={expense.id}>
                      <td className="px-5 py-3 text-stone-600">{formatDate(expense.date, locale)}</td>
                      <td className="px-5 py-3">
                        <Link href={`/properties/${expense.propertyId}`} className="text-stone-900 hover:underline">
                          {expense.property.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <Badge status={expense.category} label={t.status[expense.category]} />
                      </td>
                      <td className="px-5 py-3 text-stone-600">
                        {expense.description ?? <span className="text-stone-400">—</span>}
                      </td>
                      <td className="px-5 py-3 font-medium text-stone-900">{formatMoney(expense.amount, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
