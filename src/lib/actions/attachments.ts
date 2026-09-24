"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { randomUUID } from "crypto";
import { put, del } from "@vercel/blob";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
};

async function saveUpload(file: File, userId: string) {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("Only JPG, PNG, WEBP, GIF, or PDF files are allowed.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Files must be smaller than 10 MB.");
  }

  const storedName = `${randomUUID()}${EXTENSIONS[file.type]}`;
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

  revalidatePath(`/leases/${leaseId}`);
}

export async function attachFileToPayment(paymentId: string, file: File, userId: string) {
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

  revalidatePath(`/leases/${leaseId}`);
  revalidatePath(`/leases/${leaseId}/payments/${paymentId}/edit`);
}

export async function attachFileToExpense(expenseId: string, file: File, userId: string) {
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

  revalidatePath("/expenses");
  revalidatePath(`/expenses/${expenseId}/edit`);
  revalidatePath("/reports");
}

async function deleteStoredFile(url: string) {
  await del(url).catch(() => {});
}

export async function deleteLeaseAttachment(leaseId: string, attachmentId: string) {
  const attachment = await prisma.attachment.delete({ where: { id: attachmentId } });
  await deleteStoredFile(attachment.url);
  revalidatePath(`/leases/${leaseId}`);
}

export async function deletePaymentAttachment(leaseId: string, paymentId: string, attachmentId: string) {
  const attachment = await prisma.attachment.delete({ where: { id: attachmentId } });
  await deleteStoredFile(attachment.url);
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath(`/leases/${leaseId}/payments/${paymentId}/edit`);
}

export async function deleteExpenseAttachment(expenseId: string, attachmentId: string) {
  const attachment = await prisma.attachment.delete({ where: { id: attachmentId } });
  await deleteStoredFile(attachment.url);
  revalidatePath("/expenses");
  revalidatePath(`/expenses/${expenseId}/edit`);
  revalidatePath("/reports");
}
