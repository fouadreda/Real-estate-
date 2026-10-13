"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { attachFileToPayment } from "@/lib/actions/attachments";
import type { PaymentKind } from "@prisma/client";

function readPaymentFields(formData: FormData) {
  const amount = Number(formData.get("amount") ?? 0);
  const date = new Date(String(formData.get("date") ?? ""));
  const method = String(formData.get("method") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (Number.isNaN(amount) || amount <= 0 || !date.getTime()) {
    throw new Error("A valid amount and date are required.");
  }

  return { amount, date, method, notes };
}

const PAYMENT_KINDS: PaymentKind[] = ["RENT", "ARREARS", "ADVANCE_AT_ENTRY", "DEPOSIT", "DEPOSIT_REFUND", "OTHER"];

function readKind(formData: FormData): PaymentKind {
  const kind = String(formData.get("kind") ?? "RENT");
  return (PAYMENT_KINDS as string[]).includes(kind) ? (kind as PaymentKind) : "RENT";
}

const RENT_KINDS: PaymentKind[] = ["RENT", "ARREARS"];

/** Rent payments say how many whole months they pay for; other kinds have no months. */
function readMonths(formData: FormData, kind: PaymentKind): number | null {
  if (!RENT_KINDS.includes(kind)) return null;
  const raw = formData.get("months");
  if (raw === null || String(raw).trim() === "") return null;
  const months = Number(raw);
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    throw new Error("Months paid must be a whole number between 1 and 60.");
  }
  return months;
}

export async function createPayment(leaseId: string, formData: FormData) {
  const user = await requireUser();
  const data = readPaymentFields(formData);
  const kind = readKind(formData);
  const monthsCovered = readMonths(formData, kind);

  const payment = await prisma.payment.create({
    data: { ...data, leaseId, recordedById: user.id, kind, monthsCovered, confirmed: true },
  });

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    await attachFileToPayment(payment.id, file, user.id);
  }

  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/reports");
  revalidatePath("/alerts");
}

export async function updatePayment(paymentId: string, leaseId: string, formData: FormData) {
  const data = readPaymentFields(formData);
  const kind = readKind(formData);
  const confirmed = formData.get("confirmed") === "on";
  const monthsCovered = readMonths(formData, kind);

  await prisma.payment.update({ where: { id: paymentId }, data: { ...data, kind, confirmed, monthsCovered } });

  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/reports");
  revalidatePath("/alerts");
  redirect(`/leases/${leaseId}`);
}

export async function deletePayment(paymentId: string, leaseId: string) {
  await prisma.payment.delete({ where: { id: paymentId } });
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/reports");
  revalidatePath("/alerts");
}
