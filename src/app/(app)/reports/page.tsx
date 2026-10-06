import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, formatMoneyForPdf, toDateInputValue } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import {
  cashAmount,
  computeLeaseLedger,
  monthlyEquivalentRent,
  leaseActiveInRange,
  emptyAgingBuckets,
  addToAgingBuckets,
  daysBetween,
} from "@/lib/ledger";
import { leaseLocationName, propertyLabel } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import Badge from "@/components/Badge";
import ExportPdfButton from "@/components/ExportPdfButton";
import type { BuildingType, ExpenseCategory } from "@prisma/client";

const BUILDING_TYPES: BuildingType[] = ["BUILDING", "VILLA", "WAREHOUSE_SITE"];
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
const LEASE_STATUS_FILTERS = ["unpaid", "paid", "all"] as const;
type LeaseStatusFilter = (typeof LEASE_STATUS_FILTERS)[number];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; type?: string; category?: string; status?: string }>;
}) {
  const { t, locale } = await requireUserWithDictionary();
  const { from: fromParam, to: toParam, type: typeParam, category: categoryParam, status: statusParam } =
    await searchParams;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const rangeFrom = fromParam ? new Date(`${fromParam}T00:00:00`) : null;
  const rangeTo = toParam ? new Date(`${toParam}T23:59:59.999`) : null;
  const hasFilter = Boolean(rangeFrom || rangeTo);
  const asOf = rangeTo ?? now;
  const selectedType =
    typeParam && (BUILDING_TYPES as string[]).includes(typeParam) ? (typeParam as BuildingType) : null;
  const selectedCategory =
    categoryParam && (EXPENSE_CATEGORIES as string[]).includes(categoryParam)
      ? (categoryParam as ExpenseCategory)
      : null;
  const selectedStatus: LeaseStatusFilter = (LEASE_STATUS_FILTERS as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as LeaseStatusFilter)
    : "unpaid";

  const [leasesAll, paymentsAll, expensesAll] = await Promise.all([
    prisma.lease.findMany({
      where: { status: { not: "PENDING" } },
      include: {
        tenant: true,
        property: { include: { building: true } },
        payments: true,
        rentReviews: { where: { appliedAt: { not: null } } },
      },
    }),
    prisma.payment.findMany({
      include: { lease: { include: { tenant: true, property: { include: { building: true } } } } },
      orderBy: { date: "desc" },
    }),
    prisma.expense.findMany({ include: { property: { include: { building: true } } }, orderBy: { date: "desc" } }),
  ]);

  const matchesType = (buildingType: BuildingType | null | undefined) =>
    !selectedType || buildingType === selectedType;

  const payments = paymentsAll.filter((p) => matchesType(p.lease.property.building?.type));
  const expenses = expensesAll.filter(
    (e) => matchesType(e.property.building?.type) && (!selectedCategory || e.category === selectedCategory),
  );
  const leasesInType = leasesAll.filter((l) => matchesType(l.property.building?.type));

  const needsReviewCount = leasesInType.filter((l) => l.needsReview).length;
  const leases = leasesInType.filter((l) => !l.needsReview);

  const revenueThisMonth = leases
    .filter((l) => leaseActiveInRange(l, monthStart, monthEnd))
    .reduce((sum, l) => sum + monthlyEquivalentRent(l.rentAmount, l.billingFrequency), 0);

  const expensesThisMonth = expenses
    .filter((e) => e.date >= monthStart && e.date <= monthEnd)
    .reduce((sum, e) => sum + e.amount, 0);

  const netIncomeThisMonth = revenueThisMonth - expensesThisMonth;

  const cashCollectedThisMonth = payments
    .filter((p) => p.date >= monthStart && p.date <= monthEnd)
    .reduce((sum, p) => sum + cashAmount(p), 0);

  const aging = emptyAgingBuckets();
  let totalUnpaid = 0;
  let totalAdvance = 0;
  const leaseRows: { lease: (typeof leases)[number]; unpaid: number; oldestUnpaidDate: Date | null; isPaid: boolean }[] =
    [];

  for (const lease of leases) {
    const ledger = computeLeaseLedger(lease, lease.payments, asOf);
    totalUnpaid += ledger.unpaid;
    totalAdvance += ledger.advance;
    const isPaid = ledger.unpaid <= 0.005;
    if (!isPaid) {
      for (const period of ledger.periods) {
        if (period.balance > 0.005) {
          addToAgingBuckets(aging, Math.max(daysBetween(period.dueDate, asOf), 0), period.balance);
        }
      }
    }
    leaseRows.push({ lease, unpaid: ledger.unpaid, oldestUnpaidDate: ledger.oldestUnpaidDate, isPaid });
  }

  leaseRows.sort((a, b) => (a.oldestUnpaidDate?.getTime() ?? 0) - (b.oldestUnpaidDate?.getTime() ?? 0));

  const arRows = leaseRows.filter((row) => {
    if (selectedStatus === "all") return true;
    return selectedStatus === "paid" ? row.isPaid : !row.isPaid;
  });

  const filteredPayments = payments.filter(
    (p) => (!rangeFrom || p.date >= rangeFrom) && (!rangeTo || p.date <= rangeTo),
  );
  const filteredExpenses = expenses.filter(
    (e) => (!rangeFrom || e.date >= rangeFrom) && (!rangeTo || e.date <= rangeTo),
  );

  const totalExpensesFiltered = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const totalPaymentsFiltered = filteredPayments.reduce((sum, p) => sum + cashAmount(p), 0);
  const depositsReceivedFiltered = filteredPayments
    .filter((p) => p.kind === "DEPOSIT")
    .reduce((sum, p) => sum + p.amount, 0);
  const depositsRefundedFiltered = filteredPayments
    .filter((p) => p.kind === "DEPOSIT_REFUND")
    .reduce((sum, p) => sum + p.amount, 0);
  const expensesByCategory = filteredExpenses.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + e.amount;
    return acc;
  }, {});

  const CASHBOOK_SCREEN_ROWS = 50;
  const cashEntries = [
    ...filteredPayments.map((p) => {
      const isRefund = p.kind === "DEPOSIT_REFUND";
      return {
        id: `p-${p.id}`,
        date: p.date,
        description: tenantDisplayName(p.lease.tenant),
        property: leaseLocationName(p.lease),
        kind: p.kind as string,
        kindLabel: t.status[p.kind],
        inflow: isRefund ? 0 : p.amount,
        outflow: isRefund ? p.amount : 0,
      };
    }),
    ...filteredExpenses.map((e) => ({
      id: `e-${e.id}`,
      date: e.date,
      description: e.description ?? t.status[e.category],
      property: propertyLabel(e.property),
      kind: e.category as string,
      kindLabel: t.status[e.category],
      inflow: 0,
      outflow: e.amount,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  const totalInflow = cashEntries.reduce((sum, e) => sum + e.inflow, 0);
  const totalOutflow = cashEntries.reduce((sum, e) => sum + e.outflow, 0);
  const netCash = totalInflow - totalOutflow;

  // Month-by-month summary: the selected period, or the current calendar year when no dates are chosen
  // (older entries such as deposits filed at a lease start in 2021 would otherwise add many empty-looking rows).
  const summaryEntries = hasFilter
    ? cashEntries
    : cashEntries.filter((e) => e.date.getUTCFullYear() === now.getFullYear());
  const monthlyTotals = new Map<string, { inflow: number; outflow: number }>();
  for (const entry of summaryEntries) {
    const key = `${entry.date.getUTCFullYear()}-${String(entry.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = monthlyTotals.get(key) ?? { inflow: 0, outflow: 0 };
    bucket.inflow += entry.inflow;
    bucket.outflow += entry.outflow;
    monthlyTotals.set(key, bucket);
  }
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const monthlyRows = [...monthlyTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      key,
      label: monthLabel.format(new Date(`${key}-01T00:00:00Z`)),
      inflow: v.inflow,
      outflow: v.outflow,
      net: v.inflow - v.outflow,
    }));
  const monthlyInflow = monthlyRows.reduce((sum, r) => sum + r.inflow, 0);
  const monthlyOutflow = monthlyRows.reduce((sum, r) => sum + r.outflow, 0);

  function buildHref(overrides: { type?: BuildingType | null; status?: LeaseStatusFilter | null }) {
    const params = new URLSearchParams();
    if (fromParam) params.set("from", fromParam);
    if (toParam) params.set("to", toParam);
    if (selectedCategory) params.set("category", selectedCategory);
    const nextType = "type" in overrides ? overrides.type : selectedType;
    const nextStatus = "status" in overrides ? overrides.status : selectedStatus;
    if (nextType) params.set("type", nextType);
    if (nextStatus && nextStatus !== "unpaid") params.set("status", nextStatus);
    const qs = params.toString();
    return qs ? `/reports?${qs}` : "/reports";
  }

  // Drops date range and category, keeps the type/status badge selections — used by "Clear filter".
  function clearFilterHref() {
    const params = new URLSearchParams();
    if (selectedType) params.set("type", selectedType);
    if (selectedStatus !== "unpaid") params.set("status", selectedStatus);
    const qs = params.toString();
    return qs ? `/reports?${qs}` : "/reports";
  }

  const typeLabel = selectedType ? t.status[selectedType] : t.reports.allTypes;
  const categoryLabel = selectedCategory ? t.status[selectedCategory] : null;
  const statusLabel =
    selectedStatus === "paid" ? t.reports.statusPaid : selectedStatus === "all" ? t.reports.statusAll : t.reports.statusUnpaid;
  const fromLabel = rangeFrom ? formatDate(rangeFrom, locale) : null;
  const toLabel = rangeTo ? formatDate(rangeTo, locale) : null;
  const filterSummary = [
    fromLabel && toLabel ? `${t.reports.dateFrom} ${fromLabel} ${t.reports.dateTo.toLowerCase()} ${toLabel}` : fromLabel ? `${t.reports.dateFrom} ${fromLabel}` : toLabel ? `${t.reports.dateTo} ${toLabel}` : null,
    typeLabel,
    categoryLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const pdfFooter = t.reports.pdfGeneratedOn(formatDate(now, locale));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{t.reports.title}</h1>
        <p className="mt-1 text-sm text-stone-500">{t.reports.subtitle}</p>
      </div>

      <div className="card space-y-3">
        <form action="/reports" method="GET" className="flex flex-wrap items-end gap-3">
          {selectedType && <input type="hidden" name="type" value={selectedType} />}
          {selectedStatus !== "unpaid" && <input type="hidden" name="status" value={selectedStatus} />}
          <div>
            <label className="label" htmlFor="from">{t.reports.dateFrom}</label>
            <input className="input" type="date" id="from" name="from" defaultValue={fromParam ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="to">{t.reports.dateTo}</label>
            <input className="input" type="date" id="to" name="to" defaultValue={toParam ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="category">{t.reports.categoryFilter}</label>
            <select className="input" id="category" name="category" defaultValue={selectedCategory ?? ""}>
              <option value="">{t.reports.allCategories}</option>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t.status[category]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-secondary">{t.reports.applyFilter}</button>
          {(hasFilter || selectedCategory) && (
            <Link href={clearFilterHref()} className="text-sm text-stone-500 hover:underline">
              {t.reports.clearFilter}
            </Link>
          )}
        </form>
        <div>
          <p className="label mb-1">{t.reports.propertyType}</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildHref({ type: null })}
              className={`badge ${selectedType ? "bg-stone-100 text-stone-600" : "bg-brand-600 text-white"}`}
            >
              {t.reports.allTypes}
            </Link>
            {BUILDING_TYPES.map((type) => (
              <Link
                key={type}
                href={buildHref({ type })}
                className={`badge ${selectedType === type ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-600"}`}
              >
                {t.status[type]}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <p className="label mb-1">{t.reports.statusFilter}</p>
          <div className="flex flex-wrap gap-2">
            {LEASE_STATUS_FILTERS.map((status) => (
              <Link
                key={status}
                href={buildHref({ status })}
                className={`badge ${selectedStatus === status ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-600"}`}
              >
                {status === "paid" ? t.reports.statusPaid : status === "all" ? t.reports.statusAll : t.reports.statusUnpaid}
              </Link>
            ))}
          </div>
        </div>
        <p className="text-xs text-stone-500">{t.reports.filterHint}</p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-stone-900">{t.reports.monthlyHeading}</h2>
            <p className="text-xs text-stone-500">
              {hasFilter ? t.reports.monthlyHintFiltered : t.reports.monthlyHintYear(now.getFullYear())}
            </p>
          </div>
          {monthlyRows.length > 0 && (
            <ExportPdfButton
              label={t.reports.exportPdf}
              fileName={`recap-mensuel-${toDateInputValue(now)}.pdf`}
              docTitle={t.reports.monthlyHeading}
              subtitle={filterSummary || String(now.getFullYear())}
              columns={[t.reports.monthHeader, t.reports.inflow, t.reports.outflow, t.reports.netCash]}
              rows={monthlyRows.map((r) => [
                r.label,
                formatMoneyForPdf(r.inflow),
                formatMoneyForPdf(r.outflow),
                formatMoneyForPdf(r.net),
              ])}
              amountColumnIndexes={[1, 2, 3]}
              totals={[
                { label: t.reports.inflow, value: formatMoneyForPdf(monthlyInflow) },
                { label: t.reports.outflow, value: formatMoneyForPdf(monthlyOutflow) },
                { label: t.reports.netCash, value: formatMoneyForPdf(monthlyInflow - monthlyOutflow) },
              ]}
              footer={pdfFooter}
            />
          )}
        </div>
        {monthlyRows.length === 0 ? (
          <div className="card text-sm text-stone-500">{t.reports.monthlyEmpty}</div>
        ) : (
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">{t.reports.monthHeader}</th>
                    <th className="px-5 py-3 text-right font-medium">{t.reports.inflow}</th>
                    <th className="px-5 py-3 text-right font-medium">{t.reports.outflow}</th>
                    <th className="px-5 py-3 text-right font-medium">{t.reports.netCash}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {monthlyRows.map((r) => (
                    <tr key={r.key}>
                      <td className="px-5 py-3 capitalize text-stone-900">{r.label}</td>
                      <td className="px-5 py-3 text-right text-emerald-700">{formatMoney(r.inflow, locale)}</td>
                      <td className="px-5 py-3 text-right text-red-600">{formatMoney(r.outflow, locale)}</td>
                      <td className={`px-5 py-3 text-right font-medium ${r.net >= 0 ? "text-stone-900" : "text-red-600"}`}>
                        {formatMoney(r.net, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-stone-200 bg-stone-50 font-medium text-stone-900">
                  <tr>
                    <td className="px-5 py-3">{t.reports.totalLabel}</td>
                    <td className="px-5 py-3 text-right">{formatMoney(monthlyInflow, locale)}</td>
                    <td className="px-5 py-3 text-right">{formatMoney(monthlyOutflow, locale)}</td>
                    <td className="px-5 py-3 text-right">{formatMoney(monthlyInflow - monthlyOutflow, locale)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-400">
          {t.reports.thisMonthHeading} — {monthLabel.format(now)}
        </h2>
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-stone-900">
            {selectedStatus === "paid"
              ? t.reports.paidHeading(arRows.length)
              : selectedStatus === "all"
                ? t.reports.allLeasesHeading(arRows.length)
                : t.reports.unpaidHeading(arRows.length)}
          </h2>
          <ExportPdfButton
            label={t.reports.exportPdf}
            fileName={`baux-${selectedStatus}-${toDateInputValue(now)}.pdf`}
            docTitle={
              selectedStatus === "paid"
                ? t.reports.pdfPaidTitle
                : selectedStatus === "all"
                  ? t.reports.pdfAllLeasesTitle
                  : t.reports.pdfUnpaidTitle
            }
            subtitle={[filterSummary, statusLabel].filter(Boolean).join(" · ")}
            columns={[t.reports.tenantHeader, t.reports.propertyHeader, t.reports.statusHeader, t.reports.oldestDueHeader, t.reports.amountHeader]}
            rows={arRows.map(({ lease, unpaid, oldestUnpaidDate, isPaid }) => [
              tenantDisplayName(lease.tenant),
              leaseLocationName(lease),
              isPaid ? t.reports.statusPaid : t.reports.statusUnpaid,
              oldestUnpaidDate ? formatDate(oldestUnpaidDate, locale) : "—",
              formatMoneyForPdf(unpaid),
            ])}
            amountColumnIndex={4}
            totalLabel={t.reports.pdfTotalUnpaid}
            totalValue={formatMoneyForPdf(totalUnpaid)}
            footer={pdfFooter}
          />
        </div>
        {arRows.length === 0 ? (
          <div className="card text-sm text-stone-500">
            {selectedStatus === "unpaid" ? t.reports.allPaid : t.reports.noneMatchStatus}
          </div>
        ) : (
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">{t.reports.tenantHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.reports.propertyHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.reports.statusHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.reports.oldestDueHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.reports.amountHeader}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {arRows.map(({ lease, unpaid, oldestUnpaidDate, isPaid }) => (
                    <tr key={lease.id}>
                      <td className="px-5 py-3">
                        <Link href={`/leases/${lease.id}`} className="font-medium text-stone-900 hover:underline">
                          {tenantDisplayName(lease.tenant)}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-stone-600">{leaseLocationName(lease)}</td>
                      <td className="px-5 py-3">
                        <Badge status={isPaid ? "PAID" : "LATE"} label={isPaid ? t.reports.statusPaid : t.reports.statusUnpaid} />
                      </td>
                      <td className="px-5 py-3 text-stone-600">
                        {oldestUnpaidDate ? formatDate(oldestUnpaidDate, locale) : "—"}
                      </td>
                      <td className={`px-5 py-3 font-medium ${isPaid ? "text-emerald-600" : "text-red-600"}`}>
                        {formatMoney(unpaid, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-stone-900">{t.reports.cashbookHeading}</h2>
            <p className="text-xs text-stone-500">{t.reports.cashbookHint}</p>
          </div>
          <ExportPdfButton
            label={t.reports.exportPdf}
            fileName={`caisse-${toDateInputValue(now)}.pdf`}
            docTitle={t.reports.cashbookHeading}
            subtitle={filterSummary}
            columns={[
              t.reports.dueHeader,
              t.expenses.descriptionHeader,
              t.reports.propertyHeader,
              t.leaseDetail.kind,
              t.reports.inflow,
              t.reports.outflow,
            ]}
            rows={cashEntries.map((entry) => [
              formatDate(entry.date, locale),
              entry.description,
              entry.property,
              entry.kindLabel,
              entry.inflow > 0 ? formatMoneyForPdf(entry.inflow) : "",
              entry.outflow > 0 ? formatMoneyForPdf(entry.outflow) : "",
            ])}
            amountColumnIndexes={[4, 5]}
            totals={[
              { label: t.reports.inflow, value: formatMoneyForPdf(totalInflow) },
              { label: t.reports.outflow, value: formatMoneyForPdf(totalOutflow) },
              { label: t.reports.netCash, value: formatMoneyForPdf(netCash) },
            ]}
            footer={pdfFooter}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="stat-tile">
            <p className="stat-label">{t.reports.inflow}</p>
            <p className="stat-value text-emerald-600">{formatMoney(totalInflow, locale)}</p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t.reports.outflow}</p>
            <p className="stat-value text-red-600">{formatMoney(totalOutflow, locale)}</p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t.reports.netCash}</p>
            <p className={`stat-value ${netCash >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {formatMoney(netCash, locale)}
            </p>
          </div>
        </div>
        {cashEntries.length === 0 ? (
          <div className="card text-sm text-stone-500">{t.reports.cashbookEmpty}</div>
        ) : (
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">{t.reports.dueHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.expenses.descriptionHeader}</th>
                    <th className="px-5 py-3 font-medium">{t.leaseDetail.kind}</th>
                    <th className="px-5 py-3 text-right font-medium">{t.reports.inflow}</th>
                    <th className="px-5 py-3 text-right font-medium">{t.reports.outflow}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {cashEntries.slice(0, CASHBOOK_SCREEN_ROWS).map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-5 py-3 text-stone-600">{formatDate(entry.date, locale)}</td>
                      <td className="px-5 py-3">
                        <p className="text-stone-900">{entry.description}</p>
                        <p className="text-xs text-stone-500">{entry.property}</p>
                      </td>
                      <td className="px-5 py-3">
                        <Badge status={entry.kind} label={entry.kindLabel} />
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-emerald-600">
                        {entry.inflow > 0 ? formatMoney(entry.inflow, locale) : ""}
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-red-600">
                        {entry.outflow > 0 ? formatMoney(entry.outflow, locale) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {cashEntries.length > CASHBOOK_SCREEN_ROWS && (
          <p className="text-xs text-stone-500">{t.reports.cashbookShowing(CASHBOOK_SCREEN_ROWS, cashEntries.length)}</p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-stone-900">{t.reports.cashLogHeading(filteredPayments.length)}</h2>
              <p className="text-xs text-stone-500">
                {formatMoney(totalPaymentsFiltered, locale)} {hasFilter ? t.reports.selectedPeriod : t.reports.allTime}
                {depositsReceivedFiltered > 0 && ` · ${t.reports.includesDeposits(formatMoney(depositsReceivedFiltered, locale))}`}
                {depositsRefundedFiltered > 0 && ` · ${t.reports.lessRefunds(formatMoney(depositsRefundedFiltered, locale))}`}
              </p>
            </div>
            <ExportPdfButton
              label={t.reports.exportPdf}
              fileName={`paiements-${toDateInputValue(now)}.pdf`}
              docTitle={t.reports.pdfPaymentsTitle}
              subtitle={filterSummary}
              columns={[
                t.reports.dueHeader,
                t.reports.tenantHeader,
                t.reports.propertyHeader,
                t.leaseDetail.kind,
                t.reports.amountHeader,
              ]}
              rows={filteredPayments.map((payment) => [
                formatDate(payment.date, locale),
                tenantDisplayName(payment.lease.tenant),
                leaseLocationName(payment.lease),
                t.status[payment.kind],
                formatMoneyForPdf(cashAmount(payment)),
              ])}
              totalLabel={t.reports.pdfTotalReceived}
              totalValue={formatMoneyForPdf(totalPaymentsFiltered)}
              footer={pdfFooter}
            />
          </div>
          {filteredPayments.length === 0 ? (
            <div className="card text-sm text-stone-500">{t.reports.noPayments}</div>
          ) : (
            <div className="card overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">{t.reports.dueHeader}</th>
                      <th className="px-5 py-3 font-medium">{t.reports.tenantHeader}</th>
                      <th className="px-5 py-3 font-medium">{t.leaseDetail.kind}</th>
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
                        <td className="px-5 py-3">
                          <Badge status={payment.kind} label={t.status[payment.kind]} />
                        </td>
                        <td className={`px-5 py-3 ${payment.kind === "DEPOSIT_REFUND" ? "text-red-600" : "text-stone-600"}`}>
                          {formatMoney(cashAmount(payment), locale)}
                        </td>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-stone-900">{t.reports.expenseReportHeading(filteredExpenses.length)}</h2>
          <ExportPdfButton
            label={t.reports.exportPdf}
            fileName={`depenses-${toDateInputValue(now)}.pdf`}
            docTitle={t.reports.pdfExpensesTitle}
            subtitle={filterSummary}
            columns={[
              t.expenses.dateHeader,
              t.expenses.propertyHeader,
              t.expenses.categoryHeader,
              t.expenses.descriptionHeader,
              t.expenses.amountHeader,
            ]}
            rows={filteredExpenses.map((expense) => [
              formatDate(expense.date, locale),
              expense.property.name,
              t.status[expense.category],
              expense.description ?? "—",
              formatMoneyForPdf(expense.amount),
            ])}
            totalLabel={t.reports.pdfTotalExpenses}
            totalValue={formatMoneyForPdf(totalExpensesFiltered)}
            footer={pdfFooter}
          />
        </div>
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
