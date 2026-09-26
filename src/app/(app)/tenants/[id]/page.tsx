import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import { computeLeaseLedger } from "@/lib/ledger";
import Badge from "@/components/Badge";
import { deleteTenant } from "@/lib/actions/tenants";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await requireUserWithDictionary();
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      leases: {
        include: { property: { include: { building: true } }, payments: true },
        orderBy: { startDate: "desc" },
      },
    },
  });

  if (!tenant) notFound();

  const deleteTenantWithId = deleteTenant.bind(null, tenant.id);
  const now = new Date();
  const combinedUnpaid = tenant.leases
    .filter((l) => l.status !== "PENDING" && !l.needsReview)
    .reduce((sum, l) => sum + computeLeaseLedger(l, l.payments, now).unpaid, 0);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/tenants" className="text-sm text-brand-600 hover:underline">
          ← {t.tenants.title}
        </Link>
        <div className="mt-1 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">
              {tenantDisplayName(tenant)}
            </h1>
            {tenant.representative && (
              <p className="mt-1 text-sm text-stone-500">{t.tenantForm.representative}: {tenant.representative}</p>
            )}
            <p className="mt-1 text-sm text-stone-500">
              {tenant.email ?? "—"} {tenant.phone ? `· ${tenant.phone}` : ""}
              {tenant.poBox ? ` · ${t.tenantForm.poBox} ${tenant.poBox}` : ""}
            </p>
            {(tenant.company && (tenant.firstName || tenant.lastName)) || tenant.idNumber ? (
              <p className="mt-1 text-sm text-stone-500">
                {tenant.company && (tenant.firstName || tenant.lastName) ? tenant.company : ""}
                {tenant.company && (tenant.firstName || tenant.lastName) && tenant.idNumber ? " · " : ""}
                {tenant.idNumber ? `${t.tenantForm.idNumber}: ${tenant.idNumber}` : ""}
              </p>
            ) : null}
            {(tenant.address || tenant.city) && (
              <p className="mt-1 text-sm text-stone-500">
                {[tenant.address, tenant.city].filter(Boolean).join(", ")}
              </p>
            )}
            {combinedUnpaid > 0.005 && (
              <p className="mt-2 text-sm font-medium text-red-600">
                {t.tenantDetail.combinedBalance}: {formatMoney(combinedUnpaid, locale)}
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
                      {leaseLocationName(lease)}
                    </p>
                    <p className="text-sm text-stone-500">
                      {formatDate(lease.startDate, locale)} – {lease.endDate ? formatDate(lease.endDate, locale) : t.leaseDetail.openEnded} · {formatMoney(lease.rentAmount, locale)} / {t.leaseNew.frequencyShort[lease.billingFrequency]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {lease.needsReview && <Badge status="TODO" label={t.leaseDetail.needsReview} />}
                    <Badge status={lease.status} label={t.status[lease.status]} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
