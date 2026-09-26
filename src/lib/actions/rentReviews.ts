"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function createRentReview(leaseId: string, formData: FormData) {
  const dueDate = new Date(String(formData.get("dueDate") ?? ""));
  const rate = Number(formData.get("rate") ?? 0);

  if (!dueDate.getTime() || Number.isNaN(rate)) {
    throw new Error("A valid due date and rate are required.");
  }

  await prisma.rentReview.create({ data: { leaseId, dueDate, rate: rate / 100 } });

  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/alerts");
}

export async function markRentReviewLetterSent(reviewId: string, leaseId: string) {
  await prisma.rentReview.update({ where: { id: reviewId }, data: { letterSentAt: new Date() } });
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/alerts");
}

export async function markRentReviewApplied(reviewId: string, leaseId: string) {
  const review = await prisma.rentReview.update({
    where: { id: reviewId },
    data: { appliedAt: new Date() },
  });
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (lease) {
    const newRent = Math.round(lease.rentAmount * (1 + review.rate));
    await prisma.lease.update({ where: { id: leaseId }, data: { rentAmount: newRent } });
  }
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/alerts");
}

export async function deleteRentReview(reviewId: string, leaseId: string) {
  await prisma.rentReview.delete({ where: { id: reviewId } });
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/alerts");
}
