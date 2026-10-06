import type { Prisma, PrismaClient } from "@prisma/client";
import dataset from "./dataset.json";

/**
 * Loads the Jan–Sep 2026 situation (register of 28/09/2026 + monthly receipts) into the app.
 *
 * It is a merge, never a wipe: buildings, properties, tenants and leases are matched to what
 * is already there (same building + unit code, same tenant name) and updated; anything not
 * found is created; payments that already exist (same lease, date, amount and kind) are
 * skipped. Running it twice therefore changes nothing the second time.
 */

type DsUnit = (typeof dataset.units)[number];
type DsTenant = (typeof dataset.tenants)[number];
type DsLease = (typeof dataset.leases)[number];

export const IMPORT_BUILDINGS = dataset.buildings.map((b) => {
  const unitUids = new Set(dataset.units.filter((u) => u.building === b.key).map((u) => u.uid));
  const leases = dataset.leases.filter((l) => unitUids.has(l.uid));
  return {
    key: b.key,
    name: b.name,
    units: unitUids.size,
    leases: leases.length,
    payments: leases.reduce((sum, l) => sum + l.payments.length, 0),
    expenses: dataset.expenses.filter((e) => e.building === b.key).length,
  };
});

export const IMPORT_META = {
  registerAsOf: dataset.registerAsOf,
  sources: dataset.sources,
};

export type SyncCounts = {
  propertiesCreated: number;
  propertiesUpdated: number;
  tenantsCreated: number;
  tenantsUpdated: number;
  leasesCreated: number;
  leasesUpdated: number;
  leasesEnded: number;
  paymentsCreated: number;
  paymentsSkipped: number;
  paymentsRemoved: number;
  paymentsRedated: number;
  reviewsCreated: number;
  expensesCreated: number;
  expensesSkipped: number;
  expensesRemoved: number;
  followUpsCreated: number;
  issuesCreated: number;
};

export type SyncResult = {
  building: string;
  applied: boolean;
  counts: SyncCounts;
  notes: string[];
};

class DryRunRollback extends Error {
  constructor(public result: SyncResult) {
    super("dry-run");
  }
}

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const d = (s: string | null | undefined): Date | null => (s ? new Date(`${s}T00:00:00Z`) : null);
const ymd = (date: Date) => date.toISOString().slice(0, 10);

function tenantKey(t: { company: string | null; firstName: string | null; lastName: string | null }): string {
  return norm(t.company || [t.firstName, t.lastName].filter(Boolean).join(" "));
}

export type SyncOptions = {
  /**
   * Remove the 2026 payments of refreshed leases that came from the earlier April import
   * (placeholders and combined lines) and are not in the statements. Payments entered by a
   * user in the app are never touched.
   */
  replaceOld?: boolean;
};

