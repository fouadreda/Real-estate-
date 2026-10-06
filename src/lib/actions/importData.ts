"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { syncBuilding, type SyncResult } from "@/lib/import2026/sync";

export type ImportOutcome = { ok: true; result: SyncResult } | { ok: false; error: string };

/** Admin-only. `apply: false` runs everything inside a transaction that is rolled back. */
export async function runImport(buildingKey: string, apply: boolean, replaceOld = false): Promise<ImportOutcome> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return { ok: false, error: "Admin only." };
  try {
    const result = await syncBuilding(prisma, buildingKey, apply, { replaceOld });
    if (apply) revalidatePath("/", "layout");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
