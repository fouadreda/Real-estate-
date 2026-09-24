import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/format";
import { createExpense } from "@/lib/actions/expenses";
import { requireUserWithDictionary } from "@/lib/auth";

export default async function NewExpensePage() {
  const { t } = await requireUserWithDictionary();
  const properties = await prisma.property.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href="/expenses" className="text-sm text-brand-600 hover:underline">
          ← {t.expenses.title}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{t.expenseForm.addTitle}</h1>
      </div>

      {properties.length === 0 ? (
        <div className="card text-sm text-stone-500">
          {t.expenseForm.needProperty}
        </div>
      ) : (
        <form action={createExpense} className="card space-y-4">
          <div>
            <label className="label" htmlFor="propertyId">{t.expenseForm.property}</label>
            <select className="input" id="propertyId" name="propertyId" required defaultValue="">
              <option value="" disabled>{t.expenseForm.selectProperty}</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="category">{t.expenseForm.category}</label>
            <select className="input" id="category" name="category" defaultValue="MAINTENANCE">
              <option value="MAINTENANCE">{t.status.MAINTENANCE}</option>
              <option value="UTILITIES">{t.status.UTILITIES}</option>
              <option value="REPAIRS">{t.status.REPAIRS}</option>
              <option value="INSURANCE">{t.status.INSURANCE}</option>
              <option value="TAXES">{t.status.TAXES}</option>
              <option value="MANAGEMENT_FEE">{t.status.MANAGEMENT_FEE}</option>
              <option value="OTHER">{t.status.OTHER}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="amount">{t.expenseForm.amount}</label>
              <input className="input" id="amount" name="amount" type="number" min="0" step="0.01" required />
            </div>
            <div>
              <label className="label" htmlFor="date">{t.expenseForm.date}</label>
              <input className="input" id="date" name="date" type="date" required defaultValue={toDateInputValue(new Date())} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="description">{t.expenseForm.description}</label>
            <textarea className="input" id="description" name="description" rows={3} placeholder="Optional" />
          </div>
          <div>
            <label className="label" htmlFor="file">{t.expenseForm.receiptOptional}</label>
            <input
              className="input"
              id="file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            />
            <p className="mt-1 text-xs text-stone-500">{t.leaseDetail.attachmentHint}</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary">{t.expenseForm.create}</button>
            <Link href="/expenses" className="btn-secondary">{t.common.cancel}</Link>
          </div>
        </form>
      )}
    </div>
  );
}
