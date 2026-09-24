import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import Badge from "@/components/Badge";

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { t, locale } = await requireUserWithDictionary();
  const properties = await prisma.property.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q } },
            { address: { contains: q } },
            { city: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">{t.properties.title}</h1>
          <p className="mt-1 text-sm text-stone-500">{t.properties.total(properties.length)}</p>
        </div>
        <Link href="/properties/new" className="btn-primary">
          {t.properties.add}
        </Link>
      </div>

      <form action="/properties" method="GET" className="flex gap-2">
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={t.properties.searchPlaceholder}
        />
        <button type="submit" className="btn-secondary shrink-0">{t.common.search}</button>
      </form>

      {properties.length === 0 ? (
        <div className="card text-center text-stone-500">
          {q ? t.common.noResults : (
            <>
              {t.properties.empty}{" "}
              <Link href="/properties/new" className="text-brand-600 hover:underline">
                {t.properties.addFirst}
              </Link>
              .
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((property) => (
            <Link key={property.id} href={`/properties/${property.id}`} className="card block hover:shadow-md">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-stone-900">{property.name}</h3>
                <div className="flex flex-col items-end gap-1">
                  <Badge status={property.category} label={t.status[property.category]} />
                  <Badge status={property.status} label={t.status[property.status]} />
                </div>
              </div>
              <p className="mt-1 text-sm text-stone-500">
                {property.address}, {property.city}
              </p>
              <p className="mt-2 text-sm text-stone-600">
                {property.dimension ? `${property.dimension} m²` : t.properties.noDimension}
                {" · "}
                {property.price ? formatMoney(property.price, locale) : t.properties.noPrice}
              </p>
              {(property.bedrooms != null || property.bathrooms != null) && (
                <p className="mt-1 text-sm text-stone-500">
                  {property.bedrooms != null ? `${property.bedrooms} bd` : ""}
                  {property.bedrooms != null && property.bathrooms != null ? " · " : ""}
                  {property.bathrooms != null ? `${property.bathrooms} ba` : ""}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
