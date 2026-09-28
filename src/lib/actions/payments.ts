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

export async function createPayment(leaseId: string, formData: FormData) {
  const user = await requireUser();
  const data = readPaymentFields(formData);

  const payment = await prisma.payment.create({
    data: { ...data, leaseId, recordedById: user.id, kind: "RENT", confirmed: true },
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
  const kind = String(formData.get("kind") ?? "RENT") as PaymentKind;
  const confirmed = formData.get("confirmed") === "on";

  await prisma.payment.update({ where: { id: paymentId }, data: { ...data, kind, confirmed } });

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
