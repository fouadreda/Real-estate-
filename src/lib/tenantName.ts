interface TenantLike {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
}

/** Display name for a tenant: person name when set, else the company name. */
export function tenantDisplayName(tenant: TenantLike): string {
  const personName = [tenant.firstName, tenant.lastName].filter(Boolean).join(" ").trim();
  if (personName) return personName;
  if (tenant.company) return tenant.company;
  return "—";
}
