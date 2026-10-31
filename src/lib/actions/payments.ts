"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { attachFileToPayment } from "@/lib/actions/attachments";
import { isAllowedUpload } from "@/lib/uploads";
import { changedFields, describe, logChange } from "@/lib/changeLog";
import { leaseLocationName } from "@/lib/leaseLocation";
import { safeBackPath } from "@/lib/backPath";
import { tenantDisplayName } from "@/lib/tenantName";
import { monthlyEquivalentRent } from "@/lib/ledger";
import type { PaymentKind } from "@prisma/client";

/** A form value the server will not accept; shown back to staff on the form instead of an error page. */
type PaymentError = "amount" | "months" | "file" | "upload" | "lease" | "stale";

function readPaymentFields(formData: FormData) {
  const amount = Number(formData.get("amount") ?? 0);
  const date = new Date(String(formData.get("date") ?? ""));
  const method = String(formData.get("method") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const valid = !Number.isNaN(amount) && amount > 0 && !Number.isNaN(date.getTime());
  return { valid, data: { amount, date, method, notes } };
}

const PAYMENT_KINDS: PaymentKind[] = ["RENT", "ARREARS", "ADVANCE_AT_ENTRY", "DEPOSIT", "DEPOSIT_REFUND", "OTHER"];

function readKind(formData: FormData): PaymentKind {
  const kind = String(formData.get("kind") ?? "RENT");
  return (PAYMENT_KINDS as string[]).includes(kind) ? (kind as PaymentKind) : "RENT";
}

const RENT_KINDS: PaymentKind[] = ["RENT", "ARREARS"];

/**
 * Rent payments say how many whole months they pay for; other kinds have no months.
 * `minMonths` is 1 for a new payment and 0 when correcting one (an imported receipt can pay 0 months).
 * Returns undefined when the value is not a whole number in range.
 */
function readMonths(formData: FormData, kind: PaymentKind, minMonths: number): number | null | undefined {
  if (!RENT_KINDS.includes(kind)) return null;
  const raw = formData.get("months");
  if (raw === null || String(raw).trim() === "") return null;
  const months = Number(raw);
  if (!Number.isInteger(months) || months < minMonths || months > 60) return undefined;
  return months;
}

function readFile(formData: FormData): File | null {
  const file = formData.get("file");
  return file instanceof File && file.size > 0 ? file : null;
}

/** A payment changes balances everywhere (lease, tenant, Reports, Alerts, dashboard, nav badge): refresh them all. */
function refreshPaymentPages() {
  revalidatePath("/", "layout");
}

const leaseLabel = (lease: Parameters<typeof leaseLocationName>[0] & { tenant: Parameters<typeof tenantDisplayName>[0] }) =>
  `${leaseLocationName(lease)} (${tenantDisplayName(lease.tenant)})`;

export async function createPayment(leaseId: string, formData: FormData) {
  const user = await requireUser();
  const { valid, data } = readPaymentFields(formData);
  const kind = readKind(formData);
  const monthsCovered = readMonths(formData, kind, 1);
  const file = readFile(formData);

  let error: PaymentError | null = null;
  if (!valid) error = "amount";
  else if (monthsCovered === undefined) error = "months";
  else if (file && !isAllowedUpload(file)) error = "file";
  if (error) redirect(`/leases/${leaseId}?paymentError=${error}#record-payment`);

  const payment = await prisma.payment.create({
    data: { ...data, leaseId, recordedById: user.id, kind, monthsCovered: monthsCovered ?? null, confirmed: true },
    include: { lease: { include: { tenant: true, property: { include: { building: true } } } } },
  });
  if (file) {
    try {
      await attachFileToPayment(payment.id, file, user.id);
    } catch {
      // the receipt could not be stored: undo the payment so a retry does not record it twice
      await prisma.payment.delete({ where: { id: payment.id } }).catch(() => undefined);
      redirect(`/leases/${leaseId}?paymentError=upload#record-payment`);
    }
  }

  await logChange(user, {
    entity: "payment",
    entityId: payment.id,
    leaseId,
    action: "created",
    summary: `${describe.money(payment.amount)} · ${describe.code(payment.kind)} · ${describe.day(payment.date)}${payment.monthsCovered ? ` · ${payment.monthsCovered} mois` : ""} — ${leaseLabel(payment.lease)}`,
  });
  refreshPaymentPages();
  redirect(`/leases/${leaseId}?paymentSaved=1`);
}

/**
 * Saves a corrected payment. Every field can change, including the lease: a payment recorded on the
 * wrong tenant or unit is moved, with its receipts, to the right one.
 */
export async function updatePayment(paymentId: string, leaseId: string, formData: FormData) {
  const user = await requireUser();
  const back = safeBackPath(formData.get("back"));
  const editUrl = (onLease: string) => `/leases/${onLease}/payments/${paymentId}/edit${back ? `?back=${encodeURIComponent(back)}&` : "?"}`;
  const { valid, data } = readPaymentFields(formData);
  const kind = readKind(formData);
  const confirmed = formData.get("confirmed") === "on";
  const typedMonths = readMonths(formData, kind, 0);
  const targetLeaseId = String(formData.get("leaseId") ?? "").trim() || leaseId;

  const error: PaymentError | null = !valid ? "amount" : typedMonths === undefined ? "months" : null;
  if (error) redirect(`${editUrl(leaseId)}error=${error}`);

  const before = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { lease: { include: { tenant: true, property: { include: { building: true } } } } },
  });
  // deleted in the meantime (another tab, a colleague): back to the lease instead of an error page
  if (!before) redirect(`/leases/${leaseId}`);
  // moved by someone else since this page was opened: saving it would silently move it back
  if (before.leaseId !== leaseId) redirect(`${editUrl(before.leaseId)}error=stale`);
  const target =
    targetLeaseId === before.leaseId
      ? before.lease
      : await prisma.lease.findUnique({ where: { id: targetLeaseId }, include: { tenant: true, property: { include: { building: true } } } });
  if (!target) redirect(`${editUrl(leaseId)}error=lease`);

  const moved = target.id !== before.leaseId;
  // months are priced at the lease's monthly rent: a rent payment moved to a lease with another monthly
  // rent, whose months were left as they were, pays the months its amount buys there (as for an imported receipt)
  const targetMonthly = monthlyEquivalentRent(target.rentAmount, target.billingFrequency);
  const recount =
    moved &&
    RENT_KINDS.includes(kind) &&
    typedMonths !== null &&
    typedMonths === before.monthsCovered &&
    targetMonthly > 0 &&
    Math.round(targetMonthly) !== Math.round(monthlyEquivalentRent(before.lease.rentAmount, before.lease.billingFrequency));
  const monthsCovered = recount ? Math.min(60, Math.floor((data.amount + 100) / targetMonthly)) : typedMonths;

  await prisma.payment.update({
    where: { id: paymentId },
    data: { ...data, kind, confirmed, monthsCovered: monthsCovered ?? null, leaseId: target.id },
  });

  const summary = changedFields([
    ["bail", leaseLabel(before.lease), leaseLabel(target)],
    ["montant", describe.money(before.amount), describe.money(data.amount)],
    ["date", describe.day(before.date), describe.day(data.date)],
    ["type", describe.code(before.kind), describe.code(kind)],
    ["mois", String(before.monthsCovered ?? "—"), `${monthsCovered ?? "—"}${recount ? " (recalculé au loyer du nouveau bail)" : ""}`],
    ["méthode", before.method ?? "—", data.method ?? "—"],
    ["notes", before.notes ?? "—", data.notes ?? "—"],
    ["confirmé", before.confirmed ? "oui" : "non", confirmed ? "oui" : "non"],
  ]);
  // a move shows in both leases' history: where the money went, and where it came from
  for (const onLease of moved ? [before.leaseId, target.id] : [target.id]) {
    await logChange(user, { entity: "payment", entityId: paymentId, leaseId: onLease, action: moved ? "moved" : "updated", summary });
  }

  refreshPaymentPages();
  redirect(back ?? `/leases/${target.id}`);
}

