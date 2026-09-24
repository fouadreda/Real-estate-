import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import Badge from "@/components/Badge";
import { deleteExpense } from "@/lib/actions/expenses";

export default async function ExpensesPage() {
  const { t, locale } = await requireUserWithDictionary();
  const expenses = await prisma.expense.findMany({
    include: { property: true, recordedBy: true },
    orderBy: { date: "desc" },
  });

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">{t.expenses.title}</h1>
          <p className="mt-1 text-sm text-stone-500">{t.expenses.summary(expenses.length, formatMoney(total, locale))}</p>
        </div>
        <Link href="/expenses/new" className="btn-primary">
          {t.expenses.add}
        </Link>
      </div>

      {expenses.length === 0 ? (
        <div className="card text-center text-stone-500">
          {t.expenses.empty}{" "}
          <Link href="/expenses/new" className="text-brand-600 hover:underline">
            {t.expenses.addFirst}
          </Link>
          .
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
              <tr>
                <th className="px-5 py-3 font-medium">{t.expenses.dateHeader}</th>
                <th className="px-5 py-3 font-medium">{t.expenses.propertyHeader}</th>
                <th className="px-5 py-3 font-medium">{t.expenses.categoryHeader}</th>
                <th className="px-5 py-3 font-medium">{t.expenses.descriptionHeader}</th>
                <th className="px-5 py-3 font-medium">{t.expenses.recordedByHeader}</th>
                <th className="px-5 py-3 font-medium">{t.expenses.amountHeader}</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {expenses.map((expense) => {
                const removeExpense = deleteExpense.bind(null, expense.id);
                return (
                  <tr key={expense.id} className="hover:bg-stone-50">
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
                    <td className="px-5 py-3 text-stone-600">
                      {expense.recordedBy?.name ?? <span className="text-stone-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-stone-900">{formatMoney(expense.amount, locale)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <Link href={`/expenses/${expense.id}/edit`} className="text-sm text-brand-600 hover:underline">
                          {t.common.edit}
                        </Link>
                        <form action={removeExpense}>
                          <button type="submit" className="text-sm text-red-600 hover:underline">
                            {t.common.delete}
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
