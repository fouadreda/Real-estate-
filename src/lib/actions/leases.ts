"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BillingFrequency, LeaseStatus } from "@prisma/client";
import { changedFields, describe, logChange } from "@/lib/changeLog";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";

function parseOptionalDate(value: FormDataEntryValue | null): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A lease change moves balances, occupancy and totals on every page: refresh them all. */
function refreshAll() {
  revalidatePath("/", "layout");
}

/**
 * A unit is occupied while it has an active lease. Recomputed after any lease change so the
 * Vacant/Occupied flag never drifts; a unit under maintenance stays so until staff change it.
 */
async function refreshUnitStatus(propertyId: string) {
  const [unit, active] = await Promise.all([
    prisma.property.findUnique({ where: { id: propertyId }, select: { status: true } }),
    prisma.lease.count({ where: { propertyId, status: "ACTIVE" } }),
  ]);
  if (!unit || unit.status === "MAINTENANCE") return;
  const status = active > 0 ? "OCCUPIED" : "VACANT";
  if (status !== unit.status) await prisma.property.update({ where: { id: propertyId }, data: { status } });
}

const leaseInclude = { tenant: true, property: { include: { building: true } } } as const;
const label = (lease: Parameters<typeof leaseLocationName>[0] & { tenant: Parameters<typeof tenantDisplayName>[0] }) =>
  `${leaseLocationName(lease)} (${tenantDisplayName(lease.tenant)})`;

export async function createLease(formData: FormData) {
  const user = await requireUser();
  const propertyId = String(formData.get("propertyId") ?? "");
  const tenantId = String(formData.get("tenantId") ?? "");
  const startDate = new Date(String(formData.get("startDate") ?? ""));
  const endDate = parseOptionalDate(formData.get("endDate"));
  const rentAmount = Number(formData.get("rentAmount") ?? 0);
  const billingFrequency = String(formData.get("billingFrequency") ?? "MONTHLY") as BillingFrequency;
  const depositAmount = Number(formData.get("depositAmount") ?? 0);

  const back = `/leases/new?${new URLSearchParams({ ...(propertyId ? { propertyId } : {}), ...(tenantId ? { tenantId } : {}) })}`;
  if (!propertyId || !tenantId || Number.isNaN(rentAmount) || rentAmount < 0 || Number.isNaN(startDate.getTime())) {
    redirect(`${back}&error=leaseFields`);
  }
  if (endDate && endDate <= startDate) redirect(`${back}&error=leaseDates`);

  const lease = await prisma.lease.create({
    data: {
      propertyId,
      tenantId,
      startDate,
      endDate,
      rentAmount,
      billingFrequency,
      depositAmount,
      status: LeaseStatus.ACTIVE,
    },
    include: leaseInclude,
  });

  await refreshUnitStatus(propertyId);
  await logChange(user, {
    entity: "lease",
    entityId: lease.id,
    leaseId: lease.id,
    action: "created",
    summary: `${label(lease)} · ${describe.money(rentAmount)} ${describe.code(billingFrequency)} · début ${describe.day(startDate)}`,
  });
  refreshAll();
  redirect(`/leases/${lease.id}`);
}

/**
 * Saves a corrected lease. Every term can change, including the tenant and the unit (a lease created
 * on the wrong one is fixed without losing its payments) and the billing start that Paid until counts from.
 */
