import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateTenant } from "@/lib/actions/tenants";
import { requireUserWithDictionary } from "@/lib/auth";
import { tenantDisplayName } from "@/lib/tenantName";

export default async function EditTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await requireUserWithDictionary();
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) notFound();

  const updateTenantWithId = updateTenant.bind(null, tenant.id);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href={`/tenants/${tenant.id}`} className="text-sm text-brand-600 hover:underline">
          ← {tenantDisplayName(tenant)}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{t.tenantForm.editTitle}</h1>
      </div>

      <form action={updateTenantWithId} className="card space-y-4">
        <p className="text-xs text-stone-500">{t.tenantForm.personOrCompanyHint}</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="firstName">{t.tenantForm.firstName}</label>
            <input className="input" id="firstName" name="firstName" defaultValue={tenant.firstName ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="lastName">{t.tenantForm.lastName}</label>
            <input className="input" id="lastName" name="lastName" defaultValue={tenant.lastName ?? ""} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="company">{t.tenantForm.company}</label>
            <input className="input" id="company" name="company" defaultValue={tenant.company ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="representative">{t.tenantForm.representative}</label>
            <input className="input" id="representative" name="representative" defaultValue={tenant.representative ?? ""} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="email">{t.tenantForm.email}</label>
          <input className="input" id="email" name="email" type="email" defaultValue={tenant.email ?? ""} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="phone">{t.tenantForm.phone}</label>
            <input className="input" id="phone" name="phone" defaultValue={tenant.phone ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="poBox">{t.tenantForm.poBox}</label>
            <input className="input" id="poBox" name="poBox" defaultValue={tenant.poBox ?? ""} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="idNumber">{t.tenantForm.idNumber}</label>
          <input className="input" id="idNumber" name="idNumber" defaultValue={tenant.idNumber ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="address">{t.tenantForm.address}</label>
          <input className="input" id="address" name="address" defaultValue={tenant.address ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="city">{t.tenantForm.city}</label>
          <input className="input" id="city" name="city" defaultValue={tenant.city ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="notes">{t.tenantForm.notes}</label>
          <textarea className="input" id="notes" name="notes" rows={3} defaultValue={tenant.notes ?? ""} />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary">{t.common.save}</button>
          <Link href={`/tenants/${tenant.id}`} className="btn-secondary">{t.common.cancel}</Link>
        </div>
      </form>
    </div>
  );
}
