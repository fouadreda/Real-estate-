"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { AlertKind } from "@prisma/client";

export async function dismissAlert(kind: AlertKind, refId: string, context: string) {
  const user = await requireUser();
  await prisma.dismissedAlert.upsert({
    where: { kind_refId_context: { kind, refId, context } },
    update: {},
    create: { kind, refId, context, dismissedById: user.id },
  });
  revalidatePath("/alerts");
}
