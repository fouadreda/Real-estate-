import "server-only";

import { prisma } from "@/lib/prisma";
import { fr } from "@/lib/i18n/fr";

type Who = { id: string; name: string };

export type ChangeEntry = {
  entity: "payment" | "expense" | "lease" | "tenant" | "property" | "rentReview" | "followUp" | "alert" | "user";
  entityId: string;
  leaseId?: string | null;
  action: "created" | "updated" | "deleted" | "moved" | "status" | "verified" | "unverified" | "applied" | "unapplied" | "restored";
  summary: string;
};

/** Records one change made in the app. Never blocks the change itself: a failed log line only goes to the server log. */
export async function logChange(user: Who, entry: ChangeEntry) {
  try {
    await prisma.changeLog.create({
      data: { userId: user.id, userName: user.name, ...entry, leaseId: entry.leaseId ?? null },
    });
  } catch (err) {
    console.error("change log failed", err);
  }
}

const money = (n: number) => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} XOF`;
const day = (d: Date | null | undefined) =>
  d ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}` : "—";

const FREQUENCIES: Record<string, string> = { MONTHLY: "mensuel", QUARTERLY: "trimestriel", SEMIANNUAL: "semestriel", ANNUAL: "annuel" };
/** A status, kind, category or result code in French words ("RENT" → "Loyer"), as the screens show it. */
const code = (value: string) =>
  (fr.status as Record<string, string>)[value] ?? (fr.alerts.kindLabels as Record<string, string>)[value] ?? FREQUENCIES[value] ?? value;

/** How values are written in the history (French, like the rest of the company's records). */
export const describe = { money, day, code };

/** "montant 1 400 000 XOF → 1 500 000 XOF; date 01/09/2026 → 03/09/2026" for the fields that changed. */
export function changedFields(fields: [label: string, before: string, after: string][]): string {
  const changed = fields.filter(([, before, after]) => before !== after);
  return changed.length === 0 ? "aucun changement" : changed.map(([label, before, after]) => `${label} ${before} → ${after}`).join("; ");
}
