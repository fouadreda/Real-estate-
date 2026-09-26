import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/format";
import { updateLease } from "@/lib/actions/leases";
import { requireUserWithDictionary } from "@/lib/auth";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";

export default async function EditLeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await requireUserWithDictionary();
  const lease = await prisma.lease.findUnique({
    where: { id },
    include: { tenant: true, property: { include: { building: true } } },
  });
  if (!lease) notFound();

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
          <button type="submit" className="btn-primary">{t.common.save}</button>
          <Link href={`/leases/${lease.id}`} className="btn-secondary">{t.common.cancel}</Link>
        </div>
      </form>
    </div>
  );
}
