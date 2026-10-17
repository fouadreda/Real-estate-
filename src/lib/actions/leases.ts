"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BillingFrequency, LeaseStatus } from "@prisma/client";

function parseOptionalDate(value: FormDataEntryValue | null): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function createLease(formData: FormData) {
  await requireUser();
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
  });

  await prisma.property.update({ where: { id: propertyId }, data: { status: "OCCUPIED" } });

  revalidatePath("/leases");
  revalidatePath("/properties");
  redirect(`/leases/${lease.id}`);
}

export async function updateLease(leaseId: string, formData: FormData) {
  await requireUser();
  const startDate = new Date(String(formData.get("startDate") ?? ""));
  const endDate = parseOptionalDate(formData.get("endDate"));
  const rentAmount = Number(formData.get("rentAmount") ?? 0);
  const billingFrequency = String(formData.get("billingFrequency") ?? "MONTHLY") as BillingFrequency;
  const depositAmount = Number(formData.get("depositAmount") ?? 0);

  if (Number.isNaN(rentAmount) || rentAmount < 0 || Number.isNaN(startDate.getTime())) {
    redirect(`/leases/${leaseId}/edit?error=leaseFields`);
  }
  if (endDate && endDate <= startDate) redirect(`/leases/${leaseId}/edit?error=leaseDates`);

  await prisma.lease.update({
    where: { id: leaseId },
    data: { startDate, endDate, rentAmount, billingFrequency, depositAmount },
  });

  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/leases");
  redirect(`/leases/${leaseId}`);
}

export async function updateLeaseStatus(leaseId: string, status: LeaseStatus) {
  await requireUser();
  const current = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId }, select: { closedAt: true } });
  // Closing a lease records the day it was closed (rent stops there); reopening it clears that day again.
  const closing = status === "ENDED" || status === "TERMINATED";
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const lease = await prisma.lease.update({
    where: { id: leaseId },
    data: { status, closedAt: closing ? (current.closedAt ?? today) : null },
  });

  if (status === "ENDED" || status === "TERMINATED") {
    await prisma.property.update({ where: { id: lease.propertyId }, data: { status: "VACANT" } });
  } else if (status === "ACTIVE") {
    await prisma.property.update({ where: { id: lease.propertyId }, data: { status: "OCCUPIED" } });
  }

  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/leases");
  revalidatePath("/properties");
  redirect(`/leases/${leaseId}`);
}

export async function deleteLease(leaseId: string) {
  await requireUser();
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  await prisma.lease.delete({ where: { id: leaseId } });
  if (lease) {
    await prisma.property.update({ where: { id: lease.propertyId }, data: { status: "VACANT" } });
  }
  revalidatePath("/leases");
  revalidatePath("/properties");
  redirect("/leases");
}
