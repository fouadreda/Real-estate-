"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { randomUUID } from "crypto";
import { put, del } from "@vercel/blob";
import { MAX_UPLOAD_BYTES, UPLOAD_EXTENSIONS } from "@/lib/uploads";
import { describe, logChange } from "@/lib/changeLog";

async function saveUpload(file: File, userId: string) {
  if (!(file.type in UPLOAD_EXTENSIONS)) {
    throw new Error("Only JPG, PNG, WEBP, GIF, or PDF files are allowed.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Files must be smaller than 4 MB.");
  }

  const storedName = `${randomUUID()}${UPLOAD_EXTENSIONS[file.type]}`;
  const blob = await put(storedName, file, {
    access: "public",
    contentType: file.type,
  });

  return prisma.attachment.create({
    data: {
      filename: file.name || storedName,
      fileType: file.type,
      url: blob.url,
      uploadedById: userId,
    },
  });
}

export async function uploadLeaseAttachment(leaseId: string, formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a file to upload.");
  }

  const attachment = await saveUpload(file, user.id);
  await prisma.attachment.update({ where: { id: attachment.id }, data: { leaseId } });
  await logChange(user, { entity: "lease", entityId: leaseId, leaseId, action: "updated", summary: `document ajouté : ${attachment.filename}` });

  revalidatePath(`/leases/${leaseId}`);
}

export async function attachFileToPayment(paymentId: string, file: File, userId: string) {
  await requireUser();
  const attachment = await saveUpload(file, userId);
  await prisma.attachment.update({ where: { id: attachment.id }, data: { paymentId } });
}

export async function uploadPaymentAttachment(leaseId: string, paymentId: string, formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a file to upload.");
  }

  await attachFileToPayment(paymentId, file, user.id);
  await logPaymentReceipt(user, paymentId, `reçu ajouté : ${file.name}`);

  revalidatePath(`/leases/${leaseId}`);
  revalidatePath(`/leases/${leaseId}/payments/${paymentId}/edit`);
}

export async function attachFileToExpense(expenseId: string, file: File, userId: string) {
  await requireUser();
  const attachment = await saveUpload(file, userId);
  await prisma.attachment.update({ where: { id: attachment.id }, data: { expenseId } });
}

export async function uploadExpenseAttachment(expenseId: string, formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a file to upload.");
  }

  await attachFileToExpense(expenseId, file, user.id);
  await logChange(user, { entity: "expense", entityId: expenseId, action: "updated", summary: `justificatif ajouté : ${file.name}` });

  revalidatePath("/expenses");
  revalidatePath(`/expenses/${expenseId}/edit`);
  revalidatePath("/reports");
}

async function deleteStoredFile(url: string) {
  await del(url).catch(() => {});
}

/** Receipts are the evidence behind a payment: adding or removing one shows in the payment's lease history. */
async function logPaymentReceipt(user: { id: string; name: string }, paymentId: string, summary: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { leaseId: true, amount: true, date: true } });
  if (!payment) return;
  await logChange(user, {
    entity: "payment",
    entityId: paymentId,
    leaseId: payment.leaseId,
    action: "updated",
    summary: `${summary} (paiement ${describe.money(payment.amount)} du ${describe.day(payment.date)})`,
  });
}

/**
 * Removes one file, only from the record the page was shown for. Already removed (double tap, another
 * tab) or attached elsewhere: nothing happens.
 */
async function removeAttachment(attachmentId: string, owner: { leaseId: string } | { paymentId: string } | { expenseId: string }) {
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) return null;
  const belongs =
    "leaseId" in owner
      ? attachment.leaseId === owner.leaseId
      : "paymentId" in owner
        ? attachment.paymentId === owner.paymentId
        : attachment.expenseId === owner.expenseId;
  if (!belongs) return null;
  await prisma.attachment.delete({ where: { id: attachmentId } });
  await deleteStoredFile(attachment.url);
  return attachment;
}

export async function deleteLeaseAttachment(leaseId: string, attachmentId: string) {
  const user = await requireUser();
  const attachment = await removeAttachment(attachmentId, { leaseId });
  if (attachment) {
    await logChange(user, { entity: "lease", entityId: leaseId, leaseId, action: "updated", summary: `document supprimé : ${attachment.filename}` });
  }
  revalidatePath(`/leases/${leaseId}`);
}

export async function deletePaymentAttachment(leaseId: string, paymentId: string, attachmentId: string) {
  const user = await requireUser();
  const attachment = await removeAttachment(attachmentId, { paymentId });
  if (attachment) await logPaymentReceipt(user, paymentId, `reçu supprimé : ${attachment.filename}`);
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath(`/leases/${leaseId}/payments/${paymentId}/edit`);
}

export async function deleteExpenseAttachment(expenseId: string, attachmentId: string) {
  const user = await requireUser();
  const attachment = await removeAttachment(attachmentId, { expenseId });
  if (attachment) {
    await logChange(user, { entity: "expense", entityId: expenseId, action: "updated", summary: `justificatif supprimé : ${attachment.filename}` });
  }
  revalidatePath("/expenses");
  revalidatePath(`/expenses/${expenseId}/edit`);
  revalidatePath("/reports");
}
