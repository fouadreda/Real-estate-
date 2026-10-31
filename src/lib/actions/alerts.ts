"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { AlertKind } from "@prisma/client";
import { logChange } from "@/lib/changeLog";
import { fr } from "@/lib/i18n/fr";

/** The lease an alert is about: a review or a promise points at its lease, the other alerts at the lease itself. */
async function leaseOfAlert(kind: AlertKind, refId: string): Promise<string | null> {
  if (kind === "REVISION") return (await prisma.rentReview.findUnique({ where: { id: refId }, select: { leaseId: true } }))?.leaseId ?? null;
  if (kind === "BROKEN_PROMISE") return (await prisma.followUp.findUnique({ where: { id: refId }, select: { leaseId: true } }))?.leaseId ?? null;
  return refId;
}

export async function dismissAlert(kind: AlertKind, refId: string, context: string) {
  const user = await requireUser();
  await prisma.dismissedAlert.upsert({
    where: { kind_refId_context: { kind, refId, context } },
    update: {},
    create: { kind, refId, context, dismissedById: user.id },
  });
  await logChange(user, { entity: "alert", entityId: refId, leaseId: await leaseOfAlert(kind, refId), action: "status", summary: `alerte « ${fr.alerts.kindLabels[kind]} » masquée` });
  // the nav badge counts alerts on every page
  revalidatePath("/", "layout");
}

/** Brings back an alert that was hidden by mistake (or too early). */
export async function restoreAlert(dismissedId: string) {
  const user = await requireUser();
  const dismissed = await prisma.dismissedAlert.delete({ where: { id: dismissedId } }).catch(() => null);
  if (dismissed) {
    await logChange(user, {
      entity: "alert",
      entityId: dismissed.refId,
      leaseId: await leaseOfAlert(dismissed.kind, dismissed.refId),
      action: "restored",
      summary: `alerte « ${fr.alerts.kindLabels[dismissed.kind]} » réaffichée`,
    });
  }
  revalidatePath("/", "layout");
}
