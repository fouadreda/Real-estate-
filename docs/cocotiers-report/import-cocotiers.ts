/**
 * Import the SCI Les Cocotiers report (02/04/2026) AND the Jan-Aug 2026
 * monthly income/expense ledgers into realestate-manager.
 * Run AFTER applying the schema changes in APP_SPEC.md section 4:
 *   npx tsx docs/cocotiers-report/import-cocotiers.ts
 * Reads cocotiers_import.json + monthly_import.json from the same folder.
 * Runs in one transaction. Refuses to run twice (checks for Immeuble Assigame).
 */
import { PrismaClient, PropertyCategory, BuildingType, PaymentKind, ExpenseCategory } from "@prisma/client";
import data from "./cocotiers_import.json";
import monthly from "./monthly_import.json";

const prisma = new PrismaClient();

const buildingType: Record<string, BuildingType> = {
  Immeuble: "BUILDING",
  Villa: "VILLA",
  "Entrepôt": "WAREHOUSE_SITE",
};

function category(type: string, code: string): PropertyCategory {
  if (type === "Villa") return "VILLA";
  if (type === "Entrepôt") return "WAREHOUSE";
  if (/APP|STU/i.test(code)) return "APARTMENT";
  return "SHOP";
}

const paymentKind: Record<string, PaymentKind> = {
  "Loyer d'avance à l'entrée": "ADVANCE_AT_ENTRY",
  Loyer: "RENT",
  "Arriérés": "ARREARS",
  Caution: "DEPOSIT",
  "Remboursement caution": "DEPOSIT_REFUND",
  Autre: "OTHER",
};

const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

