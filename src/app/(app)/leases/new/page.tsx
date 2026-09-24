import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createLease } from "@/lib/actions/leases";
import { requireUserWithDictionary } from "@/lib/auth";

export default async function NewLeasePage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; tenantId?: string }>;
}) {
  const { propertyId, tenantId } = await searchParams;
  const { t } = await requireUserWithDictionary();

  const [vacantProperties, selectedProperty, tenants] = await Promise.all([
    prisma.property.findMany({
      where: { status: "VACANT" },
      orderBy: { name: "asc" },
    }),
    propertyId ? prisma.property.findUnique({ where: { id: propertyId } }) : null,
    prisma.tenant.findMany({ orderBy: { lastName: "asc" } }),
  ]);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href="/leases" className="text-sm text-brand-600 hover:underline">
          ← {t.leases.title}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{t.leaseNew.title}</h1>
      </div>

      {vacantProperties.length === 0 ? (
        <div className="card text-sm text-stone-500">
          {t.leaseNew.noVacantProperties}
        </div>
      ) : (
        <form action={createLease} className="card space-y-4">
          <div>
            <label className="label" htmlFor="propertyId">{t.leaseNew.property}</label>
            <select className="input" id="propertyId" name="propertyId" required defaultValue={propertyId ?? ""}>
              <option value="" disabled>
                {t.leaseNew.selectProperty}
              </option>
              {vacantProperties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name} — {property.address}, {property.city}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="tenantId">{t.leaseNew.tenant}</label>
            {tenants.length === 0 ? (
              <p className="text-sm text-stone-500">
                {t.leaseNew.noTenants}{" "}
                <Link href="/tenants/new" className="text-brand-600 hover:underline">
                  {t.leaseNew.addOneFirst}
                </Link>
                .
              </p>
            ) : (
              <select className="input" id="tenantId" name="tenantId" required defaultValue={tenantId ?? ""}>
                <option value="" disabled>
                  {t.leaseNew.selectTenant}
                </option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.firstName} {tenant.lastName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="startDate">{t.leaseNew.startDate}</label>
              <input className="input" id="startDate" name="startDate" type="date" required />
            </div>
            <div>
              <label className="label" htmlFor="endDate">{t.leaseNew.endDate}</label>
              <input className="input" id="endDate" name="endDate" type="date" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="rentAmount">{t.leaseNew.rentAmount}</label>
              <input
                className="input"
                id="rentAmount"
                name="rentAmount"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={selectedProperty?.price ?? undefined}
              />
            </div>
            <div>
              <label className="label" htmlFor="billingFrequency">{t.leaseNew.billingFrequency}</label>
              <select className="input" id="billingFrequency" name="billingFrequency" defaultValue="MONTHLY">
                <option value="MONTHLY">{t.leaseNew.monthly}</option>
                <option value="QUARTERLY">{t.leaseNew.quarterly}</option>
                <option value="SEMIANNUAL">{t.leaseNew.semiannual}</option>
                <option value="ANNUAL">{t.leaseNew.annual}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="depositAmount">{t.leaseNew.deposit}</label>
            <input className="input" id="depositAmount" name="depositAmount" type="number" min="0" step="0.01" defaultValue={0} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary" disabled={tenants.length === 0}>
              {t.leaseNew.create}
            </button>
            <Link href="/leases" className="btn-secondary">{t.common.cancel}</Link>
          </div>
        </form>
      )}
    </div>
  );
}
