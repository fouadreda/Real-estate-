"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { FollowUpAction, FollowUpResult } from "@prisma/client";

export async function createFollowUp(leaseId: string, formData: FormData) {
  const date = new Date(String(formData.get("date") ?? ""));
  const action = String(formData.get("action") ?? "CALL_VISIT") as FollowUpAction;
  const response = String(formData.get("response") ?? "").trim() || null;
  const promiseDateRaw = String(formData.get("promiseDate") ?? "").trim();
  const promiseDate = promiseDateRaw ? new Date(promiseDateRaw) : null;
  const promiseAmountRaw = String(formData.get("promiseAmount") ?? "").trim();
  const promiseAmount = promiseAmountRaw ? Number(promiseAmountRaw) : null;

  if (!date.getTime()) {
    throw new Error("A valid date is required.");
  }

  await prisma.followUp.create({
    data: { leaseId, date, action, response, promiseDate, promiseAmount },
  });

  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/collections");
}

export async function updateFollowUpResult(followUpId: string, leaseId: string, result: FollowUpResult) {
  await prisma.followUp.update({ where: { id: followUpId }, data: { result } });
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/collections");
}

export async function deleteFollowUp(followUpId: string, leaseId: string) {
  await prisma.followUp.delete({ where: { id: followUpId } });
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/collections");
}
