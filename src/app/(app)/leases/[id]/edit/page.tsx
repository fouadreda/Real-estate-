import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/format";
import { updateLease } from "@/lib/actions/leases";
import { requireUserWithDictionary } from "@/lib/auth";
import { leaseLocationName, propertyLabel } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import FormError from "@/components/FormError";
import SubmitButton from "@/components/SubmitButton";

export default async function EditLeasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { t } = await requireUserWithDictionary();
  const [lease, tenants, units] = await Promise.all([
    prisma.lease.findUnique({ where: { id }, include: { tenant: true, property: { include: { building: true } } } }),
    prisma.tenant.findMany(),
    prisma.property.findMany({
      include: { building: true, leases: { where: { status: { in: ["ACTIVE", "PENDING"] } }, select: { id: true } } },
    }),
  ]);
  if (!lease) notFound();

  const sortedTenants = [...tenants].sort((a, b) => tenantDisplayName(a).localeCompare(tenantDisplayName(b), "fr"));
  // every unit, grouped by building; a unit with another live lease is marked but not blocked (two leases can be swapped)
  const unitGroups = new Map<string, typeof units>();
  for (const u of [...units].sort((a, b) => propertyLabel(a).localeCompare(propertyLabel(b), "fr"))) {
    const name = u.building?.name ?? "—";
    unitGroups.set(name, [...(unitGroups.get(name) ?? []), u]);
  }

  const updateLeaseWithId = updateLease.bind(null, lease.id);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href={`/leases/${lease.id}`} className="text-sm text-brand-600 hover:underline">
          ← {leaseLocationName(lease)}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{t.leaseEdit.title}</h1>
        <p className="mt-1 text-sm text-stone-500">
          {tenantDisplayName(lease.tenant)}
        </p>
      </div>

      <form action={updateLeaseWithId} className="card space-y-4">
        <FormError code={error} messages={t.formErrors} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="tenantId">{t.leaseEdit.tenant}</label>
            <select className="input" id="tenantId" name="tenantId" defaultValue={lease.tenantId}>
              {sortedTenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenantDisplayName(tenant)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="propertyId">{t.leaseEdit.unit}</label>
            <select className="input" id="propertyId" name="propertyId" defaultValue={lease.propertyId}>
              {[...unitGroups.entries()]
                .sort(([a], [b]) => a.localeCompare(b, "fr"))
                .map(([name, list]) => (
                  <optgroup key={name} label={name}>
                    {list.map((u) => (
                      <option key={u.id} value={u.id}>
                        {propertyLabel(u)}
                        {u.id !== lease.propertyId && u.leases.length > 0 ? ` (${t.leaseEdit.occupied})` : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-stone-500">{t.leaseEdit.tenantUnitHint}</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="startDate">{t.leaseEdit.startDate}</label>
            <input
              className="input"
              id="startDate"
              name="startDate"
              type="date"
              required
              defaultValue={toDateInputValue(lease.startDate)}
            />
          </div>
          <div>
            <label className="label" htmlFor="endDate">{t.leaseEdit.endDate}</label>
            <input
              className="input"
              id="endDate"
              name="endDate"
              type="date"
              defaultValue={lease.endDate ? toDateInputValue(lease.endDate) : ""}
              placeholder={t.leaseEdit.openEndedHint}
            />
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
              defaultValue={lease.rentAmount}
            />
          </div>
          <div>
            <label className="label" htmlFor="billingFrequency">{t.leaseNew.billingFrequency}</label>
            <select className="input" id="billingFrequency" name="billingFrequency" defaultValue={lease.billingFrequency}>
              <option value="MONTHLY">{t.leaseNew.monthly}</option>
              <option value="QUARTERLY">{t.leaseNew.quarterly}</option>
              <option value="SEMIANNUAL">{t.leaseNew.semiannual}</option>
              <option value="ANNUAL">{t.leaseNew.annual}</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ledgerStartDate">{t.leaseEdit.billingStart}</label>
          <input
            className="input"
            id="ledgerStartDate"
            name="ledgerStartDate"
            type="date"
            defaultValue={lease.ledgerStartDate ? toDateInputValue(lease.ledgerStartDate) : ""}
          />
          <p className="mt-1 text-xs text-stone-500">{t.leaseEdit.billingStartHint}</p>
          {lease.ledgerStartDate && (
            <label className="mt-2 flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" name="billFromStart" className="h-4 w-4 rounded border-stone-300" />
              {t.leaseEdit.billFromStart}
            </label>
          )}
        </div>
        <div>
          <label className="label" htmlFor="depositAmount">{t.leaseEdit.deposit}</label>
          <input
            className="input"
            id="depositAmount"
            name="depositAmount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={lease.depositAmount}
          />
        </div>
        <p className="text-xs text-stone-500">{t.leaseEdit.note}</p>
        <div className="flex gap-3 pt-2">
          <SubmitButton className="btn-primary" pendingLabel={t.leaseDetail.saving}>{t.common.save}</SubmitButton>
          <Link href={`/leases/${lease.id}`} className="btn-secondary">{t.common.cancel}</Link>
        </div>
      </form>
    </div>
  );
}
