import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import Badge from "@/components/Badge";
import { deleteTenant } from "@/lib/actions/tenants";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await requireUserWithDictionary();
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      leases: {
        include: { property: true },
        orderBy: { startDate: "desc" },
      },
    },
  });

  if (!tenant) notFound();

  const deleteTenantWithId = deleteTenant.bind(null, tenant.id);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/tenants" className="text-sm text-brand-600 hover:underline">
          ← {t.tenants.title}
        </Link>
        <div className="mt-1 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">
              {tenant.firstName} {tenant.lastName}
            </h1>
            <p className="mt-1 text-sm text-stone-500">
              {tenant.email ?? "—"} {tenant.phone ? `· ${tenant.phone}` : ""}
            </p>
            {(tenant.company || tenant.idNumber) && (
              <p className="mt-1 text-sm text-stone-500">
                {tenant.company}
                {tenant.company && tenant.idNumber ? " · " : ""}
                {tenant.idNumber ? `${t.tenantForm.idNumber}: ${tenant.idNumber}` : ""}
              </p>
            )}
            {(tenant.address || tenant.city) && (
              <p className="mt-1 text-sm text-stone-500">
                {[tenant.address, tenant.city].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/tenants/${tenant.id}/edit`} className="btn-secondary">
              {t.tenantDetail.editButton}
            </Link>
            <form action={deleteTenantWithId}>
              <button type="submit" className="btn-danger">{t.tenantDetail.deleteButton}</button>
            </form>
          </div>
        </div>
        {tenant.notes && <p className="mt-3 text-sm text-stone-600">{tenant.notes}</p>}
      </div>

      <div>
        <h2 className="mb-4 font-semibold text-stone-900">{t.tenantDetail.leaseHistory}</h2>
        {tenant.leases.length === 0 ? (
          <div className="card text-sm text-stone-500">{t.tenantDetail.noLeases}</div>
        ) : (
          <div className="space-y-3">
            {tenant.leases.map((lease) => (
              <Link key={lease.id} href={`/leases/${lease.id}`} className="card block hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-stone-900">
                      {lease.property.name}
                    </p>
                    <p className="text-sm text-stone-500">
                      {formatDate(lease.startDate, locale)} – {formatDate(lease.endDate, locale)} · {formatMoney(lease.rentAmount, locale)} / {t.leaseNew.frequencyShort[lease.billingFrequency]}
                    </p>
                  </div>
                  <Badge status={lease.status} label={t.status[lease.status]} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