async function main() {
  const already = await prisma.building.findFirst({ where: { name: "Immeuble Assigame" } });
  if (already) {
    throw new Error("Import already run (Immeuble Assigame exists) — aborting to avoid duplicating data.");
  }

  await prisma.$transaction(
    async (tx) => {
      // ---------- Buildings ----------
      const buildingIds: Record<string, string> = {};
      for (const u of data.units) {
        if (buildingIds[u.building]) continue;
        const b = await tx.building.upsert({
          where: { name: u.building },
          update: {},
          create: { name: u.building, type: buildingType[u.type] },
        });
        buildingIds[u.building] = b.id;
      }

      // ---------- Units -> Property ----------
      const unitIds: Record<string, string> = {};
      for (const u of data.units) {
        const p = await tx.property.create({
          data: {
            name: `${u.building} · ${u.code}`,
            category: category(u.type, u.code),
            address: u.building,
            city: "Lomé",
            dimension: u.areaM2 ?? undefined,
            areaLabel: u.areaLabel ?? undefined,
            price: u.askingRent ?? undefined,
            status: u.status === "Occupé" ? "OCCUPIED" : "VACANT",
            buildingId: buildingIds[u.building],
            floor: u.floor ?? undefined,
            unitCode: u.code,
          },
        });
        unitIds[u.id] = p.id;
      }

      // ---------- Tenants (situation report) ----------
      const tenantIds: Record<string, string> = {};
      for (const t of data.tenants) {
        const created = await tx.tenant.create({
          data: {
            company: t.name,
            representative: t.representative ?? undefined,
            phone: t.phone ? `+228 ${t.phone}` : undefined,
            poBox: t.poBox ?? undefined,
            notes: t.nameInReport !== t.name ? `Nom dans le rapport : ${t.nameInReport}` : undefined,
          },
        });
        tenantIds[t.id] = created.id;
      }

      // ---------- Leases + deposits (situation report) ----------
      const deposits = Object.fromEntries(data.deposits.map((x) => [x.leaseId, x]));
      const leaseIds: Record<string, string> = {};
      for (const l of data.leases) {
        const dep = deposits[l.id];
        const created = await tx.lease.create({
          data: {
            propertyId: unitIds[l.unitId],
            tenantId: tenantIds[l.tenantId],
            startDate: d(l.startDate) ?? d(l.paidThrough) ?? new Date("2026-04-02T00:00:00Z"),
            endDate: null, // tacit renewal
            rentAmount: l.rent ?? 0,
            billingFrequency: "MONTHLY",
            depositAmount: dep?.amountHeld ?? 0,
            depositLabel: dep?.label ?? undefined,
            ledgerStartDate: d(l.paidThrough),
            needsReview: l.needsReview,
            reviewReason: l.reviewReason ?? undefined,
            status: "ACTIVE",
          },
        });
        leaseIds[l.id] = created.id;
      }

      // ---------- Payments (situation report comments; entry advances + deposits) ----------
      for (const p of data.payments) {
        if (!leaseIds[p.leaseId] || p.amount == null) continue;
        await tx.payment.create({
          data: {
            leaseId: leaseIds[p.leaseId],
            amount: p.amount,
            date: d(p.date) ?? new Date("2026-04-02T00:00:00Z"),
            kind: paymentKind[p.kind] ?? "OTHER",
            monthsCovered: p.monthsCovered ?? undefined,
            receiptNumber: p.receiptNo ?? undefined,
            method: p.method ?? undefined,
            confirmed: p.confirmed,
            notes: p.source ?? undefined,
          },
        });
      }

      // ---------- Follow-ups (situation report comments) ----------
      for (const f of data.followUps) {
        await tx.followUp.create({
          data: {
            leaseId: leaseIds[f.leaseId],
            date: d(f.date)!,
            action: "CALL_VISIT",
            response: f.response ?? undefined,
            promiseDate: d(f.promiseDate) ?? undefined,
            promiseAmount: f.promiseAmount ?? undefined,
          },
        });
      }

      // ---------- Data issues (situation report) ----------
      for (const i of data.dataIssues) {
        await tx.dataIssue.create({
          data: {
            leaseId: i.ref?.startsWith("B") ? leaseIds[i.ref] : undefined,
            propertyId: i.ref?.startsWith("L") ? unitIds[i.ref] : undefined,
            problem: `${i.building} · ${i.code} · ${i.tenant} : ${i.problem}`,
            action: i.action ?? undefined,
          },
        });
      }

      // ================= Jan-Aug 2026 monthly ledgers =================

      // ---------- New tenants (found in the monthly income ledgers) ----------
      const monthlyTenantIds: Record<string, string> = {};
      for (const t of monthly.newTenants) {
        const created = await tx.tenant.create({ data: { company: t.name } });
        monthlyTenantIds[t.id] = created.id;
      }

      // ---------- New active leases (previously-vacant units, now occupied) ----------
      const monthlyLeaseIds: Record<string, string> = {};
      for (const l of monthly.newActiveLeases) {
        const created = await tx.lease.create({
          data: {
            propertyId: unitIds[l.unitId],
            tenantId: monthlyTenantIds[l.tenantId],
            startDate: d(l.startDate)!,
            endDate: null,
            rentAmount: l.rent ?? 0,
            billingFrequency: "MONTHLY",
            ledgerStartDate: d(l.paidThrough),
            needsReview: true,
            reviewReason: "Nouveau locataire détecté dans les relevés mensuels (unité marquée vacante dans le rapport d'avril) — à confirmer.",
            status: "ACTIVE",
          },
        });
        monthlyLeaseIds[l.id] = created.id;
        await tx.property.update({ where: { id: unitIds[l.unitId] }, data: { status: "OCCUPIED" } });
        for (const row of l.rows) {
          await tx.payment.create({
            data: {
              leaseId: created.id, amount: row.amount, date: d(row.date)!,
              kind: "RENT", monthsCovered: row.monthsCovered ?? undefined,
              confirmed: true, notes: row.notes,
            },
          });
        }
      }

      // ---------- Historical/ended leases (former tenants, now departed) ----------
      for (const l of monthly.newHistoricalLeases) {
        const created = await tx.lease.create({
          data: {
            propertyId: unitIds[l.unitId],
            tenantId: monthlyTenantIds[l.tenantId],
            startDate: d(l.startDate)!,
            endDate: d(l.endDate),
            rentAmount: l.rent ?? 0,
            billingFrequency: "MONTHLY",
            ledgerStartDate: d(l.startDate),
            needsReview: true,
            reviewReason: "Ancien locataire retrouvé dans les relevés mensuels 2025 — parti avant le rapport d'avril 2026, historique conservé pour mémoire.",
            status: "ENDED",
          },
        });
        for (const row of l.rows) {
          await tx.payment.create({
            data: {
              leaseId: created.id, amount: row.amount, date: d(row.date)!,
              kind: "RENT", monthsCovered: row.monthsCovered ?? undefined,
              confirmed: true, notes: row.notes,
            },
          });
        }
      }

      // ---------- Matched payments against existing leases ----------
      let skippedPayments = 0;
      for (const p of monthly.matchedPayments) {
        if (!leaseIds[p.leaseId]) { skippedPayments++; continue; }
        await tx.payment.create({
          data: {
            leaseId: leaseIds[p.leaseId], amount: p.amount, date: d(p.date)!,
            kind: "RENT", monthsCovered: p.monthsCovered ?? undefined,
            confirmed: true, notes: p.notes,
          },
        });
      }

      // ---------- Expenses (anchored on the first property of each building group) ----------
      let skippedExpenses = 0;
      for (const e of monthly.expenses) {
        if (!unitIds[e.anchorPropertyId]) { skippedExpenses++; continue; }
        await tx.expense.create({
          data: {
            propertyId: unitIds[e.anchorPropertyId],
            category: e.category as ExpenseCategory,
            amount: e.amount, date: d(e.date)!, description: e.description,
          },
        });
      }

      if (skippedPayments || skippedExpenses) {
        console.log(`Skipped ${skippedPayments} payments and ${skippedExpenses} expenses (unresolved property/lease id).`);
      }
    },
    { timeout: 300_000 },
  );

  console.log("Reminder: record the 4 500 000 F deposit refund owed to SOCIETE FAS AGRIC (ENTREPOT VON FAN MILK) — paid 2026-03-19 per the monthly ledger, no lease record exists for this departed tenant.");
  console.log("Excluded as out-of-scope: 31 electricity/maintenance collection lines (1 410 000 F) — not rent, not modeled as Payments.");
  console.log("Expected after situation-report import:", data.expected);
}

main()
  .catch((e) => {
    console.error("Import failed, nothing was written:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