export async function updateLease(leaseId: string, formData: FormData) {
  const user = await requireUser();
  const before = await prisma.lease.findUnique({ where: { id: leaseId }, include: leaseInclude });
  if (!before) redirect("/leases");

  const startDate = new Date(String(formData.get("startDate") ?? ""));
  const endDate = parseOptionalDate(formData.get("endDate"));
  const rentAmount = Number(formData.get("rentAmount") ?? 0);
  const billingFrequency = String(formData.get("billingFrequency") ?? "MONTHLY") as BillingFrequency;
  const depositAmount = Number(formData.get("depositAmount") ?? 0);
  const tenantId = String(formData.get("tenantId") ?? "").trim() || before.tenantId;
  const propertyId = String(formData.get("propertyId") ?? "").trim() || before.propertyId;
  // the billing start moves every balance of the lease: an emptied box is refused unless staff tick
  // "bill from the start date", so a slip of the keyboard cannot wipe it
  const billFromStart = formData.get("billFromStart") === "on";
  const typedBillingStart = parseOptionalDate(formData.get("ledgerStartDate"));
  const ledgerStartDate = billFromStart ? null : formData.has("ledgerStartDate") ? typedBillingStart : before.ledgerStartDate;

  if (Number.isNaN(rentAmount) || rentAmount < 0 || Number.isNaN(startDate.getTime())) {
    redirect(`/leases/${leaseId}/edit?error=leaseFields`);
  }
  if (endDate && endDate <= startDate) redirect(`/leases/${leaseId}/edit?error=leaseDates`);
  if (!billFromStart && before.ledgerStartDate && !ledgerStartDate) redirect(`/leases/${leaseId}/edit?error=billingStartEmpty`);
  // checked only when staff change these dates, so a billing start stored at import (a lease paid years
  // ahead) never blocks correcting the other terms
  const time = (d: Date | null) => d?.getTime() ?? null;
  const billingStartChanged = time(ledgerStartDate) !== time(before.ledgerStartDate);
  const datesChanged = billingStartChanged || time(startDate) !== time(before.startDate) || time(endDate) !== time(before.endDate);
  if (ledgerStartDate && datesChanged && ledgerStartDate < startDate) redirect(`/leases/${leaseId}/edit?error=billingStart`);
  // a typo in the year (2062 for 2026) would show years of rent as paid ahead or owed
  const latestBillingStart = new Date(Math.max(Date.now(), startDate.getTime()));
  latestBillingStart.setUTCFullYear(latestBillingStart.getUTCFullYear() + 1);
  if (
    ledgerStartDate &&
    ((datesChanged && endDate && ledgerStartDate >= endDate) || (billingStartChanged && ledgerStartDate > latestBillingStart))
  ) {
    redirect(`/leases/${leaseId}/edit?error=billingStartLate`);
  }
  const [tenantExists, unitExists] = await Promise.all([
    prisma.tenant.count({ where: { id: tenantId } }),
    prisma.property.count({ where: { id: propertyId } }),
  ]);
  if (!tenantExists || !unitExists) redirect(`/leases/${leaseId}/edit?error=leaseFields`);

  const after = await prisma.lease.update({
    where: { id: leaseId },
    data: { startDate, endDate, rentAmount, billingFrequency, depositAmount, tenantId, propertyId, ledgerStartDate },
    include: leaseInclude,
  });

  // only a change of unit changes occupancy (a unit set to maintenance stays so when its rent is corrected)
  if (propertyId !== before.propertyId) {
    await refreshUnitStatus(before.propertyId);
    await refreshUnitStatus(propertyId);
  }
  await logChange(user, {
    entity: "lease",
    entityId: leaseId,
    leaseId,
    action: "updated",
    summary: `${changedFields([
      ["locataire", tenantDisplayName(before.tenant), tenantDisplayName(after.tenant)],
      ["local", leaseLocationName(before), leaseLocationName(after)],
      ["début", describe.day(before.startDate), describe.day(startDate)],
      ["fin", describe.day(before.endDate), describe.day(endDate)],
      ["début de facturation", describe.day(before.ledgerStartDate), describe.day(ledgerStartDate)],
      ["loyer", describe.money(before.rentAmount), describe.money(rentAmount)],
      ["périodicité", describe.code(before.billingFrequency), describe.code(billingFrequency)],
      ["caution", describe.money(before.depositAmount), describe.money(depositAmount)],
    ])} — ${label(after)}`,
  });
  refreshAll();
  redirect(`/leases/${leaseId}`);
}

/**
 * Changes a lease's status. Closing it (ended / terminated) records the closing day, chosen by staff
 * (today by default): rent stops being billed there. Reopening it clears that day again.
 */
