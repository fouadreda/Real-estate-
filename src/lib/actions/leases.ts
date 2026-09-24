"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BillingFrequency, LeaseStatus } from "@prisma/client";

export async function createLease(formData: FormData) {
  const propertyId = String(formData.get("propertyId") ?? "");
  const tenantId = String(formData.get("tenantId") ?? "");
  const startDate = new Date(String(formData.get("startDate") ?? ""));
  const endDate = new Date(String(formData.get("endDate") ?? ""));
  const rentAmount = Number(formData.get("rentAmount") ?? 0);
  const billingFrequency = String(formData.get("billingFrequency") ?? "MONTHLY") as BillingFrequency;
  const depositAmount = Number(formData.get("depositAmount") ?? 0);

  if (!propertyId || !tenantId || Number.isNaN(rentAmount)) {
    throw new Error("Property, tenant, and rent amount are required.");
  }

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
  const startDate = new Date(String(formData.get("startDate") ?? ""));
  const endDate = new Date(String(formData.get("endDate") ?? ""));
  const rentAmount = Number(formData.get("rentAmount") ?? 0);
  const billingFrequency = String(formData.get("billingFrequency") ?? "MONTHLY") as BillingFrequency;
  const depositAmount = Number(formData.get("depositAmount") ?? 0);

  if (Number.isNaN(rentAmount) || !startDate.getTime() || !endDate.getTime()) {
    throw new Error("Valid start date, end date, and rent amount are required.");
  }

  await prisma.lease.update({
    where: { id: leaseId },
    data: { startDate, endDate, rentAmount, billingFrequency, depositAmount },
  });

  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/leases");
  redirect(`/leases/${leaseId}`);
}

export async function updateLeaseStatus(leaseId: string, status: LeaseStatus) {
  const lease = await prisma.lease.update({
    where: { id: leaseId },
    data: { status },
    include: { property: true },
  });

  if (status === "ENDED" || status === "TERMINATED") {
    await prisma.property.update({ where: { id: lease.propertyId }, data: { status: "VACANT" } });
  } else if (status === "ACTIVE") {
    await prisma.property.update({ where: { id: lease.propertyId }, data: { status: "OCCUPIED" } });
  }

  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/leases");
  revalidatePath("/properties");
}

export async function deleteLease(leaseId: string) {
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  await prisma.lease.delete({ where: { id: leaseId } });
  if (lease) {
    await prisma.property.update({ where: { id: lease.propertyId }, data: { status: "VACANT" } });
  }
  revalidatePath("/leases");
  revalidatePath("/properties");
  redirect("/leases");
}
