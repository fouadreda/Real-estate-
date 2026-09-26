import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, toDateInputValue } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { computeLeaseLedger } from "@/lib/ledger";
import { leaseLocationHref, leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import Badge from "@/components/Badge";
import { deleteLease, updateLeaseStatus } from "@/lib/actions/leases";
import { createPayment, deletePayment } from "@/lib/actions/payments";
import { deleteLeaseAttachment, uploadLeaseAttachment } from "@/lib/actions/attachments";
import { createFollowUp } from "@/lib/actions/followUps";
import { createRentReview, markRentReviewApplied, markRentReviewLetterSent } from "@/lib/actions/rentReviews";
import AttachmentGallery from "@/components/AttachmentGallery";
import type { LeaseStatus } from "@prisma/client";

export default async function LeaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await requireUserWithDictionary();
  const lease = await prisma.lease.findUnique({
    where: { id },
    include: {
      tenant: true,
      property: { include: { building: true } },
      payments: { orderBy: { date: "desc" }, include: { recordedBy: true } },
      attachments: { orderBy: { createdAt: "desc" } },
      followUps: { orderBy: { date: "desc" } },
      rentReviews: { orderBy: { dueDate: "desc" } },
    },
  });

  if (!lease) notFound();

  const deleteLeaseWithId = deleteLease.bind(null, lease.id);
  const createPaymentForLease = createPayment.bind(null, lease.id);
  const uploadDocumentForLease = uploadLeaseAttachment.bind(null, lease.id);
  const deleteDocumentForLease = deleteLeaseAttachment.bind(null, lease.id);
  const createFollowUpForLease = createFollowUp.bind(null, lease.id);
  const createRentReviewForLease = createRentReview.bind(null, lease.id);
  const now = new Date();
  const ledger = computeLeaseLedger(lease, lease.payments, now);

  const statusOptions: LeaseStatus[] = ["ACTIVE", "PENDING", "ENDED", "TERMINATED"];

  return (
    <div className="space-y-8">
      <div>
        <Link href="/leases" className="text-sm text-brand-600 hover:underline">
          ← {t.leases.title}
        </Link>
        <div className="mt-1 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">
              <Link href={leaseLocationHref(lease)} className="hover:underline">
                {leaseLocationName(lease)}
              </Link>
            </h1>
            <p className="mt-1 text-sm text-stone-500">
              {t.leases.tenantHeader}:{" "}
              <Link href={`/tenants/${lease.tenantId}`} className="text-brand-600 hover:underline">
                {tenantDisplayName(lease.tenant)}
              </Link>
            </p>
            <p className="mt-1 text-sm text-stone-500">
              {formatDate(lease.startDate, locale)} – {lease.endDate ? formatDate(lease.endDate, locale) : t.leaseDetail.openEnded} · {formatMoney(lease.rentAmount, locale)} / {t.leaseNew.frequencyShort[lease.billingFrequency]} · {t.leaseDetail.depositLabel} {formatMoney(lease.depositAmount, locale)}
              {lease.depositLabel ? ` (${lease.depositLabel})` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lease.needsReview && <Badge status="TODO" label={t.leaseDetail.needsReview} />}
            <Badge status={lease.status} label={t.status[lease.status]} />
            <Link href={`/leases/${lease.id}/edit`} className="btn-secondary">
              {t.leaseDetail.editButton}
            </Link>
            <form action={deleteLeaseWithId}>
              <button type="submit" className="btn-danger">{t.leaseDetail.deleteButton}</button>
            </form>
          </div>
        </div>

        {lease.needsReview && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>{t.leaseDetail.needsReview}</strong>
            {lease.reviewReason ? `: ${lease.reviewReason}` : ""}
            {t.leaseDetail.needsReviewHint}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {statusOptions.map((status) => {
            const setStatus = updateLeaseStatus.bind(null, lease.id, status);
            return (
              <form key={status} action={setStatus}>
                <button
                  type="submit"
                  disabled={lease.status === status}
                  className="btn-secondary disabled:opacity-40"
                >
                  {t.leaseDetail.markStatus(t.status[status].toLowerCase())}
                </button>
              </form>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="stat-tile">
          <p className="stat-label">{t.leaseDetail.rentDueToDate}</p>
          <p className="stat-value text-xl">{formatMoney(ledger.totalAccrued, locale)}</p>
        </div>
        <div className="stat-tile">
          <p className="stat-label">{t.leaseDetail.totalPaid}</p>
          <p className="stat-value text-xl">{formatMoney(ledger.totalPaid, locale)}</p>
        </div>
        <div className="stat-tile">
          <p className="stat-label">{t.leaseDetail.unpaidBalance}</p>
          <p className={`stat-value text-xl ${ledger.unpaid > 0 ? "text-red-600" : ""}`}>
            {formatMoney(ledger.unpaid, locale)}
          </p>
        </div>
        <div className="stat-tile">
          <p className="stat-label">{t.leaseDetail.advanceCredit}</p>
          <p className={`stat-value text-xl ${ledger.advance > 0 ? "text-emerald-600" : ""}`}>
            {formatMoney(ledger.advance, locale)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-8">
          <div className="space-y-4">
            <h2 className="font-semibold text-stone-900">{t.leaseDetail.rentScheduleHeading}</h2>
            {ledger.periods.length === 0 ? (
              <div className="card text-sm text-stone-500">{t.leaseDetail.noPeriods}</div>
            ) : (
              <div className="card overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">{t.leaseDetail.dueHeader}</th>
                        <th className="px-5 py-3 font-medium">{t.leaseDetail.amountDueHeader}</th>
                        <th className="px-5 py-3 font-medium">{t.leaseDetail.amountPaidHeader}</th>
                        <th className="px-5 py-3 font-medium">{t.leaseDetail.balanceHeader}</th>
                        <th className="px-5 py-3 font-medium">{t.leaseDetail.statusHeader}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {ledger.periods.map((period) => (
                        <tr key={period.index}>
                          <td className="px-5 py-3 text-stone-600">{formatDate(period.dueDate, locale)}</td>
                          <td className="px-5 py-3 text-stone-900">{formatMoney(period.amountDue, locale)}</td>
                          <td className="px-5 py-3 text-stone-600">{formatMoney(period.amountAllocated, locale)}</td>
                          <td className={`px-5 py-3 ${period.balance > 0 ? "font-medium text-red-600" : "text-stone-400"}`}>
                            {formatMoney(period.balance, locale)}
                          </td>
                          <td className="px-5 py-3">
                            <Badge
                              status={period.isPaid ? "PAID" : period.isOverdue ? "LATE" : "PENDING"}
                              label={period.isPaid ? t.status.PAID : period.isOverdue ? t.status.LATE : t.status.PENDING}
                            />
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
            <h2 className="font-semibold text-stone-900">{t.leaseDetail.paymentsHeading}</h2>
            {lease.payments.length === 0 ? (
              <div className="card text-sm text-stone-500">{t.leaseDetail.noPayments}</div>
            ) : (
              <div className="card overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">{t.leaseDetail.dateHeader}</th>
                        <th className="px-5 py-3 font-medium">{t.leaseDetail.amount}</th>
                        <th className="px-5 py-3 font-medium">{t.leaseDetail.kind}</th>
                        <th className="px-5 py-3 font-medium">{t.leaseDetail.method}</th>
                        <th className="px-5 py-3 font-medium">{t.leaseDetail.recordedByHeader}</th>
                        <th className="px-5 py-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {lease.payments.map((payment) => {
                        const removePayment = deletePayment.bind(null, payment.id, lease.id);
                        return (
                          <tr key={payment.id}>
                            <td className="px-5 py-3 text-stone-600">{formatDate(payment.date, locale)}</td>
                            <td className="px-5 py-3 text-stone-900">
                              {formatMoney(payment.amount, locale)}
                              {!payment.confirmed && (
                                <span className="ml-2"><Badge status="TODO" label={t.leaseDetail.unconfirmed} /></span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-stone-600">{t.status[payment.kind]}</td>
                            <td className="px-5 py-3 text-stone-600">{payment.method ?? <span className="text-stone-400">—</span>}</td>
                            <td className="px-5 py-3 text-stone-600">
                              {payment.recordedBy?.name ?? <span className="text-stone-400">—</span>}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <div className="flex items-center justify-end gap-3">
                                <Link href={`/leases/${lease.id}/payments/${payment.id}/edit`} className="text-sm text-brand-600 hover:underline">
                                  {t.common.edit}
                                </Link>
                                <form action={removePayment}>
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
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="font-semibold text-stone-900">{t.leaseDetail.followUpsHeading}</h2>
            {lease.followUps.length === 0 ? (
              <div className="card text-sm text-stone-500">{t.leaseDetail.noFollowUps}</div>
            ) : (
              <div className="space-y-2">
                {lease.followUps.map((f) => (
                  <div key={f.id} className="card">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-stone-900">
                          {formatDate(f.date, locale)} · {t.status[f.action]}
                        </p>
                        {f.response && <p className="mt-1 text-sm text-stone-600">{f.response}</p>}
                        {f.promiseDate && (
                          <p className="mt-1 text-sm text-stone-500">
                            {t.leaseDetail.promised}: {formatDate(f.promiseDate, locale)}
                            {f.promiseAmount ? ` · ${formatMoney(f.promiseAmount, locale)}` : ""}
                          </p>
                        )}
                      </div>
                      <Badge status={f.result} label={t.status[f.result]} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <form action={createFollowUpForLease} className="card space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="fu-date">{t.leaseDetail.dateHeader}</label>
                  <input className="input" id="fu-date" name="date" type="date" required defaultValue={toDateInputValue(new Date())} />
                </div>
                <div>
                  <label className="label" htmlFor="fu-action">{t.leaseDetail.followUpAction}</label>
                  <select className="input" id="fu-action" name="action" defaultValue="CALL_VISIT">
                    <option value="CALL_VISIT">{t.status.CALL_VISIT}</option>
                    <option value="SMS_WHATSAPP">{t.status.SMS_WHATSAPP}</option>
                    <option value="LETTER">{t.status.LETTER}</option>
                    <option value="FORMAL_NOTICE">{t.status.FORMAL_NOTICE}</option>
                    <option value="LAWYER">{t.status.LAWYER}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="fu-response">{t.leaseDetail.response}</label>
                <input className="input" id="fu-response" name="response" placeholder="Optional" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="fu-promiseDate">{t.leaseDetail.promiseDate}</label>
                  <input className="input" id="fu-promiseDate" name="promiseDate" type="date" />
                </div>
                <div>
                  <label className="label" htmlFor="fu-promiseAmount">{t.leaseDetail.promiseAmount}</label>
                  <input className="input" id="fu-promiseAmount" name="promiseAmount" type="number" min="0" step="0.01" />
                </div>
              </div>
              <button type="submit" className="btn-secondary w-full">{t.leaseDetail.logFollowUp}</button>
            </form>
          </div>

          <div className="space-y-4">
            <h2 className="font-semibold text-stone-900">{t.leaseRevision.heading}</h2>
            {lease.rentReviews.length === 0 ? (
              <div className="card text-sm text-stone-500">{t.leaseRevision.noneSet}</div>
            ) : (
              <div className="space-y-2">
                {lease.rentReviews.map((r) => {
                  const sendLetter = markRentReviewLetterSent.bind(null, r.id, lease.id);
                  const applyReview = markRentReviewApplied.bind(null, r.id, lease.id);
                  return (
                    <div key={r.id} className="card">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium text-stone-900">
                            {formatDate(r.dueDate, locale)} · +{(r.rate * 100).toFixed(1)}%
                          </p>
                          <p className="mt-1 text-xs text-stone-500">
                            {r.letterSentAt ? `${t.leaseRevision.letterSent} ${formatDate(r.letterSentAt, locale)}` : t.leaseRevision.letterNotSent}
                            {r.appliedAt ? ` · ${t.leaseRevision.applied} ${formatDate(r.appliedAt, locale)}` : ""}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {!r.letterSentAt && (
                            <form action={sendLetter}>
                              <button type="submit" className="text-sm text-brand-600 hover:underline">{t.leaseRevision.markLetterSent}</button>
                            </form>
                          )}
                          {!r.appliedAt && (
                            <form action={applyReview}>
                              <button type="submit" className="text-sm text-brand-600 hover:underline">{t.leaseRevision.markApplied}</button>
                            </form>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <form action={createRentReviewForLease} className="card space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="rr-dueDate">{t.leaseRevision.nextRevisionDate}</label>
                  <input className="input" id="rr-dueDate" name="dueDate" type="date" required />
                </div>
                <div>
                  <label className="label" htmlFor="rr-rate">{t.leaseRevision.rate}</label>
                  <input className="input" id="rr-rate" name="rate" type="number" min="0" step="0.1" required />
                </div>
              </div>
              <button type="submit" className="btn-secondary w-full">{t.leaseRevision.schedule}</button>
            </form>
          </div>
        </div>

        <div className="card h-fit">
          <h2 className="mb-4 font-semibold text-stone-900">{t.leaseDetail.recordPaymentHeading}</h2>
          <form action={createPaymentForLease} className="space-y-3">
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
                defaultValue={ledger.unpaid > 0 ? ledger.unpaid : lease.rentAmount}
              />
            </div>
            <div>
              <label className="label" htmlFor="date">{t.leaseDetail.dateHeader}</label>
              <input className="input" id="date" name="date" type="date" required defaultValue={toDateInputValue(new Date())} />
            </div>
            <div>
              <label className="label" htmlFor="method">{t.leaseDetail.method}</label>
              <input className="input" id="method" name="method" placeholder="e.g. bank transfer" />
            </div>
            <div>
              <label className="label" htmlFor="notes">{t.leaseDetail.notes}</label>
              <input className="input" id="notes" name="notes" placeholder="Optional" />
            </div>
            <div>
              <label className="label" htmlFor="file">{t.leaseDetail.receiptOptional}</label>
              <input
                className="input"
                id="file"
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              />
              <p className="mt-1 text-xs text-stone-500">{t.leaseDetail.attachmentHint}</p>
            </div>
            <p className="text-xs text-stone-500">{t.leaseDetail.recordPaymentHint}</p>
            <button type="submit" className="btn-primary w-full">{t.leaseDetail.addPayment}</button>
          </form>
        </div>

        <div className="card h-fit lg:col-start-3">
          <h2 className="mb-4 font-semibold text-stone-900">{t.leaseDetail.documentsHeading}</h2>
          <AttachmentGallery
            attachments={lease.attachments}
            deleteAction={deleteDocumentForLease}
            emptyLabel={t.leaseDetail.noDocuments}
            removeLabel={t.leaseDetail.removeAttachment}
          />
          <form action={uploadDocumentForLease} className="mt-4 space-y-2 border-t border-stone-200 pt-4">
            <input
              className="input"
              type="file"
              name="file"
              required
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            />
            <p className="text-xs text-stone-500">{t.leaseDetail.attachmentHint}</p>
            <button type="submit" className="btn-secondary w-full">{t.leaseDetail.uploadDocument}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
