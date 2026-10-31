"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FollowUpAction, FollowUpResult } from "@prisma/client";
import { changedFields, describe, logChange } from "@/lib/changeLog";

const ACTIONS: FollowUpAction[] = ["CALL_VISIT", "SMS_WHATSAPP", "LETTER", "FORMAL_NOTICE", "LAWYER"];
const RESULTS: FollowUpResult[] = ["PENDING", "PAID", "PARTIAL", "BROKEN"];

/** Follow-ups feed the Alerts page (promises, broken promises): refresh every page. */
function refreshAll() {
  revalidatePath("/", "layout");
}

/** Reads a follow-up form; an invalid form goes back to the lease with an error code. */
function readFollowUp(formData: FormData, leaseId: string) {
  const date = new Date(String(formData.get("date") ?? ""));
  const actionRaw = String(formData.get("action") ?? "CALL_VISIT");
  const action = (ACTIONS as string[]).includes(actionRaw) ? (actionRaw as FollowUpAction) : "CALL_VISIT";
  const response = String(formData.get("response") ?? "").trim() || null;
  const promiseDateRaw = String(formData.get("promiseDate") ?? "").trim();
  const promiseDate = promiseDateRaw ? new Date(promiseDateRaw) : null;
  const promiseAmountRaw = String(formData.get("promiseAmount") ?? "").trim();
  const promiseAmount = promiseAmountRaw ? Number(promiseAmountRaw) : null;

  const badPromise =
    (promiseDate !== null && Number.isNaN(promiseDate.getTime())) ||
    (promiseAmount !== null && (Number.isNaN(promiseAmount) || promiseAmount < 0));
  if (Number.isNaN(date.getTime()) || badPromise) {
    redirect(`/leases/${leaseId}?formError=followup#follow-ups`);
  }
  return { date, action, response, promiseDate, promiseAmount };
}

const followUpSummary = (f: { date: Date; action: string; promiseDate: Date | null; promiseAmount: number | null; result: string }) =>
  `${describe.day(f.date)} · ${describe.code(f.action)}${f.promiseDate ? ` · promesse ${describe.day(f.promiseDate)}${f.promiseAmount ? ` ${describe.money(f.promiseAmount)}` : ""}` : ""} · ${describe.code(f.result)}`;

export async function createFollowUp(leaseId: string, formData: FormData) {
  const user = await requireUser();
  const data = readFollowUp(formData, leaseId);
  const followUp = await prisma.followUp.create({ data: { leaseId, ...data } });
  await logChange(user, { entity: "followUp", entityId: followUp.id, leaseId, action: "created", summary: followUpSummary(followUp) });
  refreshAll();
  redirect(`/leases/${leaseId}`);
}

/**
 * Loads a follow-up for a change, and makes sure it belongs to the lease the page was shown for
 * (otherwise the change would be logged on, and sent back to, the wrong lease). Null when it is gone.
 */
async function followUpOfLease(followUpId: string, leaseId: string) {
  const followUp = await prisma.followUp.findUnique({ where: { id: followUpId } });
  if (followUp && followUp.leaseId !== leaseId) redirect(`/leases/${followUp.leaseId}#follow-ups`);
  return followUp;
}

/** A hidden "broken promise" alert is about one promise: once its date or result is corrected, it shows again if still broken. */
async function showAlertAgain(followUpId: string) {
  await prisma.dismissedAlert.deleteMany({ where: { kind: "BROKEN_PROMISE", refId: followUpId } });
}

/** Corrects a follow-up: date, action, answer, promise, and its result (a mis-tap on "broken" can be undone). */
export async function updateFollowUp(followUpId: string, leaseId: string, formData: FormData) {
  const user = await requireUser();
  const data = readFollowUp(formData, leaseId);
  const resultRaw = String(formData.get("result") ?? "");
  const before = await followUpOfLease(followUpId, leaseId);
  if (!before) redirect(`/leases/${leaseId}#follow-ups`);
  const result = (RESULTS as string[]).includes(resultRaw) ? (resultRaw as FollowUpResult) : before.result;
  const after = await prisma.followUp.update({ where: { id: followUpId }, data: { ...data, result } });
  if (before.promiseDate?.getTime() !== after.promiseDate?.getTime() || before.result !== after.result) await showAlertAgain(followUpId);
  await logChange(user, {
    entity: "followUp",
    entityId: followUpId,
    leaseId: before.leaseId,
    action: "updated",
    summary: changedFields([
      ["date", describe.day(before.date), describe.day(after.date)],
      ["action", describe.code(before.action), describe.code(after.action)],
      ["réponse", before.response ?? "—", after.response ?? "—"],
      ["date promise", describe.day(before.promiseDate), describe.day(after.promiseDate)],
      ["montant promis", before.promiseAmount === null ? "—" : describe.money(before.promiseAmount), after.promiseAmount === null ? "—" : describe.money(after.promiseAmount)],
      ["résultat", describe.code(before.result), describe.code(after.result)],
    ]),
  });
  refreshAll();
  redirect(`/leases/${leaseId}#follow-ups`);
}

export async function updateFollowUpResult(followUpId: string, leaseId: string, result: FollowUpResult) {
  const user = await requireUser();
  const before = await followUpOfLease(followUpId, leaseId);
  if (!before) return refreshAll();
  await prisma.followUp.update({ where: { id: followUpId }, data: { result } });
  if (before.result !== result) await showAlertAgain(followUpId);
  await logChange(user, { entity: "followUp", entityId: followUpId, leaseId: before.leaseId, action: "updated", summary: `résultat ${describe.code(before.result)} → ${describe.code(result)}` });
  refreshAll();
}

export async function deleteFollowUp(followUpId: string, leaseId: string) {
  const user = await requireUser();
  const followUp = await followUpOfLease(followUpId, leaseId);
  // already deleted (double tap, another tab): nothing to do
  if (!followUp) return refreshAll();
  await prisma.followUp.delete({ where: { id: followUpId } });
  await logChange(user, { entity: "followUp", entityId: followUpId, leaseId: followUp.leaseId, action: "deleted", summary: followUpSummary(followUp) });
  refreshAll();
}
