import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { propertyLabel } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import Badge from "@/components/Badge";
import { deleteProperty } from "@/lib/actions/properties";

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await requireUserWithDictionary();
  const property = await prisma.property.findUnique({
    where: { id },
    include: {
      building: {
        include: {
          properties: {
            orderBy: [{ floor: "asc" }, { unitCode: "asc" }],
          },
        },
      },
      leases: {
        include: { tenant: true },
        orderBy: { startDate: "desc" },
      },
    },
  });

  if (!property) notFound();

  const deletePropertyWithId = deleteProperty.bind(null, property.id);
  const activeLease = property.leases.find((lease) => lease.status === "ACTIVE");
  const siblings = property.building?.properties.filter((p) => p.id !== property.id) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <Link href="/properties" className="text-sm text-brand-600 hover:underline">
          ← {t.properties.title}
        </Link>
        <div className="mt-1 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">{propertyLabel(property)}</h1>
            <p className="mt-1 text-sm text-stone-500">
              {property.address}, {property.city}
              {property.floor ? ` · ${property.floor}` : ""}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {property.dimension ? `${property.dimension} m²` : property.areaLabel ?? t.properties.noDimension}
              {" · "}
              {property.price ? formatMoney(property.price, locale) : t.properties.noPrice}
              {(property.bedrooms != null || property.bathrooms != null) && (
                <>
                  {" · "}
                  {property.bedrooms != null ? `${property.bedrooms} bd` : ""}
                  {property.bedrooms != null && property.bathrooms != null ? " · " : ""}
                  {property.bathrooms != null ? `${property.bathrooms} ba` : ""}
                </>
              )}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Badge status={property.category} label={t.status[property.category]} />
              <Badge status={property.status} label={t.status[property.status]} />
            </div>
            {activeLease && (
              <p className="mt-2 text-sm text-stone-600">
                {t.propertyDetail.leasedTo}{" "}
                <Link href={`/tenants/${activeLease.tenantId}`} className="text-brand-600 hover:underline">
                  {tenantDisplayName(activeLease.tenant)}
                </Link>
              </p>
            )}
            {property.status === "VACANT" && (
              <Link
                href={`/leases/new?propertyId=${property.id}`}
                className="mt-2 inline-block text-sm text-brand-600 hover:underline"
              >
                {t.propertyDetail.startLease}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/properties/${property.id}/edit`} className="btn-secondary">
              {t.propertyDetail.editButton}
            </Link>
            <form action={deletePropertyWithId}>
              <button type="submit" className="btn-danger">{t.propertyDetail.deleteButton}</button>
            </form>
          </div>
        </div>
        {property.notes && <p className="mt-3 text-sm text-stone-600">{property.notes}</p>}
      </div>

      {siblings.length > 0 && (
        <div>
          <h2 className="mb-3 font-semibold text-stone-900">
            {property.building!.name} — {t.units.otherUnits}
          </h2>
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => (
              <Link
                key={s.id}
                href={`/properties/${s.id}`}
                className={`badge ${s.status === "OCCUPIED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
              >
                {s.unitCode ?? s.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-4 font-semibold text-stone-900">{t.propertyDetail.leaseHistory}</h2>
        {property.leases.length === 0 ? (
          <div className="card text-sm text-stone-500">{t.propertyDetail.noLeases}</div>
        ) : (
          <div className="space-y-3">
            {property.leases.map((lease) => (
              <Link key={lease.id} href={`/leases/${lease.id}`} className="card block hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-stone-900">
                      {tenantDisplayName(lease.tenant)}
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