export async function updateLeaseStatus(leaseId: string, status: LeaseStatus, formData?: FormData) {
  const user = await requireUser();
  const current = await prisma.lease.findUnique({ where: { id: leaseId }, include: leaseInclude });
  if (!current) redirect("/leases");
  const closing = status === "ENDED" || status === "TERMINATED";
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const chosen = formData ? parseOptionalDate(formData.get("closedAt")) : null;
  // saving a closed lease again with the date box left empty keeps what it had
  const closedAt = closing ? (chosen ?? (status === current.status ? current.closedAt : (current.closedAt ?? today))) : null;
  // (a lease that has not started yet can be closed before its start: cancelled before move-in, nothing billed)
  if (closing && closedAt && closedAt < current.startDate && current.startDate <= today) redirect(`/leases/${leaseId}?error=closedBeforeStart`);
  // a lease is closed on the day the tenant left; a planned end is the lease's end date (Edit lease)
  if (closing && closedAt && closedAt > today) redirect(`/leases/${leaseId}?error=closedInFuture`);
  // nothing changes (e.g. Enter pressed in the date box of an open lease): no save, no history line
  if (status === current.status && closedAt?.getTime() === current.closedAt?.getTime()) redirect(`/leases/${leaseId}`);

  await prisma.lease.update({ where: { id: leaseId }, data: { status, closedAt } });
  await refreshUnitStatus(current.propertyId);
  await logChange(user, {
    entity: "lease",
    entityId: leaseId,
    leaseId,
    action: "status",
    summary: `${
      status === current.status
        ? `date de clôture ${describe.day(current.closedAt)} → ${describe.day(closedAt)}`
        : `${describe.code(current.status)} → ${describe.code(status)}${closing ? ` (clôturé le ${describe.day(closedAt)})` : ""}`
    } — ${label(current)}`,
  });
  refreshAll();
  redirect(`/leases/${leaseId}`);
}

/**
 * "Données vérifiées": a lease flagged "à vérifier" at import is left out of every total until staff
 * confirm its figures. This puts it back in the totals (or flags it again). The reason is kept.
 */
export async function setLeaseVerified(leaseId: string, verified: boolean) {
  const user = await requireUser();
  const lease = await prisma.lease.update({ where: { id: leaseId }, data: { needsReview: !verified }, include: leaseInclude });
  await logChange(user, {
    entity: "lease",
    entityId: leaseId,
    leaseId,
    action: verified ? "verified" : "unverified",
    summary: `${verified ? "données vérifiées (comptées dans les totaux)" : "remis « à vérifier » (hors totaux)"} — ${label(lease)}`,
  });
  refreshAll();
  redirect(`/leases/${leaseId}`);
}

/**
 * Deletes a lease created by mistake. A lease that has payments or documents is refused: deleting it
 * would erase them too. Move the payments to the right lease (or delete them) and remove the documents
 * first, or mark the lease ended instead.
 */
export async function deleteLease(leaseId: string) {
  const user = await requireUser();
  const outcome = await prisma.$transaction(async (tx) => {
    // holds the lease row: a payment recorded on (or moved to) this lease meanwhile waits, then fails,
    // instead of being erased with it
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Lease" WHERE id = ${leaseId} FOR UPDATE`;
    if (locked.length === 0) return "gone" as const;
    const [payments, documents] = await Promise.all([
      tx.payment.count({ where: { leaseId } }),
      tx.attachment.count({ where: { leaseId } }),
    ]);
    if (payments > 0) return "leaseHasPayments" as const;
    if (documents > 0) return "leaseHasDocuments" as const;
    return tx.lease.delete({ where: { id: leaseId }, include: leaseInclude });
  });
  if (outcome === "gone") redirect("/leases");
  if (typeof outcome === "string") redirect(`/leases/${leaseId}?error=${outcome}`);
  const lease = outcome;
  await refreshUnitStatus(lease.propertyId);
  await logChange(user, {
    entity: "lease",
    entityId: leaseId,
    leaseId,
    action: "deleted",
    summary: `${label(lease)} · ${describe.money(lease.rentAmount)} · début ${describe.day(lease.startDate)}`,
  });
  refreshAll();
  redirect("/leases");
}
