import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/format";
import { updatePayment } from "@/lib/actions/payments";
import { deletePaymentAttachment, uploadPaymentAttachment } from "@/lib/actions/attachments";
import AttachmentGallery from "@/components/AttachmentGallery";
import { requireUserWithDictionary } from "@/lib/auth";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";

export default async function EditPaymentPage({
  params,
}: {
  params: Promise<{ id: string; paymentId: string }>;
}) {
  const { id, paymentId } = await params;
  const { t } = await requireUserWithDictionary();
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      lease: { include: { property: { include: { building: true } }, tenant: true } },
      attachments: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!payment || payment.leaseId !== id) notFound();

  const updatePaymentWithIds = updatePayment.bind(null, payment.id, payment.leaseId);
  const uploadReceiptForPayment = uploadPaymentAttachment.bind(null, payment.leaseId, payment.id);
  const deleteReceiptForPayment = deletePaymentAttachment.bind(null, payment.leaseId, payment.id);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href={`/leases/${payment.leaseId}`} className="text-sm text-brand-600 hover:underline">
          ← {leaseLocationName(payment.lease)}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{t.leaseDetail.editPaymentTitle}</h1>
        <p className="mt-1 text-sm text-stone-500">
          {tenantDisplayName(payment.lease.tenant)}
        </p>
      </div>

      <form action={updatePaymentWithIds} className="card space-y-4">
        <div>
          <label className="label" htmlFor="amount">{t.leaseDetail.amount}</label>
          <input
            className="input"
            id="amount"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            defaultValue={payment.amount}
          />
        </div>
        <div>
          <label className="label" htmlFor="date">{t.leaseDetail.dateHeader}</label>
          <input
            className="input"
            id="date"
            name="date"
            type="date"
            required
            defaultValue={toDateInputValue(payment.date)}
          />
        </div>
        <div>
          <label className="label" htmlFor="method">{t.leaseDetail.method}</label>
          <input className="input" id="method" name="method" defaultValue={payment.method ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="kind">{t.leaseDetail.kind}</label>
          <select className="input" id="kind" name="kind" defaultValue={payment.kind}>
            <option value="RENT">{t.status.RENT}</option>
            <option value="ARREARS">{t.status.ARREARS}</option>
            <option value="ADVANCE_AT_ENTRY">{t.status.ADVANCE_AT_ENTRY}</option>
            <option value="DEPOSIT">{t.status.DEPOSIT}</option>
            <option value="DEPOSIT_REFUND">{t.status.DEPOSIT_REFUND}</option>
            <option value="OTHER">{t.status.OTHER}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="notes">{t.leaseDetail.notes}</label>
          <input className="input" id="notes" name="notes" defaultValue={payment.notes ?? ""} />
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" name="confirmed" defaultChecked={payment.confirmed} className="h-4 w-4 rounded border-stone-300" />
          {t.leaseDetail.confirmedLabel}
        </label>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary">{t.common.save}</button>
          <Link href={`/leases/${payment.leaseId}`} className="btn-secondary">{t.common.cancel}</Link>
        </div>
      </form>

      <div className="card space-y-4">
        <h2 className="font-semibold text-stone-900">{t.leaseDetail.receiptsHeading}</h2>
        <AttachmentGallery
          attachments={payment.attachments}
          deleteAction={deleteReceiptForPayment}
          emptyLabel={t.leaseDetail.noReceipts}
          removeLabel={t.leaseDetail.removeAttachment}
        />
        <form action={uploadReceiptForPayment} className="space-y-2 border-t border-stone-200 pt-4">
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
