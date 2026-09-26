import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { propertyLabel } from "@/lib/leaseLocation";
import Badge from "@/components/Badge";
import type { PropertyCategory } from "@prisma/client";

const CATEGORIES: PropertyCategory[] = [
  "VILLA",
  "WAREHOUSE",
  "APARTMENT",
  "SHOP",
  "OFFICE",
  "LAND",
  "COMMERCIAL",
  "OTHER",
];

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; buildingId?: string }>;
}) {
  const { q, category, buildingId } = await searchParams;
  const { t, locale } = await requireUserWithDictionary();
  const selectedCategory = category && (CATEGORIES as string[]).includes(category) ? (category as PropertyCategory) : null;

  const [properties, buildings] = await Promise.all([
    prisma.property.findMany({
      where: {
        ...(selectedCategory ? { category: selectedCategory } : {}),
        ...(buildingId ? { buildingId } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q } },
                { address: { contains: q } },
                { city: { contains: q } },
                { unitCode: { contains: q } },
                { building: { name: { contains: q } } },
              ],
            }
          : {}),
      },
      include: { building: true },
      orderBy: [{ building: { name: "asc" } }, { floor: "asc" }, { unitCode: "asc" }],
    }),
    prisma.building.findMany({ orderBy: { name: "asc" } }),
  ]);

  function buildFilterHref(next: { category?: PropertyCategory | null; buildingId?: string | null }) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const nextCategory = next.category !== undefined ? next.category : selectedCategory;
    const nextBuilding = next.buildingId !== undefined ? next.buildingId : buildingId;
    if (nextCategory) params.set("category", nextCategory);
    if (nextBuilding) params.set("buildingId", nextBuilding);
    const qs = params.toString();
    return qs ? `/properties?${qs}` : "/properties";
  }

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
        {selectedCategory && <input type="hidden" name="category" value={selectedCategory} />}
        {buildingId && <input type="hidden" name="buildingId" value={buildingId} />}
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={t.properties.searchPlaceholder}
        />
        <button type="submit" className="btn-secondary shrink-0">{t.common.search}</button>
      </form>

      <div className="flex flex-wrap gap-2">
        <Link
          href={buildFilterHref({ category: null })}
          className={`badge ${selectedCategory ? "bg-stone-100 text-stone-600" : "bg-brand-600 text-white"}`}
        >
          {t.properties.filterAll}
        </Link>
        {CATEGORIES.map((cat) => (
          <Link
            key={cat}
            href={buildFilterHref({ category: cat })}
            className={`badge ${selectedCategory === cat ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-600"}`}
          >
            {t.status[cat]}
          </Link>
        ))}
      </div>

      {buildings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildFilterHref({ buildingId: null })}
            className={`badge ${buildingId ? "bg-stone-100 text-stone-600" : "bg-cyan-600 text-white"}`}
          >
            {t.properties.allBuildings}
          </Link>
          {buildings.map((b) => (
            <Link
              key={b.id}
              href={buildFilterHref({ buildingId: b.id })}
              className={`badge ${buildingId === b.id ? "bg-cyan-600 text-white" : "bg-cyan-50 text-cyan-700"}`}
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}

      {properties.length === 0 ? (
        <div className="card text-center text-stone-500">
          {q || selectedCategory || buildingId ? t.common.noResults : (
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
                <h3 className="font-semibold text-stone-900">{propertyLabel(property)}</h3>
                <div className="flex flex-col items-end gap-1">
                  <Badge status={property.category} label={t.status[property.category]} />
                  <Badge status={property.status} label={t.status[property.status]} />
                </div>
              </div>
              <p className="mt-1 text-sm text-stone-500">
                {property.building ? property.floor ?? "" : `${property.address}, ${property.city}`}
              </p>
              <p className="mt-2 text-sm text-stone-600">
                {property.dimension ? `${property.dimension} m²` : property.areaLabel ?? t.properties.noDimension}
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
