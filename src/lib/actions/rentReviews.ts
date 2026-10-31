"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { describe, logChange } from "@/lib/changeLog";
import { rentBeforeReview } from "@/lib/rentReview";

/** A review changes the rent, so balances, Alerts and Reports everywhere: refresh them all. */
function refreshAll() {
  revalidatePath("/", "layout");
}

const pct = (rate: number) => `+${(rate * 100).toFixed(1)} %`;

/** Reads a due date and a percentage; an invalid form goes back to the lease with an error code. */
function readReview(formData: FormData, leaseId: string) {
  const dueDate = new Date(String(formData.get("dueDate") ?? ""));
  const rate = Number(formData.get("rate") ?? 0);
  if (Number.isNaN(dueDate.getTime()) || Number.isNaN(rate) || rate <= 0) {
    redirect(`/leases/${leaseId}?formError=review#rent-review`);
  }
  return { dueDate, rate: rate / 100 };
}

export async function createRentReview(leaseId: string, formData: FormData) {
  const user = await requireUser();
  const data = readReview(formData, leaseId);
  const review = await prisma.rentReview.create({ data: { leaseId, ...data } });
  await logChange(user, {
    entity: "rentReview",
    entityId: review.id,
    leaseId,
    action: "created",
    summary: `révision ${pct(review.rate)} au ${describe.day(review.dueDate)}`,
  });
  refreshAll();
  redirect(`/leases/${leaseId}`);
}

/**
 * Loads a review for a change, and makes sure it belongs to the lease the page was shown for
 * (otherwise the change would be logged on, and sent back to, the wrong lease). Null when it is gone.
 */
async function reviewOfLease(reviewId: string, leaseId: string) {
  const review = await prisma.rentReview.findUnique({ where: { id: reviewId } });
  if (review && review.leaseId !== leaseId) redirect(`/leases/${review.leaseId}#rent-review`);
  return review;
}

/** A hidden "rent review due" alert is about one date and rate: once they change, it shows again. */
async function showAlertAgain(reviewId: string) {
  await prisma.dismissedAlert.deleteMany({ where: { kind: "REVISION", refId: reviewId } });
}

/** Corrects a scheduled review (date or percentage). An applied review must be un-applied first. */
export async function updateRentReview(reviewId: string, leaseId: string, formData: FormData) {
  const user = await requireUser();
  const data = readReview(formData, leaseId);
  const before = await reviewOfLease(reviewId, leaseId);
  if (!before || before.appliedAt) redirect(`/leases/${leaseId}#rent-review`);
  // the box shows the rate to 10 digits: an unchanged box keeps the exact stored rate
  if (Math.abs(data.rate - before.rate) < 1e-9) data.rate = before.rate;
  await prisma.rentReview.update({ where: { id: reviewId }, data });
  if (before.dueDate.getTime() !== data.dueDate.getTime() || before.rate !== data.rate) await showAlertAgain(reviewId);
  await logChange(user, {
    entity: "rentReview",
    entityId: reviewId,
    leaseId: before.leaseId,
    action: "updated",
    summary: `révision ${pct(before.rate)} au ${describe.day(before.dueDate)} → ${pct(data.rate)} au ${describe.day(data.dueDate)}`,
  });
  refreshAll();
  redirect(`/leases/${leaseId}#rent-review`);
}

/** Marks the notice letter sent. */
export async function markRentReviewLetterSent(reviewId: string, leaseId: string) {
  await setLetterSent(reviewId, leaseId, true);
}

/** Undoes "letter sent" (a mis-tap). */
export async function markRentReviewLetterNotSent(reviewId: string, leaseId: string) {
  await setLetterSent(reviewId, leaseId, false);
}

