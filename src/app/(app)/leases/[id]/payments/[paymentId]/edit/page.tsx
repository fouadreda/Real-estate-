import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatMoney, toDateInputValue } from "@/lib/format";
import { updatePayment } from "@/lib/actions/payments";
import { deletePaymentAttachment, uploadPaymentAttachment } from "@/lib/actions/attachments";
import AttachmentGallery from "@/components/AttachmentGallery";
import { requireUserWithDictionary } from "@/lib/auth";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import FileInput from "@/components/FileInput";
import SubmitButton from "@/components/SubmitButton";
import { safeBackPath } from "@/lib/backPath";
import { monthlyEquivalentRent } from "@/lib/ledger";

export default async function EditPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; paymentId: string }>;
  searchParams: Promise<{ error?: string; back?: string }>;
}) {
  const { id, paymentId } = await params;
  const { error, back: backParam } = await searchParams;
  const back = safeBackPath(backParam);
  const { t, locale } = await requireUserWithDictionary();
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      lease: { include: { property: { include: { building: true } }, tenant: true } },
      attachments: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!payment || payment.leaseId !== id) notFound();

  // every lease, so a payment recorded on the wrong tenant or unit can be moved to the right one:
  // the same tenant's leases first, then the others by building
  const leases = await prisma.lease.findMany({ include: { tenant: true, property: { include: { building: true } } } });
  // the monthly rent is shown so staff can check the months a moved rent payment pays on its new lease
  const optionLabel = (l: (typeof leases)[number]) =>
    `${leaseLocationName(l)} — ${tenantDisplayName(l.tenant)} · ${t.leaseDetail.perMonth(formatMoney(monthlyEquivalentRent(l.rentAmount, l.billingFrequency), locale))}${l.status === "ENDED" || l.status === "TERMINATED" ? ` (${t.status.ENDED.toLowerCase()})` : ""}`;
  const byLabel = (a: (typeof leases)[number], b: (typeof leases)[number]) => optionLabel(a).localeCompare(optionLabel(b), "fr");
  const sameTenant = leases.filter((l) => l.tenantId === payment.lease.tenantId).sort(byLabel);
  const groups = new Map<string, typeof leases>();
  for (const l of leases.filter((x) => x.tenantId !== payment.lease.tenantId).sort(byLabel)) {
    const name = l.property.building?.name ?? "—";
    groups.set(name, [...(groups.get(name) ?? []), l]);
  }
  const cancelHref = back ?? `/leases/${payment.leaseId}`;

  const updatePaymentWithIds = updatePayment.bind(null, payment.id, payment.leaseId);
  const uploadReceiptForPayment = uploadPaymentAttachment.bind(null, payment.leaseId, payment.id);
  const deleteReceiptForPayment = deletePaymentAttachment.bind(null, payment.leaseId, payment.id);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href={cancelHref} className="text-sm text-brand-600 hover:underline">
          ← {back ? t.common.goBack : leaseLocationName(payment.lease)}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{t.leaseDetail.editPaymentTitle}</h1>
        <p className="mt-1 text-sm text-stone-500">
          {tenantDisplayName(payment.lease.tenant)}
        </p>
      </div>

      <form action={updatePaymentWithIds} className="card space-y-4">
        {(error === "amount" || error === "months" || error === "lease" || error === "stale") && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error === "amount"
              ? t.leaseDetail.paymentErrorAmount
              : error === "lease"
                ? t.leaseDetail.paymentErrorLease
                : error === "stale"
                  ? t.leaseDetail.paymentErrorStale
                  : t.leaseDetail.paymentErrorMonthsEdit}
          </p>
        )}
        {back && <input type="hidden" name="back" value={back} />}
        <div>
          <label className="label" htmlFor="leaseId">{t.leaseDetail.paymentLease}</label>
          <select className="input" id="leaseId" name="leaseId" defaultValue={payment.leaseId}>
            <optgroup label={t.leaseDetail.sameTenant}>
              {sameTenant.map((l) => (
                <option key={l.id} value={l.id}>{optionLabel(l)}</option>
              ))}
            </optgroup>
            {[...groups.entries()]
              .sort(([a], [b]) => a.localeCompare(b, "fr"))
              .map(([name, list]) => (
                <optgroup key={name} label={name}>
                  {list.map((l) => (
                    <option key={l.id} value={l.id}>{optionLabel(l)}</option>
                  ))}
                </optgroup>
              ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">{t.leaseDetail.paymentLeaseHelp}</p>
        </div>
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
          <label className="label" htmlFor="months">{t.leaseDetail.monthsForKind}</label>
          <input
            className="input !w-28"
            id="months"
            name="months"
            type="number"
            inputMode="numeric"
            min={0}
            max={60}
            step={1}
            defaultValue={payment.monthsCovered ?? ""}
          />
          <p className="mt-1 text-xs text-stone-500">{t.leaseDetail.monthsEditHelp}</p>
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
          <SubmitButton className="btn-primary" pendingLabel={t.leaseDetail.saving}>{t.common.save}</SubmitButton>
          <Link href={cancelHref} className="btn-secondary">{t.common.cancel}</Link>
        </div>
      </form>

      <div className="card space-y-4">
        <h2 className="font-semibold text-stone-900">{t.leaseDetail.receiptsHeading}</h2>
        <AttachmentGallery
          attachments={payment.attachments}
          deleteAction={deleteReceiptForPayment}
          emptyLabel={t.leaseDetail.noReceipts}
          removeLabel={t.leaseDetail.removeAttachment}
          confirmMessage={t.leaseDetail.removeAttachmentConfirm}
          cancelLabel={t.common.cancel}
        />
        <form action={uploadReceiptForPayment} className="space-y-2 border-t border-stone-200 pt-4">
          <FileInput required invalidMessage={t.formErrors.file} />
          <p className="text-xs text-stone-500">{t.leaseDetail.attachmentHint}</p>
          <SubmitButton className="btn-secondary w-full" pendingLabel={t.leaseDetail.saving}>{t.leaseDetail.uploadReceipt}</SubmitButton>
        </form>
      </div>
    </div>
  );
}
