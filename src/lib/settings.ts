import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";

export interface AppSettings {
  /** A tenant this many days past their Paid Until date is Overdue (before that: Due). */
  overdueDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = { overdueDays: 90 };

/**
 * Reads the settings once per request. If the settings table is not there yet (database update
 * pending) or unreadable, the defaults are used so no screen ever breaks because of it.
 */
export const getSettings = cache(async (): Promise<AppSettings> => {
  try {
    const rows = await prisma.appSetting.findMany();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const overdue = Number(map.get("overdueDays"));
    return { overdueDays: Number.isFinite(overdue) && overdue >= 1 ? Math.round(overdue) : DEFAULT_SETTINGS.overdueDays };
  } catch {
    return DEFAULT_SETTINGS;
  }
});