async function setLetterSent(reviewId: string, leaseId: string, sent: boolean) {
  const user = await requireUser();
  // gone meanwhile (double tap, another tab): refresh so the page shows it is gone
  if (!(await reviewOfLease(reviewId, leaseId))) return refreshAll();
  const review = await prisma.rentReview.update({ where: { id: reviewId }, data: { letterSentAt: sent ? new Date() : null } });
  await logChange(user, {
    entity: "rentReview",
    entityId: reviewId,
    leaseId: review.leaseId,
    action: "updated",
    summary: `révision ${pct(review.rate)} au ${describe.day(review.dueDate)} : lettre ${sent ? "envoyée" : "non envoyée"}`,
  });
  refreshAll();
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Holds the lease row until the transaction ends, so two rent changes at once never start from the same rent. */
async function lockLease(tx: Tx, leaseId: string) {
  await tx.$queryRaw`SELECT id FROM "Lease" WHERE id = ${leaseId} FOR UPDATE`;
}

/** Applies the increase to the rent. Only the first tap counts: a double tap or a second tab changes nothing. */
export async function markRentReviewApplied(reviewId: string, leaseId: string) {
  const user = await requireUser();
  // gone meanwhile (double tap, another tab): refresh so the page shows it is gone
  if (!(await reviewOfLease(reviewId, leaseId))) return refreshAll();
  const applied = await prisma.$transaction(async (tx) => {
    await lockLease(tx, leaseId);
    const review = await tx.rentReview.findUnique({ where: { id: reviewId }, include: { lease: true } });
    if (!review || review.appliedAt) return null;
    const oldRent = review.lease.rentAmount;
    const newRent = Math.round(oldRent * (1 + review.rate));
    await tx.rentReview.update({ where: { id: reviewId }, data: { appliedAt: new Date(), rentBefore: oldRent, rentAfter: newRent } });
    await tx.lease.update({ where: { id: review.leaseId }, data: { rentAmount: newRent } });
    return { review, oldRent, newRent };
  });
  if (applied) {
    await logChange(user, {
      entity: "rentReview",
      entityId: reviewId,
      leaseId: applied.review.leaseId,
      action: "applied",
      summary: `révision ${pct(applied.review.rate)} appliquée : loyer ${describe.money(applied.oldRent)} → ${describe.money(applied.newRent)}`,
    });
  }
  refreshAll();
}

/** Undoes an applied increase: the rent goes back to what it was and the review is scheduled again. */
export async function unapplyRentReview(reviewId: string, leaseId: string) {
  const user = await requireUser();
  // gone meanwhile (double tap, another tab): refresh so the page shows it is gone
  if (!(await reviewOfLease(reviewId, leaseId))) return refreshAll();
  const undone = await prisma.$transaction(async (tx) => {
    await lockLease(tx, leaseId);
    const review = await tx.rentReview.findUnique({ where: { id: reviewId }, include: { lease: true } });
    if (!review || !review.appliedAt) return null;
    const rentBefore = rentBeforeReview(review, review.lease.rentAmount);
    await tx.rentReview.update({ where: { id: reviewId }, data: { appliedAt: null, rentBefore: null, rentAfter: null } });
    await tx.lease.update({ where: { id: review.leaseId }, data: { rentAmount: rentBefore } });
    return { review, oldRent: review.lease.rentAmount, rentBefore };
  });
  if (undone) {
    await showAlertAgain(reviewId);
    await logChange(user, {
      entity: "rentReview",
      entityId: reviewId,
      leaseId: undone.review.leaseId,
      action: "unapplied",
      summary: `révision ${pct(undone.review.rate)} annulée : loyer ${describe.money(undone.oldRent)} → ${describe.money(undone.rentBefore)}`,
    });
  }
  refreshAll();
}

export async function deleteRentReview(reviewId: string, leaseId: string) {
  const user = await requireUser();
  // gone meanwhile (double tap, another tab): refresh so the page shows it is gone
  if (!(await reviewOfLease(reviewId, leaseId))) return refreshAll();
  const deleted = await prisma.$transaction(async (tx) => {
    await lockLease(tx, leaseId);
    const review = await tx.rentReview.findUnique({ where: { id: reviewId }, include: { lease: true } });
    // already deleted (double tap, another tab): nothing to do
    if (!review) return null;
    if (review.appliedAt) {
      // an applied increase raised the rent: deleting it puts the rent back as it was
      const rentBefore = rentBeforeReview(review, review.lease.rentAmount);
      await tx.lease.update({ where: { id: review.leaseId }, data: { rentAmount: rentBefore } });
    }
    await tx.rentReview.delete({ where: { id: reviewId } });
    return review;
  });
  if (deleted) {
    await logChange(user, {
      entity: "rentReview",
      entityId: reviewId,
      leaseId: deleted.leaseId,
      action: "deleted",
      summary: `révision ${pct(deleted.rate)} au ${describe.day(deleted.dueDate)}${deleted.appliedAt ? " (loyer remis comme avant)" : ""}`,
    });
  }
  refreshAll();
}
