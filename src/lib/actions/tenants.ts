"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { logChange } from "@/lib/changeLog";
import { tenantDisplayName } from "@/lib/tenantName";
import { redirect } from "next/navigation";

/** Reads the form; an invalid form goes back to `failUrl` with an error code. */
function readTenantFields(formData: FormData, failUrl: string) {
  const firstName = String(formData.get("firstName") ?? "").trim() || null;
  const lastName = String(formData.get("lastName") ?? "").trim() || null;
  const company = String(formData.get("company") ?? "").trim() || null;
  const representative = String(formData.get("representative") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const poBox = String(formData.get("poBox") ?? "").trim() || null;
  const idNumber = String(formData.get("idNumber") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!firstName && !lastName && !company) redirect(`${failUrl}?error=tenantName`);

  return { firstName, lastName, company, representative, email, phone, poBox, idNumber, address, city, notes };
}

export async function createTenant(formData: FormData) {
  const user = await requireUser();
  const data = readTenantFields(formData, "/tenants/new");
  const tenant = await prisma.tenant.create({ data });

  await logChange(user, { entity: "tenant", entityId: tenant.id, action: "created", summary: tenantDisplayName(tenant) });
  revalidatePath("/", "layout");
  redirect(`/tenants/${tenant.id}`);
}

export async function updateTenant(tenantId: string, formData: FormData) {
  const user = await requireUser();
  const data = readTenantFields(formData, `/tenants/${tenantId}/edit`);

  const tenant = await prisma.tenant.update({ where: { id: tenantId }, data });

  await logChange(user, { entity: "tenant", entityId: tenantId, action: "updated", summary: tenantDisplayName(tenant) });
  // the name shows on leases, Reports, Alerts and in the assistant: refresh every page
  revalidatePath("/", "layout");
  redirect(`/tenants/${tenantId}`);
}

export async function deleteTenant(tenantId: string) {
  const user = await requireUser();
  // deleting a tenant would also delete their leases and payments: only a tenant without leases can go
  if ((await prisma.lease.count({ where: { tenantId } })) > 0) redirect(`/tenants/${tenantId}?error=tenantHasLeases`);
  const tenant = await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => null);
  if (tenant) await logChange(user, { entity: "tenant", entityId: tenantId, action: "deleted", summary: tenantDisplayName(tenant) });
  revalidatePath("/", "layout");
  redirect("/tenants");
}
