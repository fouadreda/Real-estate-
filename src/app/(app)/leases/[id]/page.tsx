import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, toDateInputValue } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { cashAmount, computeLeaseLedger, leaseDisplayStatus, monthlyEquivalentRent, paymentStatusFor, paymentsWithPaidUntil } from "@/lib/ledger";
import { getSettings } from "@/lib/settings";
import { leaseLocationHref, leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import Badge from "@/components/Badge";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { deleteLease, setLeaseVerified, updateLeaseStatus } from "@/lib/actions/leases";
import { createPayment, deletePayment } from "@/lib/actions/payments";
import { deleteLeaseAttachment, uploadLeaseAttachment } from "@/lib/actions/attachments";
import { createFollowUp, deleteFollowUp, updateFollowUp, updateFollowUpResult } from "@/lib/actions/followUps";
import {
  createRentReview,
  deleteRentReview,
  markRentReviewApplied,
  markRentReviewLetterNotSent,
  markRentReviewLetterSent,
  unapplyRentReview,
  updateRentReview,
} from "@/lib/actions/rentReviews";
import AttachmentGallery from "@/components/AttachmentGallery";
import { rentBeforeReview } from "@/lib/rentReview";
import PaymentForm from "@/components/PaymentForm";
import type { LeaseStatus, PaymentKind } from "@prisma/client";
import FileInput from "@/components/FileInput";
import ScrollIntoView from "@/components/ScrollIntoView";
import FormError from "@/components/FormError";
import SubmitButton from "@/components/SubmitButton";

const PAYMENT_KINDS: PaymentKind[] = ["RENT", "ARREARS", "ADVANCE_AT_ENTRY", "DEPOSIT", "DEPOSIT_REFUND", "OTHER"];
// a new payment for months paid ahead is recorded as Rent with its number of months (that is what moves
// "paid until"); the advance-at-entry kind only exists for imported history
const NEW_PAYMENT_KINDS = PAYMENT_KINDS.filter((kind) => kind !== "ADVANCE_AT_ENTRY");
const FOLLOW_UP_ACTIONS = ["CALL_VISIT", "SMS_WHATSAPP", "LETTER", "FORMAL_NOTICE", "LAWYER"] as const;
const FOLLOW_UP_RESULTS = ["PENDING", "PAID", "PARTIAL", "BROKEN"] as const;

export default async function LeaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string; paymentError?: string; paymentSaved?: string; formError?: string; error?: string }>;
}) {
  const { id } = await params;
  const { kind: kindParam, paymentError, paymentSaved, formError, error: pageError } = await searchParams;
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
  // the history is a help, never a reason for the lease page to fail
  const history = await prisma.changeLog.findMany({ where: { leaseId: lease.id }, orderBy: { at: "desc" }, take: 15 }).catch(() => []);
  const historyWhen = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  const deleteLeaseWithId = deleteLease.bind(null, lease.id);
  const createPaymentForLease = createPayment.bind(null, lease.id);
  const uploadDocumentForLease = uploadLeaseAttachment.bind(null, lease.id);
  const deleteDocumentForLease = deleteLeaseAttachment.bind(null, lease.id);
  const createFollowUpForLease = createFollowUp.bind(null, lease.id);
  const createRentReviewForLease = createRentReview.bind(null, lease.id);
  const now = new Date();
  const { overdueDays } = await getSettings();
  const ledger = computeLeaseLedger(lease, lease.payments, now);
  const displayStatus = leaseDisplayStatus(lease, now);
  const payStatus = paymentStatusFor(ledger.paidUntil, now, overdueDays);
  const paymentMonths = paymentsWithPaidUntil(lease, lease.payments);
  const showPayStatus = displayStatus === "ACTIVE" || displayStatus === "ENDING_SOON" || displayStatus === "EXPIRED_OCCUPYING";

  const depositInCashbook = lease.payments
    .filter((p) => p.confirmed && (p.kind === "DEPOSIT" || p.kind === "DEPOSIT_REFUND"))
    .reduce((sum, p) => sum + cashAmount(p), 0);
  const depositStillToRecord = Math.max(lease.depositAmount - depositInCashbook, 0);
  const preselectedKind: PaymentKind =
    kindParam && (NEW_PAYMENT_KINDS as string[]).includes(kindParam) ? (kindParam as PaymentKind) : "RENT";
  // "Upcoming" only makes sense before the start date (an upcoming lease turns active by itself on that day).
  const statusOptions: LeaseStatus[] = lease.startDate > now ? ["ACTIVE", "PENDING", "ENDED", "TERMINATED"] : ["ACTIVE", "ENDED", "TERMINATED"];
  const markVerified = setLeaseVerified.bind(null, lease.id, true);
  const markToCheck = setLeaseVerified.bind(null, lease.id, false);
  const paymentErrorMessage =
    paymentError === "amount"
      ? t.leaseDetail.paymentErrorAmount
      : paymentError === "months"
        ? t.leaseDetail.paymentErrorMonths
        : paymentError === "file"
          ? t.leaseDetail.paymentErrorFile
          : paymentError === "upload"
            ? t.leaseDetail.paymentErrorUpload
            : null;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/leases" className="text-sm text-brand-600 hover:underline">
          ← {t.leases.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
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
            {lease.closedAt && (
              <p className="mt-1 text-sm font-medium text-amber-700">{t.leaseDetail.closedOn(formatDate(lease.closedAt, locale))}</p>
            )}
            {showPayStatus && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-700">
                <span className="font-medium text-stone-900">
                  {t.leaseDetail.paidUntil} {formatDate(ledger.paidUntil, locale)}
                </span>
                <Badge status={payStatus.status} label={t.status[payStatus.status]} />
                {payStatus.daysLate > 0 && <span className="text-red-600">{t.leaseDetail.daysLate(payStatus.daysLate)}</span>}
              </p>
            )}
            {(lease.depositAmount > 0 || depositInCashbook !== 0) && (
              <p className="mt-1 text-sm text-stone-500">
                {t.leaseDetail.depositInCashbook(formatMoney(depositInCashbook, locale))}
                {depositStillToRecord > 0 && (
                  <>
                    {" · "}
                    <Link href={`/leases/${lease.id}?kind=DEPOSIT#record-payment`} className="text-brand-600 hover:underline">
                      {t.leaseDetail.recordDeposit}
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {lease.needsReview && <Badge status="TODO" label={t.leaseDetail.needsReview} />}
            <Badge status={displayStatus} label={t.status[displayStatus]} />
            <Link href={`/leases/${lease.id}/edit`} className="btn-secondary">
              {t.leaseDetail.editButton}
            </Link>
            <form action={deleteLeaseWithId}>
              <ConfirmSubmitButton
                confirmMessage={t.common.confirmDelete}
                confirmLabel={t.common.confirmDeleteYes}
                cancelLabel={t.common.cancel}
                className="btn-danger"
              >
                {t.leaseDetail.deleteButton}
              </ConfirmSubmitButton>
            </form>
          </div>
        </div>

        {pageError && (
          <div className="mt-4">
            <ScrollIntoView>
              <FormError code={pageError} messages={t.formErrors} />
            </ScrollIntoView>
          </div>
        )}

        {lease.needsReview && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="min-w-0 flex-1">
              <strong>{t.leaseDetail.needsReview}</strong>
              {lease.reviewReason ? `: ${lease.reviewReason}` : ""}
              {t.leaseDetail.needsReviewHint}
            </p>
            <form action={markVerified}>
              <ConfirmSubmitButton
                confirmMessage={t.leaseDetail.markVerifiedConfirm}
                confirmLabel={t.leaseDetail.markVerified}
                cancelLabel={t.common.cancel}
                className="btn-secondary"
              >
                {t.leaseDetail.markVerified}
              </ConfirmSubmitButton>
            </form>
          </div>
        )}
        {!lease.needsReview && lease.reviewReason && (
          <form action={markToCheck} className="mt-2">
            <button type="submit" className="text-xs text-stone-500 hover:underline">{t.leaseDetail.markToCheck}</button>
          </form>
        )}

        {/* one form: the closing date is sent with "ended" / "terminated" (rent stops being billed that day) */}
        <form className="mt-4 flex flex-wrap items-end gap-2" action={updateLeaseStatus.bind(null, lease.id, lease.status)}>
          {/* Enter in the date box presses the first enabled button of the form: this one, which keeps the
              status (it saves the closing date of a closed lease, and changes nothing on an open one) */}
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
          {statusOptions.map((status) => (
            <button
              key={status}
              type="submit"
              formAction={updateLeaseStatus.bind(null, lease.id, status)}
              disabled={lease.status === status}
              className="btn-secondary disabled:opacity-40"
            >
              {t.leaseDetail.markStatus(t.status[status === "PENDING" ? "UPCOMING" : status].toLowerCase())}
            </button>
          ))}
          <label className="flex items-center gap-2 text-sm text-stone-600">
            {t.leaseDetail.closingDate}
            <input
              className="input !w-40"
              type="date"
              name="closedAt"
              // a closed lease without a recorded closing day (imported) shows its end date when already past,
              // else nothing (never today, never a date the server would refuse)
              defaultValue={
                lease.closedAt
                  ? toDateInputValue(lease.closedAt)
                  : lease.status === "ENDED" || lease.status === "TERMINATED"
                    ? lease.endDate && lease.endDate <= now
                      ? toDateInputValue(lease.endDate)
                      : ""
                    : toDateInputValue(now)
              }
              aria-label={t.leaseDetail.closingDate}
            />
          </label>
          {(lease.status === "ENDED" || lease.status === "TERMINATED") && (
            // the form's own action keeps the status and saves a corrected closing date
            <button type="submit" className="btn-secondary">{t.leaseDetail.saveClosingDate}</button>
          )}
        </form>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-8 lg:col-span-2">
          <div className="space-y-4">
            <h2 className="font-semibold text-stone-900">{t.leaseDetail.rentScheduleHeading}</h2>
            {ledger.periods.length === 0 ? (
              <div className="card text-sm text-stone-500">{t.leaseDetail.noPeriods}</div>
            ) : (
              <div className="card overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">{t.leaseDetail.dueHeader}</th>
                        <th className="px-4 py-3 font-medium">{t.leaseDetail.amountDueHeader}</th>
                        <th className="px-4 py-3 font-medium">{t.leaseDetail.amountPaidHeader}</th>
                        <th className="px-4 py-3 font-medium">{t.leaseDetail.balanceHeader}</th>
                        <th className="px-4 py-3 font-medium">{t.leaseDetail.statusHeader}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {ledger.periods.map((period) => (
                        <tr key={period.index}>
                          <td className="px-4 py-3 text-stone-600">{formatDate(period.dueDate, locale)}</td>
                          <td className="px-4 py-3 text-stone-900">{formatMoney(period.amountDue, locale)}</td>
                          <td className="px-4 py-3 text-stone-600">{formatMoney(period.amountAllocated, locale)}</td>
                          <td className={`px-4 py-3 ${period.balance > 0 ? "font-medium text-red-600" : "text-stone-400"}`}>
                            {formatMoney(period.balance, locale)}
                          </td>
                          <td className="px-4 py-3">
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
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">{t.leaseDetail.dateHeader}</th>
                        <th className="px-4 py-3 font-medium">{t.leaseDetail.amount}</th>
                        <th className="px-4 py-3 font-medium">{t.leaseDetail.kind}</th>
                        <th className="px-4 py-3 font-medium">{t.leaseDetail.monthsHeader}</th>
                        <th className="px-4 py-3 font-medium">{t.leaseDetail.paidUntilHeader}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {lease.payments.map((payment) => {
                        const removePayment = deletePayment.bind(null, payment.id, lease.id);
                        const months = paymentMonths.get(payment.id);
                        const details = [payment.method, payment.recordedBy?.name].filter(Boolean).join(" · ");
                        return (
                          <tr key={payment.id} className="align-top">
                            <td className="px-4 py-3 text-stone-600">
                              <span className="whitespace-nowrap">{formatDate(payment.date, locale)}</span>
                              {/* the row actions sit under the date so they are never pushed off screen */}
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/leases/${lease.id}/payments/${payment.id}/edit`}
                                  className="inline-flex min-h-8 items-center rounded-lg px-2 text-xs font-medium text-brand-600 hover:bg-stone-100"
                                >
                                  {t.common.edit}
                                </Link>
                                <form action={removePayment}>
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
                            <td className="whitespace-nowrap px-4 py-3 text-stone-900">
                              {formatMoney(payment.amount, locale)}
                              {!payment.confirmed && (
                                <span className="mt-1 block"><Badge status="TODO" label={t.leaseDetail.unconfirmed} /></span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-stone-600">
                              {t.status[payment.kind]}
                              {details && <span className="block text-xs text-stone-400">{details}</span>}
                            </td>
                            {months ? (
                              <>
                                <td className="whitespace-nowrap px-4 py-3 text-stone-600">{t.leaseDetail.monthsUnit(months.months)}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-stone-600">{formatDate(months.paidUntil, locale)}</td>
                              </>
                            ) : payment.confirmed && (payment.kind === "RENT" || payment.kind === "ARREARS") ? (
                              <td colSpan={2} className="px-4 py-3 text-xs text-stone-400">{t.leaseDetail.notCounted}</td>
                            ) : (
                              <>
                                <td className="px-4 py-3 text-stone-400">—</td>
                                <td className="px-4 py-3 text-stone-400">—</td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div id="follow-ups" className="scroll-mt-4 space-y-4">
            <h2 className="font-semibold text-stone-900">{t.leaseDetail.followUpsHeading}</h2>
            {formError === "followup" && (
              <ScrollIntoView>
                <FormError code={formError} messages={t.formErrors} />
              </ScrollIntoView>
            )}
            {lease.followUps.length === 0 ? (
              <div className="card text-sm text-stone-500">{t.leaseDetail.noFollowUps}</div>
            ) : (
              <div className="space-y-2">
                {lease.followUps.map((f) => {
                  const removeFollowUp = deleteFollowUp.bind(null, f.id, lease.id);
                  const markPaid = updateFollowUpResult.bind(null, f.id, lease.id, "PAID");
                  const markBroken = updateFollowUpResult.bind(null, f.id, lease.id, "BROKEN");
                  return (
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
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <Badge status={f.result} label={t.status[f.result]} />
                          {f.result === "PENDING" && (
                            <div className="flex gap-2">
                              <form action={markPaid}>
                                <button type="submit" className="text-xs text-brand-600 hover:underline">{t.leaseDetail.markPaid}</button>
                              </form>
                              <form action={markBroken}>
                                <button type="submit" className="text-xs text-red-600 hover:underline">{t.leaseDetail.markBroken}</button>
                              </form>
                            </div>
                          )}
                          <form action={removeFollowUp}>
                            <ConfirmSubmitButton
                              confirmMessage={t.common.confirmDelete}
                              confirmLabel={t.common.confirmDeleteYes}
                              cancelLabel={t.common.cancel}
                              className="text-xs text-stone-500 hover:underline"
                            >
                              {t.common.delete}
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      </div>
                      <details className="mt-2 border-t border-stone-100 pt-2">
                        <summary className="inline-flex min-h-8 cursor-pointer items-center text-xs font-medium text-brand-600">{t.common.edit}</summary>
                        <form action={updateFollowUp.bind(null, f.id, lease.id)} className="mt-2 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="label" htmlFor={`fu-date-${f.id}`}>{t.leaseDetail.dateHeader}</label>
                              <input className="input" id={`fu-date-${f.id}`} name="date" type="date" required defaultValue={toDateInputValue(f.date)} />
                            </div>
                            <div>
                              <label className="label" htmlFor={`fu-action-${f.id}`}>{t.leaseDetail.followUpAction}</label>
                              <select className="input" id={`fu-action-${f.id}`} name="action" defaultValue={f.action}>
                                {FOLLOW_UP_ACTIONS.map((a) => (
                                  <option key={a} value={a}>{t.status[a]}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="label" htmlFor={`fu-response-${f.id}`}>{t.leaseDetail.response}</label>
                            <input className="input" id={`fu-response-${f.id}`} name="response" defaultValue={f.response ?? ""} />
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                              <label className="label" htmlFor={`fu-pd-${f.id}`}>{t.leaseDetail.promiseDate}</label>
                              <input className="input" id={`fu-pd-${f.id}`} name="promiseDate" type="date" defaultValue={f.promiseDate ? toDateInputValue(f.promiseDate) : ""} />
                            </div>
                            <div>
                              <label className="label" htmlFor={`fu-pa-${f.id}`}>{t.leaseDetail.promiseAmount}</label>
                              <input className="input" id={`fu-pa-${f.id}`} name="promiseAmount" type="number" min="0" step="0.01" defaultValue={f.promiseAmount ?? ""} />
                            </div>
                            <div>
                              <label className="label" htmlFor={`fu-result-${f.id}`}>{t.leaseDetail.followUpResult}</label>
                              <select className="input" id={`fu-result-${f.id}`} name="result" defaultValue={f.result}>
                                {FOLLOW_UP_RESULTS.map((r) => (
                                  <option key={r} value={r}>{t.status[r]}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <SubmitButton className="btn-secondary" pendingLabel={t.leaseDetail.saving}>{t.common.save}</SubmitButton>
                        </form>
                      </details>
                    </div>
                  );
                })}
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
                <input className="input" id="fu-response" name="response" placeholder={t.leaseDetail.optional} />
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
              <SubmitButton className="btn-secondary w-full" pendingLabel={t.leaseDetail.saving}>{t.leaseDetail.logFollowUp}</SubmitButton>
            </form>
          </div>

          <div className="space-y-4">
            <h2 id="rent-review" className="scroll-mt-4 font-semibold text-stone-900">{t.leaseRevision.heading}</h2>
            {formError === "review" && (
              <ScrollIntoView>
                <FormError code={formError} messages={t.formErrors} />
              </ScrollIntoView>
            )}
            {lease.rentReviews.length === 0 ? (
              <div className="card text-sm text-stone-500">{t.leaseRevision.noneSet}</div>
            ) : (
              <div className="space-y-2">
                {lease.rentReviews.map((r) => {
                  const sendLetter = markRentReviewLetterSent.bind(null, r.id, lease.id);
                  const applyReview = markRentReviewApplied.bind(null, r.id, lease.id);
                  const removeReview = deleteRentReview.bind(null, r.id, lease.id);
                  const letterNotSent = markRentReviewLetterNotSent.bind(null, r.id, lease.id);
                  const unapplyReview = unapplyRentReview.bind(null, r.id, lease.id);
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
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {!r.letterSentAt ? (
                            <form action={sendLetter}>
                              <button type="submit" className="text-sm text-brand-600 hover:underline">{t.leaseRevision.markLetterSent}</button>
                            </form>
                          ) : (
                            <form action={letterNotSent}>
                              <button type="submit" className="text-sm text-stone-500 hover:underline">{t.leaseRevision.markLetterNotSent}</button>
                            </form>
                          )}
                          {/* separate keys: the confirm step of one button never carries over to the other */}
                          {!r.appliedAt ? (
                            <form key="apply" action={applyReview}>
                              <ConfirmSubmitButton
                                confirmMessage={t.leaseRevision.applyConfirm(formatMoney(lease.rentAmount, locale), formatMoney(Math.round(lease.rentAmount * (1 + r.rate)), locale))}
                                confirmLabel={t.leaseRevision.markApplied}
                                cancelLabel={t.common.cancel}
                                className="text-sm text-brand-600 hover:underline"
                              >
                                {t.leaseRevision.markApplied}
                              </ConfirmSubmitButton>
                            </form>
                          ) : (
                            <form key="unapply" action={unapplyReview}>
                              <ConfirmSubmitButton
                                confirmMessage={t.leaseRevision.unapplyConfirm(formatMoney(lease.rentAmount, locale), formatMoney(rentBeforeReview(r, lease.rentAmount), locale))}
                                confirmLabel={t.leaseRevision.unapply}
                                cancelLabel={t.common.cancel}
                                className="text-sm text-amber-700 hover:underline"
                              >
                                {t.leaseRevision.unapply}
                              </ConfirmSubmitButton>
                            </form>
                          )}
                          <form action={removeReview}>
                            <ConfirmSubmitButton
                              confirmMessage={
                                r.appliedAt
                                  ? t.leaseRevision.deleteAppliedConfirm(formatMoney(lease.rentAmount, locale), formatMoney(rentBeforeReview(r, lease.rentAmount), locale))
                                  : t.common.confirmDelete
                              }
                              confirmLabel={t.common.confirmDeleteYes}
                              cancelLabel={t.common.cancel}
                              className="text-sm text-red-600 hover:underline"
                            >
                              {t.common.delete}
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      </div>
                      {!r.appliedAt && (
                        <details className="mt-2 border-t border-stone-100 pt-2">
                          <summary className="inline-flex min-h-8 cursor-pointer items-center text-xs font-medium text-brand-600">{t.common.edit}</summary>
                          <form action={updateRentReview.bind(null, r.id, lease.id)} className="mt-2 grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                            <div>
                              <label className="label" htmlFor={`rr-due-${r.id}`}>{t.leaseRevision.nextRevisionDate}</label>
                              <input className="input" id={`rr-due-${r.id}`} name="dueDate" type="date" required defaultValue={toDateInputValue(r.dueDate)} />
                            </div>
                            <div>
                              <label className="label" htmlFor={`rr-rate-${r.id}`}>{t.leaseRevision.rate}</label>
                              <input className="input" id={`rr-rate-${r.id}`} name="rate" type="number" min="0" step="any" required defaultValue={Number((r.rate * 100).toPrecision(10))} />
                            </div>
                            <SubmitButton className="btn-secondary" pendingLabel={t.leaseDetail.saving}>{t.common.save}</SubmitButton>
                          </form>
                        </details>
                      )}
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
              <SubmitButton className="btn-secondary w-full" pendingLabel={t.leaseDetail.saving}>{t.leaseRevision.schedule}</SubmitButton>
            </form>
          </div>
        </div>

        {/* right column on laptops: record a payment, documents, history (one column, so they stay at the top) */}
        <div className="min-w-0 space-y-6">
          <div id="record-payment" className="card h-fit min-w-0 scroll-mt-4">
            <h2 className="mb-4 font-semibold text-stone-900">{t.leaseDetail.recordPaymentHeading}</h2>
            {paymentErrorMessage && (
              <ScrollIntoView>
                <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{paymentErrorMessage}</p>
              </ScrollIntoView>
            )}
            {paymentSaved && !paymentErrorMessage && (
              <ScrollIntoView>
                <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{t.leaseDetail.paymentSaved}</p>
              </ScrollIntoView>
            )}
            <PaymentForm
              action={createPaymentForLease}
              kinds={NEW_PAYMENT_KINDS.map((kind) => ({ value: kind, label: t.status[kind] }))}
              defaultKind={preselectedKind}
              rentPerMonth={monthlyEquivalentRent(lease.rentAmount, lease.billingFrequency)}
              billingStartIso={toDateInputValue(lease.ledgerStartDate ?? lease.startDate)}
              paidMonths={ledger.paidMonths}
              defaultOtherAmount={preselectedKind === "DEPOSIT" ? depositStillToRecord || lease.depositAmount || "" : ""}
              todayIso={toDateInputValue(now)}
              locale={locale}
              labels={{
                kind: t.leaseDetail.kind,
                monthsPaid: t.leaseDetail.monthsPaid,
                monthsHelp: t.leaseDetail.monthsHelp,
                amount: t.leaseDetail.amount,
                date: t.leaseDetail.dateHeader,
                method: t.leaseDetail.method,
                methodPlaceholder: t.leaseDetail.methodPlaceholder,
                notes: t.leaseDetail.notes,
                notesPlaceholder: t.leaseDetail.optional,
                receiptOptional: t.leaseDetail.receiptOptional,
                attachmentHint: t.leaseDetail.attachmentHint,
                recordPaymentHint: t.leaseDetail.recordPaymentHint,
                nonRentHint: t.leaseDetail.nonRentHint,
                submit: t.leaseDetail.addPayment,
                saving: t.leaseDetail.saving,
                fileInvalid: t.formErrors.file,
                previewTemplate: t.leaseDetail.paysPeriodTemplate,
              }}
            />
          </div>

          <div className="card h-fit min-w-0">
            <h2 className="mb-4 font-semibold text-stone-900">{t.leaseDetail.documentsHeading}</h2>
            <AttachmentGallery
              attachments={lease.attachments}
              deleteAction={deleteDocumentForLease}
              emptyLabel={t.leaseDetail.noDocuments}
              removeLabel={t.leaseDetail.removeAttachment}
            confirmMessage={t.leaseDetail.removeAttachmentConfirm}
            cancelLabel={t.common.cancel}
            />
            <form action={uploadDocumentForLease} className="mt-4 space-y-2 border-t border-stone-200 pt-4">
              <FileInput required invalidMessage={t.formErrors.file} />
              <p className="text-xs text-stone-500">{t.leaseDetail.attachmentHint}</p>
              <SubmitButton className="btn-secondary w-full" pendingLabel={t.leaseDetail.saving}>{t.leaseDetail.uploadDocument}</SubmitButton>
            </form>
          </div>

          {/* who changed what on this lease (payments, terms, reviews, follow-ups) */}
          <div className="card h-fit min-w-0">
            <h2 className="mb-3 font-semibold text-stone-900">{t.leaseDetail.historyHeading}</h2>
            {history.length === 0 ? (
              <p className="text-sm text-stone-500">{t.leaseDetail.noHistory}</p>
            ) : (
              <ul className="space-y-3">
                {history.map((entry) => (
                  <li key={entry.id} className="text-sm">
                    <p className="text-xs text-stone-500">
                      {historyWhen.format(entry.at)} · {entry.userName} · {t.history.entities[entry.entity as keyof typeof t.history.entities] ?? entry.entity}
                      {" · "}
                      {t.history.actions[entry.action as keyof typeof t.history.actions] ?? entry.action}
                    </p>
                    <p className="break-words text-stone-700">{entry.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
