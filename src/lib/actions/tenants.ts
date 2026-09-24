"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readTenantFields(formData: FormData) {
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const company = String(formData.get("company") ?? "").trim() || null;
  const idNumber = String(formData.get("idNumber") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!firstName || !lastName) {
    throw new Error("First and last name are required.");
  }

  return { firstName, lastName, email, phone, company, idNumber, address, city, notes };
}

export async function createTenant(formData: FormData) {
  const data = readTenantFields(formData);
  const tenant = await prisma.tenant.create({ data });

  revalidatePath("/tenants");
  redirect(`/tenants/${tenant.id}`);
}

export async function updateTenant(tenantId: string, formData: FormData) {
  const data = readTenantFields(formData);

  await prisma.tenant.update({ where: { id: tenantId }, data });

  revalidatePath("/tenants");
  revalidatePath(`/tenants/${tenantId}`);
  redirect(`/tenants/${tenantId}`);
}

export async function deleteTenant(tenantId: string) {
  await prisma.tenant.delete({ where: { id: tenantId } });
  revalidatePath("/tenants");
  redirect("/tenants");
}
