"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { attachFileToPayment } from "@/lib/actions/attachments";
import { isAllowedUpload } from "@/lib/uploads";
import type { PaymentKind } from "@prisma/client";

/** A form value the server will not accept; shown back to staff on the form instead of an error page. */
type PaymentError = "amount" | "months" | "file";

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

function refreshPaymentPages(leaseId: string) {
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/leases");
  revalidatePath("/reports");
  revalidatePath("/alerts");
  revalidatePath("/tenants", "layout");
  revalidatePath("/");
}

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
  });
  if (file) await attachFileToPayment(payment.id, file, user.id);

  refreshPaymentPages(leaseId);
  redirect(`/leases/${leaseId}?paymentSaved=1`);
}

export async function updatePayment(paymentId: string, leaseId: string, formData: FormData) {
  await requireUser();
  const { valid, data } = readPaymentFields(formData);
  const kind = readKind(formData);
  const confirmed = formData.get("confirmed") === "on";
  const monthsCovered = readMonths(formData, kind, 0);

  const error: PaymentError | null = !valid ? "amount" : monthsCovered === undefined ? "months" : null;
  if (error) redirect(`/leases/${leaseId}/payments/${paymentId}/edit?error=${error}`);

  await prisma.payment.update({
    where: { id: paymentId },
    data: { ...data, kind, confirmed, monthsCovered: monthsCovered ?? null },
  });

  refreshPaymentPages(leaseId);
  redirect(`/leases/${leaseId}`);
}

export async function deletePayment(paymentId: string, leaseId: string) {
  await requireUser();
  await prisma.payment.delete({ where: { id: paymentId } });
  refreshPaymentPages(leaseId);
}
