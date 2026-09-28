import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { propertyLabel, leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import Badge from "@/components/Badge";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { t, locale } = await requireUserWithDictionary();
  const { q: qParam } = await searchParams;
  const q = qParam?.trim() ?? "";
  const hasQuery = q.length > 0;

  const [properties, tenants, leases, expenses] = hasQuery
    ? await Promise.all([
        prisma.property.findMany({
          where: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { address: { contains: q, mode: "insensitive" } },
              { city: { contains: q, mode: "insensitive" } },
              { unitCode: { contains: q, mode: "insensitive" } },
            ],
          },
          include: { building: true },
          take: 20,
        }),
        prisma.tenant.findMany({
          where: {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { company: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
            ],
          },
          take: 20,
        }),
        prisma.lease.findMany({
          where: {
            OR: [
              { tenant: { firstName: { contains: q, mode: "insensitive" } } },
              { tenant: { lastName: { contains: q, mode: "insensitive" } } },
              { tenant: { company: { contains: q, mode: "insensitive" } } },
              { property: { name: { contains: q, mode: "insensitive" } } },
              { property: { city: { contains: q, mode: "insensitive" } } },
              { property: { unitCode: { contains: q, mode: "insensitive" } } },
              { property: { building: { name: { contains: q, mode: "insensitive" } } } },
            ],
          },
          include: { tenant: true, property: { include: { building: true } } },
          orderBy: { startDate: "desc" },
          take: 20,
        }),
        prisma.expense.findMany({
          where: {
            OR: [
              { description: { contains: q, mode: "insensitive" } },
              { property: { name: { contains: q, mode: "insensitive" } } },
              { property: { city: { contains: q, mode: "insensitive" } } },
            ],
          },
          include: { property: { include: { building: true } } },
          orderBy: { date: "desc" },
          take: 20,
        }),
      ])
    : [[], [], [], []];

  const totalResults = properties.length + tenants.length + leases.length + expenses.length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{t.search.title}</h1>
        {hasQuery && <p className="mt-1 text-sm text-stone-500">{t.search.resultsFor(q)}</p>}
      </div>

      <form action="/search" method="GET" className="flex gap-2">
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t.nav.searchPlaceholder}
        />
        <button type="submit" className="btn-secondary shrink-0">{t.common.search}</button>
      </form>

      {!hasQuery ? (
        <div className="card text-center text-stone-500">{t.search.empty}</div>
      ) : totalResults === 0 ? (
        <div className="card text-center text-stone-500">{t.search.noResults}</div>
      ) : (
        <div className="space-y-8">
          {properties.length > 0 && (
            <div>
              <h2 className="mb-3 font-semibold text-stone-900">{t.search.propertiesHeading(properties.length)}</h2>
              <div className="space-y-2">
                {properties.map((property) => (
                  <Link key={property.id} href={`/properties/${property.id}`} className="card block hover:shadow-md">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-stone-900">{propertyLabel(property)}</p>
                        <p className="text-sm text-stone-500">
                          {property.address}, {property.city}
                        </p>
                      </div>
                      <Badge status={property.status} label={t.status[property.status]} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {tenants.length > 0 && (
            <div>
              <h2 className="mb-3 font-semibold text-stone-900">{t.search.tenantsHeading(tenants.length)}</h2>
              <div className="space-y-2">
                {tenants.map((tenant) => (
                  <Link key={tenant.id} href={`/tenants/${tenant.id}`} className="card block hover:shadow-md">
                    <p className="font-medium text-stone-900">{tenantDisplayName(tenant)}</p>
                    <p className="text-sm text-stone-500">
                      {tenant.email ?? "—"} {tenant.phone ? `· ${tenant.phone}` : ""}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {leases.length > 0 && (
            <div>
              <h2 className="mb-3 font-semibold text-stone-900">{t.search.leasesHeading(leases.length)}</h2>
              <div className="space-y-2">
                {leases.map((lease) => (
                  <Link key={lease.id} href={`/leases/${lease.id}`} className="card block hover:shadow-md">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-stone-900">{tenantDisplayName(lease.tenant)}</p>
                        <p className="text-sm text-stone-500">{leaseLocationName(lease)}</p>
                      </div>
                      <Badge status={lease.status} label={t.status[lease.status]} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {expenses.length > 0 && (
            <div>
              <h2 className="mb-3 font-semibold text-stone-900">{t.search.expensesHeading(expenses.length)}</h2>
              <div className="space-y-2">
                {expenses.map((expense) => (
                  <Link key={expense.id} href={`/expenses/${expense.id}/edit`} className="card block hover:shadow-md">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-stone-900">{propertyLabel(expense.property)}</p>
                        <p className="text-sm text-stone-500">
                          {formatDate(expense.date, locale)}
                          {expense.description ? ` · ${expense.description}` : ""}
                        </p>
                      </div>
                      <span className="font-medium text-stone-900">{formatMoney(expense.amount, locale)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
