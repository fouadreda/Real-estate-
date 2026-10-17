"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createRentReview(leaseId: string, formData: FormData) {
  await requireUser();
  const dueDate = new Date(String(formData.get("dueDate") ?? ""));
  const rate = Number(formData.get("rate") ?? 0);

  if (Number.isNaN(dueDate.getTime()) || Number.isNaN(rate) || rate <= 0) {
    redirect(`/leases/${leaseId}?formError=review#rent-review`);
  }

  await prisma.rentReview.create({ data: { leaseId, dueDate, rate: rate / 100 } });

  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/alerts");
  redirect(`/leases/${leaseId}`);
}

export async function markRentReviewLetterSent(reviewId: string, leaseId: string) {
  await requireUser();
  await prisma.rentReview.update({ where: { id: reviewId }, data: { letterSentAt: new Date() } });
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/alerts");
}

export async function markRentReviewApplied(reviewId: string, leaseId: string) {
  await requireUser();
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
  await requireUser();
  const review = await prisma.rentReview.findUniqueOrThrow({ where: { id: reviewId }, include: { lease: true } });
  if (review.appliedAt) {
    // an applied increase raised the rent: deleting it puts the rent back as it was
    const rentBefore = Math.round(review.lease.rentAmount / (1 + review.rate));
    await prisma.$transaction([
      prisma.lease.update({ where: { id: leaseId }, data: { rentAmount: rentBefore } }),
      prisma.rentReview.delete({ where: { id: reviewId } }),
    ]);
  } else {
    await prisma.rentReview.delete({ where: { id: reviewId } });
  }
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/alerts");
}