/**
 * Deletes a payment shown on `leaseId`. Already deleted (double tap, another tab): "gone". Moved to
 * another lease since the page was shown: "moved", and nothing is deleted.
 */
async function removePayment(paymentId: string, leaseId: string): Promise<"deleted" | "gone" | { movedTo: string }> {
  const user = await requireUser();
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { lease: { include: { tenant: true, property: { include: { building: true } } } } },
  });
  if (!payment) return "gone";
  if (payment.leaseId !== leaseId) return { movedTo: payment.leaseId };
  await prisma.payment.delete({ where: { id: paymentId } });
  await logChange(user, {
    entity: "payment",
    entityId: paymentId,
    leaseId: payment.leaseId,
    action: "deleted",
    summary: `${describe.money(payment.amount)} · ${describe.code(payment.kind)} · ${describe.day(payment.date)} — ${leaseLabel(payment.lease)}`,
  });
  return "deleted";
}

/** Delete from the lease's payment list: the lease page, Reports and every balance refresh. */
export async function deletePayment(paymentId: string, leaseId: string) {
  await removePayment(paymentId, leaseId);
  refreshPaymentPages();
}

/** Delete from the payment's own page (also reached from a Reports row), then go back to where staff came from. */
export async function deletePaymentAndReturn(paymentId: string, leaseId: string, back: string | null) {
  const outcome = await removePayment(paymentId, leaseId);
  refreshPaymentPages();
  const backPath = safeBackPath(back);
  // moved by someone else meanwhile: show it as it is now instead of deleting it
  if (typeof outcome === "object") {
    redirect(`/leases/${outcome.movedTo}/payments/${paymentId}/edit${backPath ? `?back=${encodeURIComponent(backPath)}&` : "?"}error=stale`);
  }
  redirect(backPath ?? `/leases/${leaseId}`);
}