export async function syncBuilding(
  prisma: PrismaClient,
  buildingKey: string,
  apply: boolean,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const bMeta = dataset.buildings.find((b) => b.key === buildingKey);
  if (!bMeta) throw new Error(`Unknown building: ${buildingKey}`);

  const units: DsUnit[] = dataset.units.filter((u) => u.building === buildingKey);
  const unitUids = new Set(units.map((u) => u.uid));
  const leases: DsLease[] = dataset.leases.filter((l) => unitUids.has(l.uid));
  const tenantIds = new Set(leases.map((l) => l.tid));
  const tenants: DsTenant[] = dataset.tenants.filter((t) => tenantIds.has(t.tid));
  const issues = dataset.issues.filter((i) => leases.some((l) => l.lid === i.ref));

  const counts: SyncCounts = {
    propertiesCreated: 0, propertiesUpdated: 0, tenantsCreated: 0, tenantsUpdated: 0,
    leasesCreated: 0, leasesUpdated: 0, leasesEnded: 0, paymentsCreated: 0, paymentsSkipped: 0, paymentsRemoved: 0, paymentsRedated: 0,
    reviewsCreated: 0, expensesCreated: 0, expensesSkipped: 0, expensesRemoved: 0, followUpsCreated: 0, issuesCreated: 0,
  };
  const notes: string[] = [];

  try {
    return await prisma.$transaction(
      async (tx) => {
        // ---------------------------------------------------------------- building
        const building = await tx.building.upsert({
          where: { name: bMeta.name },
          update: { type: bMeta.type as "BUILDING" | "VILLA" | "WAREHOUSE_SITE" },
          create: { name: bMeta.name, type: bMeta.type as "BUILDING" | "VILLA" | "WAREHOUSE_SITE" },
        });

        // ---------------------------------------------------------------- existing records
        const existingProps = await tx.property.findMany({
          where: { buildingId: building.id },
          include: { leases: { include: { tenant: true } } },
        });
        const allTenants = await tx.tenant.findMany();
        const tenantByKey = new Map<string, (typeof allTenants)[number]>();
        for (const t of allTenants) {
          const k = tenantKey(t);
          if (k && !tenantByKey.has(k)) tenantByKey.set(k, t);
        }

        // ---------------------------------------------------------------- tenants
        const claimedTenants = new Set<string>();
        const tenantDbId = new Map<string, string>(); // dataset tid -> db id
        for (const t of tenants) {
          const names = [t.name, ...t.aliases];
          let found: (typeof allTenants)[number] | undefined;
          for (const n of names) {
            const hit = tenantByKey.get(norm(n));
            if (hit && !claimedTenants.has(hit.id)) {
              found = hit;
              break;
            }
          }
          if (found) {
            claimedTenants.add(found.id);
            const data: Prisma.TenantUpdateInput = {};
            const current = tenantKey(found);
            if (found.company && current !== norm(t.name)) data.company = t.name;
            if (t.representative && !found.representative) data.representative = t.representative;
            if (t.phone && !found.phone) data.phone = t.phone;
            if (t.poBox && !found.poBox) data.poBox = t.poBox;
            if (t.notes && !(found.notes ?? "").includes(t.notes)) {
              data.notes = found.notes ? `${found.notes} | ${t.notes}` : t.notes;
            }
            if (Object.keys(data).length > 0) {
              await tx.tenant.update({ where: { id: found.id }, data });
              counts.tenantsUpdated++;
            }
            tenantDbId.set(t.tid, found.id);
          } else {
            const created = await tx.tenant.create({
              data: {
                company: t.name,
                representative: t.representative ?? undefined,
                phone: t.phone ?? undefined,
                poBox: t.poBox ?? undefined,
                notes: t.notes ?? undefined,
              },
            });
            claimedTenants.add(created.id);
            tenantByKey.set(norm(t.name), created);
            tenantDbId.set(t.tid, created.id);
            counts.tenantsCreated++;
          }
        }

        // ---------------------------------------------------------------- properties
        const claimedProps = new Set<string>();
        const propDbId = new Map<string, string>(); // dataset uid -> db id
        const tenantNamesByUid = new Map<string, Set<string>>();
        for (const l of leases) {
          const t = tenants.find((x) => x.tid === l.tid);
          if (!t) continue;
          const set = tenantNamesByUid.get(l.uid) ?? new Set<string>();
          for (const n of [t.name, ...t.aliases]) set.add(norm(n));
          tenantNamesByUid.set(l.uid, set);
        }
        for (const u of units) {
          const codes = new Set([norm(u.unitCode), ...u.legacyCodes.map(norm)]);
          const candidates = existingProps.filter(
            (p) => !claimedProps.has(p.id) && p.unitCode && codes.has(norm(p.unitCode)),
          );
          let match: (typeof existingProps)[number] | undefined;
          if (candidates.length === 1) {
            match = candidates[0];
          } else if (candidates.length > 1) {
            const wanted = tenantNamesByUid.get(u.uid) ?? new Set<string>();
            match = candidates.find((p) => p.leases.some((l) => wanted.has(tenantKey(l.tenant))));
          }
          const data = {
            name: u.name,
            category: u.category as Prisma.PropertyCreateInput["category"],
            unitCode: u.unitCode,
            floor: u.floor,
            dimension: u.areaM2,
            areaLabel: u.areaLabel,
            price: u.askingRent,
            status: u.status as Prisma.PropertyCreateInput["status"],
          };
          if (match) {
            claimedProps.add(match.id);
            await tx.property.update({ where: { id: match.id }, data: { ...data, buildingId: building.id } });
            propDbId.set(u.uid, match.id);
            counts.propertiesUpdated++;
          } else {
            const created = await tx.property.create({
              data: { ...data, address: bMeta.name, city: "Lomé", buildingId: building.id },
            });
            claimedProps.add(created.id);
            propDbId.set(u.uid, created.id);
            counts.propertiesCreated++;
          }
        }
        const untouched = existingProps.filter((p) => !claimedProps.has(p.id));
        if (untouched.length > 0) {
          notes.push(
            `${untouched.length} existing unit(s) of this building are not in the new register and were left as they are: ${untouched
              .map((p) => p.unitCode ?? p.name)
              .join(", ")}`,
          );
        }

        // ---------------------------------------------------------------- leases, payments, reviews
        // Pass 1: match each dataset lease to an existing lease of the same tenant on the same unit.
        // Pass 2: a renamed tenant (alias) keeps the lease it already had.
        type ExistingLease = (typeof existingProps)[number]["leases"][number];
        const leasesByProp = new Map<string, ExistingLease[]>();
        for (const p of existingProps) leasesByProp.set(p.id, p.leases);
        const usedLeases = new Set<string>();
        const matched = new Map<string, ExistingLease>(); // dataset lid -> existing lease
        for (const l of leases) {
          const propertyId = propDbId.get(l.uid)!;
          const tenantId = tenantDbId.get(l.tid)!;
          const nameKey = norm(tenants.find((x) => x.tid === l.tid)?.name);
          // same tenant record, or another record with the same name (duplicates get merged)
          const hit = (leasesByProp.get(propertyId) ?? [])
            .filter((x) => (x.tenantId === tenantId || tenantKey(x.tenant) === nameKey) && !usedLeases.has(x.id))
            .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0];
          if (hit) {
            usedLeases.add(hit.id);
            matched.set(l.lid, hit);
          }
        }
        for (const l of leases) {
          if (matched.has(l.lid)) continue;
          const propertyId = propDbId.get(l.uid)!;
          const t = tenants.find((x) => x.tid === l.tid)!;
          const aliasKeys = t.aliases.map(norm);
          if (aliasKeys.length === 0) continue;
          const hit = (leasesByProp.get(propertyId) ?? []).find(
            (x) => !usedLeases.has(x.id) && aliasKeys.includes(tenantKey(x.tenant)),
          );
          if (hit) {
            usedLeases.add(hit.id);
            matched.set(l.lid, hit);
          }
        }

        const leaseDbId = new Map<string, string>(); // dataset lid -> db id
        for (const l of leases) {
          const propertyId = propDbId.get(l.uid)!;
          const tenantId = tenantDbId.get(l.tid)!;
          const fields = {
            startDate: d(l.startDate)!,
            endDate: d(l.endDate),
            rentAmount: l.rent ?? 0,
            billingFrequency: "MONTHLY" as const,
            depositAmount: l.depositAmount,
            depositLabel: l.depositLabel,
            status: l.status as "ACTIVE" | "PENDING" | "ENDED" | "TERMINATED",
            ledgerStartDate: d(l.ledgerStartDate),
            needsReview: l.needsReview,
            reviewReason: l.reviewReason,
          };
          const existing = matched.get(l.lid);
          let leaseId: string;
          if (existing) {
            // Without an explicit billing start the ledger counts every payment of the lease. If the
            // lease already carries payments from before its start (earlier statements), pin the
            // billing start so those older receipts are not used to pay the current periods.
            if (!fields.ledgerStartDate) {
              const monthStart = new Date(Date.UTC(fields.startDate.getUTCFullYear(), fields.startDate.getUTCMonth(), 1));
              const older = await tx.payment.count({
                where: { leaseId: existing.id, kind: { in: ["RENT", "ARREARS"] }, date: { lt: monthStart } },
              });
              if (older > 0) fields.ledgerStartDate = fields.startDate;
            }
            await tx.lease.update({ where: { id: existing.id }, data: { ...fields, tenantId } });
            leaseId = existing.id;
            counts.leasesUpdated++;
          } else {
            const created = await tx.lease.create({ data: { ...fields, propertyId, tenantId } });
            leaseId = created.id;
            counts.leasesCreated++;
          }
          leaseDbId.set(l.lid, leaseId);

          // payments
          const existingPays = await tx.payment.findMany({
            where: { leaseId },
            include: { attachments: { select: { id: true } } },
          });
          // Several identical payments on the same day are real (e.g. three quarters paid at once),
          // so each existing payment can satisfy only one dataset payment.
          const pool = new Map<string, typeof existingPays>();
          for (const p of existingPays) {
            const k = `${ymd(p.date)}|${Math.round(p.amount)}|${p.kind}`;
            pool.set(k, [...(pool.get(k) ?? []), p]);
          }
          const consumed = new Set<string>();
          const entryKinds = new Set(
            existingPays.filter((p) => p.kind === "DEPOSIT" || p.kind === "ADVANCE_AT_ENTRY").map((p) => p.kind),
          );
          const toCreate: Prisma.PaymentCreateManyInput[] = [];
          for (const p of l.payments) {
            const key = `${p.date}|${Math.round(p.amount)}|${p.kind}`;
            const isEntry = p.notes.startsWith("Rapport :");
            const hit = (pool.get(key) ?? []).find((x) => !consumed.has(x.id));
            if (hit) {
              consumed.add(hit.id);
              counts.paymentsSkipped++;
              continue;
            }
            if (isEntry && entryKinds.has(p.kind as "DEPOSIT" | "ADVANCE_AT_ENTRY")) {
              counts.paymentsSkipped++;
              continue;
            }
            toCreate.push({
              leaseId,
              amount: p.amount,
              date: d(p.date)!,
              kind: p.kind as Prisma.PaymentCreateManyInput["kind"],
              monthsCovered: p.monthsCovered ?? undefined,
              confirmed: true,
              notes: p.notes,
            });
          }
          if (toCreate.length > 0) {
            await tx.payment.createMany({ data: toCreate });
            counts.paymentsCreated += toCreate.length;
          }

          // leftovers dated 2026 that the statements do not contain
          const yearStart = new Date("2026-01-01T00:00:00Z");
          const yearEnd = new Date("2027-01-01T00:00:00Z");
          const leftovers = existingPays.filter(
            (p) =>
              !consumed.has(p.id) &&
              p.date >= yearStart &&
              p.date < yearEnd &&
              p.recordedById === null &&
              p.attachments.length === 0,
          );
          if (options.replaceOld) {
            const leaseStart = d(l.startDate)!;
            for (const p of leftovers) {
              const isEntry = (p.notes ?? "").startsWith("Rapport :");
              if (isEntry && leaseStart < yearStart) {
                // an entry deposit/advance whose real date was unknown: file it at the lease start
                await tx.payment.update({ where: { id: p.id }, data: { date: leaseStart } });
                counts.paymentsRedated++;
              } else {
                await tx.payment.delete({ where: { id: p.id } });
                counts.paymentsRemoved++;
              }
            }
          } else if (leftovers.length > 0) {
            notes.push(
              `${l.tenantName} (${units.find((u) => u.uid === l.uid)?.unitCode}): ${leftovers.length} older 2026 payment(s) from the April import are not in the statements — tick "replace" to clean them up, otherwise they may be counted twice.`,
            );
          }

          // rent reviews
          if (l.reviews.length > 0) {
            const existingReviews = await tx.rentReview.findMany({ where: { leaseId } });
            for (const rv of l.reviews) {
              const due = d(rv.dueDate)!;
              if (existingReviews.some((x) => Math.abs(x.dueDate.getTime() - due.getTime()) < 20 * 86400000)) continue;
              await tx.rentReview.create({
                data: { leaseId, dueDate: due, rate: rv.rate, appliedAt: rv.applied ? due : null },
              });
              counts.reviewsCreated++;
            }
          }

          // register comments as follow-up notes
          if (l.followUps.length > 0) {
            const existingFollowUps = await tx.followUp.findMany({ where: { leaseId } });
            for (const f of l.followUps) {
              if (existingFollowUps.some((x) => (x.response ?? "") === f.response)) continue;
              await tx.followUp.create({
                data: { leaseId, date: d(f.date)!, action: "CALL_VISIT", response: f.response },
              });
              counts.followUpsCreated++;
            }
          }
        }

        // ---------------------------------------------------------------- superseded leases
        // An old live lease on a unit whose tenant has changed in the new register is closed
        // the day before the new tenant's lease starts (its history and payments are kept).
        for (const u of units) {
          const propertyId = propDbId.get(u.uid)!;
          const current = leases.filter((l) => l.uid === u.uid && (l.status === "ACTIVE" || l.status === "PENDING"));
          if (current.length === 0) continue;
          const earliestCurrent = current.map((l) => l.startDate).sort()[0];
          for (const old of leasesByProp.get(propertyId) ?? []) {
            if (usedLeases.has(old.id) || (old.status !== "ACTIVE" && old.status !== "PENDING")) continue;
            const end = new Date(d(earliestCurrent)!.getTime() - 86400000);
            const endDate = end > old.startDate ? end : old.startDate;
            await tx.lease.update({ where: { id: old.id }, data: { status: "ENDED", endDate } });
            counts.leasesEnded++;
            notes.push(
              `${tenantKey(old.tenant)} (${u.unitCode}) is no longer the tenant in the new register: its lease was closed on ${ymd(endDate)} (history kept).`,
            );
          }
        }

        // ---------------------------------------------------------------- expenses
        // Booked on the first unit of the building (as before). Matching ignores which unit of the
        // building an existing expense sits on, so the April import's expenses are recognised.
        const dsExpenses = dataset.expenses.filter((e) => e.building === buildingKey);
        if (dsExpenses.length > 0) {
          const anchorId = propDbId.get((dataset.anchors as Record<string, string>)[buildingKey]);
          if (!anchorId) throw new Error(`No anchor unit for ${buildingKey}`);
          const buildingPropIds = [...new Set([...propDbId.values(), ...existingProps.map((p) => p.id)])];
          const existingExp = await tx.expense.findMany({
            where: { propertyId: { in: buildingPropIds } },
            include: { attachments: { select: { id: true } } },
          });
          const expPool = new Map<string, typeof existingExp>();
          for (const x of existingExp) {
            const k = `${ymd(x.date)}|${Math.round(x.amount)}|${x.category}`;
            expPool.set(k, [...(expPool.get(k) ?? []), x]);
          }
          const expConsumed = new Set<string>();
          const expCreate: Prisma.ExpenseCreateManyInput[] = [];
          for (const e of dsExpenses) {
            const k = `${e.date}|${Math.round(e.amount)}|${e.category}`;
            const hit = (expPool.get(k) ?? []).find((x) => !expConsumed.has(x.id));
            if (hit) {
              expConsumed.add(hit.id);
              counts.expensesSkipped++;
              continue;
            }
            expCreate.push({
              propertyId: anchorId,
              category: e.category as Prisma.ExpenseCreateManyInput["category"],
              amount: e.amount,
              date: d(e.date)!,
              description: e.description,
            });
          }
          if (expCreate.length > 0) {
            await tx.expense.createMany({ data: expCreate });
            counts.expensesCreated += expCreate.length;
          }
          const expYearStart = new Date("2026-01-01T00:00:00Z");
          const expYearEnd = new Date("2027-01-01T00:00:00Z");
          const expLeftovers = existingExp.filter(
            (x) =>
              !expConsumed.has(x.id) &&
              x.date >= expYearStart &&
              x.date < expYearEnd &&
              x.recordedById === null &&
              x.attachments.length === 0,
          );
          if (options.replaceOld) {
            for (const x of expLeftovers) {
              await tx.expense.delete({ where: { id: x.id } });
              counts.expensesRemoved++;
            }
          } else if (expLeftovers.length > 0) {
            notes.push(
              `${bMeta.name}: ${expLeftovers.length} older 2026 expense(s) from the April import are not in the statements — tick "replace" to clean them up, otherwise they may be counted twice.`,
            );
          }
        }

        // ---------------------------------------------------------------- data issues
        const existingIssues = await tx.dataIssue.findMany({
          where: { leaseId: { in: [...leaseDbId.values()] } },
        });
        for (const i of issues) {
          const leaseId = leaseDbId.get(i.ref);
          if (!leaseId) continue;
          if (existingIssues.some((x) => x.leaseId === leaseId && x.problem === i.problem)) continue;
          await tx.dataIssue.create({ data: { leaseId, problem: i.problem, action: i.action ?? undefined } });
          counts.issuesCreated++;
        }

        const result: SyncResult = { building: bMeta.name, applied: apply, counts, notes };
        if (!apply) throw new DryRunRollback(result);
        return result;
      },
      { timeout: 55_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (e instanceof DryRunRollback) return e.result;
    throw e;
  }
}
