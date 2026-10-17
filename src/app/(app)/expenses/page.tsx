import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, formatMoneyForPdf, toDateInputValue } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { propertyLabel } from "@/lib/leaseLocation";
import { knownId, loadFilterOptions } from "@/lib/filterOptions";
import Badge from "@/components/Badge";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import ExportPdfButton from "@/components/ExportPdfButton";
import PlaceFilters from "@/components/PlaceFilters";
import { deleteExpense } from "@/lib/actions/expenses";
import type { ExpenseCategory } from "@prisma/client";

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

/** YYYY-MM-DD from the URL, or null when missing or not a real date. */
function parseDay(value: string | undefined, time: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; category?: string; building?: string; unit?: string }>;
}) {
  const { t, locale } = await requireUserWithDictionary();
  const { from: fromParam, to: toParam, category: categoryParam, building: buildingParam, unit: unitParam } =
    await searchParams;
  const [allExpenses, options] = await Promise.all([
    prisma.expense.findMany({
      include: { property: { include: { building: true } }, recordedBy: true },
      orderBy: { date: "desc" },
    }),
    loadFilterOptions(),
  ]);

  const rangeFrom = parseDay(fromParam, "00:00:00");
  const rangeTo = parseDay(toParam, "23:59:59.999");
  const selectedCategory =
    categoryParam && (EXPENSE_CATEGORIES as string[]).includes(categoryParam) ? (categoryParam as ExpenseCategory) : null;
  const selectedBuilding = knownId(buildingParam, options.buildings.map((b) => b.id));
  const selectedUnit = knownId(unitParam, options.unitIds);
  const hasFilter = Boolean(rangeFrom || rangeTo || selectedCategory || selectedBuilding || selectedUnit);

  // filters combine: dates, category, building and unit
  const expenses = allExpenses.filter(
    (e) =>
      (!rangeFrom || e.date >= rangeFrom) &&
      (!rangeTo || e.date <= rangeTo) &&
      (!selectedCategory || e.category === selectedCategory) &&
      (!selectedBuilding || e.property.buildingId === selectedBuilding) &&
      (!selectedUnit || e.propertyId === selectedUnit),
  );
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const byCategory = [...expenses.reduce((m, e) => m.set(e.category, (m.get(e.category) ?? 0) + e.amount), new Map<ExpenseCategory, number>())]
    .sort((a, b) => b[1] - a[1]);
  const filterSummary = [
    rangeFrom ? `${t.reports.dateFrom} ${formatDate(rangeFrom, locale)}` : null,
    rangeTo ? `${t.reports.dateTo} ${formatDate(rangeTo, locale)}` : null,
    selectedCategory ? t.status[selectedCategory] : null,
    selectedBuilding ? options.buildings.find((b) => b.id === selectedBuilding)?.name : null,
    selectedUnit ? allExpenses.find((e) => e.propertyId === selectedUnit)?.property.name ?? null : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">{t.expenses.title}</h1>
          <p className="mt-1 text-sm text-stone-500">{t.expenses.summary(expenses.length, formatMoney(total, locale))}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportPdfButton
            label={t.reports.exportPdf}
            fileName={`depenses-${toDateInputValue(new Date())}.pdf`}
            docTitle={t.reports.pdfExpensesTitle}
            subtitle={filterSummary}
            columns={[t.expenses.dateHeader, t.expenses.propertyHeader, t.expenses.categoryHeader, t.expenses.descriptionHeader, t.expenses.amountHeader]}
            rows={expenses.map((e) => [
              formatDate(e.date, locale),
              propertyLabel(e.property),
              t.status[e.category],
              e.description ?? "—",
              formatMoneyForPdf(e.amount),
            ])}
            totalLabel={t.reports.pdfTotalExpenses}
            totalValue={formatMoneyForPdf(total)}
            footer={t.reports.pdfGeneratedOn(formatDate(new Date(), locale))}
          />
          <Link href="/expenses/new" className="btn-primary">
            {t.expenses.add}
          </Link>
        </div>
      </div>

      <form action="/expenses" method="GET" className="card grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="label" htmlFor="from">{t.reports.dateFrom}</label>
          <input className="input" type="date" id="from" name="from" defaultValue={fromParam ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="to">{t.reports.dateTo}</label>
          <input className="input" type="date" id="to" name="to" defaultValue={toParam ?? ""} />
        </div>
        <div className="min-w-0">
          <label className="label" htmlFor="category">{t.expenses.categoryHeader}</label>
          <select className="input" id="category" name="category" defaultValue={selectedCategory ?? ""}>
            <option value="">{t.reports.allCategories}</option>
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t.status[category]}
              </option>
            ))}
          </select>
        </div>
        <PlaceFilters
          options={options}
          selected={{ building: selectedBuilding, unit: selectedUnit }}
          labels={t.reports}
          showTenant={false}
        />
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">{t.reports.applyFilter}</button>
          {hasFilter && (
            <Link href="/expenses" className="text-sm text-stone-500 hover:underline">
              {t.reports.clearFilter}
            </Link>
          )}
        </div>
      </form>

      {byCategory.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {byCategory.map(([category, amount]) => (
            <span key={category} className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm">
              <Badge status={category} label={t.status[category]} />
              <span className="font-medium text-stone-900">{formatMoney(amount, locale)}</span>
            </span>
          ))}
        </div>
      )}

      {expenses.length === 0 && hasFilter ? (
        <div className="card text-center text-stone-500">{t.expenses.noMatch}</div>
      ) : expenses.length === 0 ? (
        <div className="card text-center text-stone-500">
          {t.expenses.empty}{" "}
          <Link href="/expenses/new" className="text-brand-600 hover:underline">
            {t.expenses.addFirst}
          </Link>
          .
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t.expenses.dateHeader}</th>
                  <th className="px-4 py-3 font-medium">{t.expenses.amountHeader}</th>
                  <th className="px-4 py-3 font-medium">{t.expenses.propertyHeader}</th>
                  <th className="px-4 py-3 font-medium">{t.expenses.categoryHeader}</th>
                  <th className="px-4 py-3 font-medium">{t.expenses.descriptionHeader}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {expenses.map((expense) => {
                  const removeExpense = deleteExpense.bind(null, expense.id);
                  return (
                    <tr key={expense.id} className="align-top hover:bg-stone-50">
                      <td className="px-4 py-3 text-stone-600">
                        <span className="whitespace-nowrap">{formatDate(expense.date, locale)}</span>
                        {/* row actions under the date, so they are never off screen on a phone */}
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Link
                            href={`/expenses/${expense.id}/edit`}
                            className="inline-flex min-h-8 items-center rounded-lg px-2 text-xs font-medium text-brand-600 hover:bg-stone-100"
                          >
                            {t.common.edit}
                          </Link>
                          <form action={removeExpense}>
                            <ConfirmSubmitButton
                              confirmMessage={t.common.confirmDelete}
                              confirmLabel={t.common.confirmDeleteYes}
                              cancelLabel={t.common.cancel}
                              className="inline-flex min-h-8 items-center rounded-lg px-2 text-xs font-medium text-red-600 hover:bg-red-50"
                            >
                              {t.common.delete}
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-900">{formatMoney(expense.amount, locale)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/properties/${expense.propertyId}`} className="text-stone-900 hover:underline">
                          {propertyLabel(expense.property)}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge status={expense.category} label={t.status[expense.category]} />
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {expense.description ?? <span className="text-stone-400">—</span>}
                        {expense.recordedBy?.name && <span className="block text-xs text-stone-400">{expense.recordedBy.name}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-stone-200 bg-stone-50 font-medium text-stone-900">
                <tr>
                  <td className="px-4 py-3">{t.reports.totalRows(expenses.length)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{formatMoney(total, locale)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
