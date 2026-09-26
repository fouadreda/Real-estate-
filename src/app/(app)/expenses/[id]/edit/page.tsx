import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/format";
import { updateExpense } from "@/lib/actions/expenses";
import { deleteExpenseAttachment, uploadExpenseAttachment } from "@/lib/actions/attachments";
import AttachmentGallery from "@/components/AttachmentGallery";
import { requireUserWithDictionary } from "@/lib/auth";

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await requireUserWithDictionary();
  const [expense, properties] = await Promise.all([
    prisma.expense.findUnique({ where: { id }, include: { attachments: { orderBy: { createdAt: "desc" } } } }),
    prisma.property.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!expense) notFound();

  const updateExpenseWithId = updateExpense.bind(null, expense.id);
  const uploadReceiptForExpense = uploadExpenseAttachment.bind(null, expense.id);
  const deleteReceiptForExpense = deleteExpenseAttachment.bind(null, expense.id);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href="/expenses" className="text-sm text-brand-600 hover:underline">
          ← {t.expenses.title}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{t.expenseForm.editTitle}</h1>
      </div>

      <form action={updateExpenseWithId} className="card space-y-4">
        <div>
          <label className="label" htmlFor="propertyId">{t.expenseForm.property}</label>
          <select className="input" id="propertyId" name="propertyId" required defaultValue={expense.propertyId}>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="category">{t.expenseForm.category}</label>
          <select className="input" id="category" name="category" defaultValue={expense.category}>
            <option value="MAINTENANCE">{t.status.MAINTENANCE}</option>
            <option value="SALES_SERVICE_FEES">{t.status.SALES_SERVICE_FEES}</option>
            <option value="TRANSPORT_COMMS">{t.status.TRANSPORT_COMMS}</option>
            <option value="OFFICE_SUPPLIES">{t.status.OFFICE_SUPPLIES}</option>
            <option value="SALARY">{t.status.SALARY}</option>
            <option value="SITE_STAFF">{t.status.SITE_STAFF}</option>
            <option value="TAXES">{t.status.TAXES}</option>
            <option value="UTILITIES">{t.status.UTILITIES}</option>
            <option value="OFFICE_EQUIPMENT">{t.status.OFFICE_EQUIPMENT}</option>
            <option value="REPAIRS">{t.status.REPAIRS}</option>
            <option value="INSURANCE">{t.status.INSURANCE}</option>
            <option value="MANAGEMENT_FEE">{t.status.MANAGEMENT_FEE}</option>
            <option value="OTHER">{t.status.OTHER}</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="amount">{t.expenseForm.amount}</label>
            <input className="input" id="amount" name="amount" type="number" min="0" step="0.01" required defaultValue={expense.amount} />
          </div>
          <div>
            <label className="label" htmlFor="date">{t.expenseForm.date}</label>
            <input className="input" id="date" name="date" type="date" required defaultValue={toDateInputValue(expense.date)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="description">{t.expenseForm.description}</label>
          <textarea className="input" id="description" name="description" rows={3} defaultValue={expense.description ?? ""} />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary">{t.common.save}</button>
          <Link href="/expenses" className="btn-secondary">{t.common.cancel}</Link>
        </div>
      </form>

      <div className="card space-y-4">
        <h2 className="font-semibold text-stone-900">{t.leaseDetail.receiptsHeading}</h2>
        <AttachmentGallery
          attachments={expense.attachments}
          deleteAction={deleteReceiptForExpense}
          emptyLabel={t.leaseDetail.noReceipts}
          removeLabel={t.leaseDetail.removeAttachment}
        />
        <form action={uploadReceiptForExpense} className="space-y-2 border-t border-stone-200 pt-4">
          <input
            className="input"
            type="file"
            name="file"
            required
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          />
          <p className="text-xs text-stone-500">{t.leaseDetail.attachmentHint}</p>
          <button type="submit" className="btn-secondary w-full">{t.leaseDetail.uploadReceipt}</button>
        </form>
      </div>
    </div>
  );
}
