import Link from "next/link";
import { createTenant } from "@/lib/actions/tenants";
import { requireUserWithDictionary } from "@/lib/auth";

export default async function NewTenantPage() {
  const { t } = await requireUserWithDictionary();

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href="/tenants" className="text-sm text-brand-600 hover:underline">
          ← {t.tenants.title}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{t.tenantForm.addTitle}</h1>
      </div>

      <form action={createTenant} className="card space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="firstName">{t.tenantForm.firstName}</label>
            <input className="input" id="firstName" name="firstName" required />
          </div>
          <div>
            <label className="label" htmlFor="lastName">{t.tenantForm.lastName}</label>
            <input className="input" id="lastName" name="lastName" required />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="email">{t.tenantForm.email}</label>
          <input className="input" id="email" name="email" type="email" placeholder="Optional" />
        </div>
        <div>
          <label className="label" htmlFor="phone">{t.tenantForm.phone}</label>
          <input className="input" id="phone" name="phone" placeholder="Optional" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="company">{t.tenantForm.company}</label>
            <input className="input" id="company" name="company" placeholder="Optional" />
          </div>
          <div>
            <label className="label" htmlFor="idNumber">{t.tenantForm.idNumber}</label>
            <input className="input" id="idNumber" name="idNumber" placeholder="Optional" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="address">{t.tenantForm.address}</label>
          <input className="input" id="address" name="address" placeholder="Optional" />
        </div>
        <div>
          <label className="label" htmlFor="city">{t.tenantForm.city}</label>
          <input className="input" id="city" name="city" placeholder="Optional" />
        </div>
        <div>
          <label className="label" htmlFor="notes">{t.tenantForm.notes}</label>
          <textarea className="input" id="notes" name="notes" rows={3} placeholder="Optional notes" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary">{t.tenantForm.create}</button>
          <Link href="/tenants" className="btn-secondary">{t.common.cancel}</Link>
        </div>
      </form>
    </div>
  );
}
