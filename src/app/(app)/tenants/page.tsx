import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUserWithDictionary } from "@/lib/auth";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import Badge from "@/components/Badge";

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { t } = await requireUserWithDictionary();
  const tenants = await prisma.tenant.findMany({
    where: q
      ? {
          OR: [
            { firstName: { contains: q } },
            { lastName: { contains: q } },
            { email: { contains: q } },
            { phone: { contains: q } },
            { company: { contains: q } },
          ],
        }
      : undefined,
    include: {
      leases: {
        where: { status: "ACTIVE" },
        include: { property: { include: { building: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">{t.tenants.title}</h1>
          <p className="mt-1 text-sm text-stone-500">{t.tenants.total(tenants.length)}</p>
        </div>
        <Link href="/tenants/new" className="btn-primary">
          {t.tenants.add}
        </Link>
      </div>

      <form action="/tenants" method="GET" className="flex gap-2">
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={t.tenants.searchPlaceholder}
        />
        <button type="submit" className="btn-secondary shrink-0">{t.common.search}</button>
      </form>

      {tenants.length === 0 ? (
        <div className="card text-center text-stone-500">
          {q ? t.common.noResults : (
            <>
              {t.tenants.empty}{" "}
              <Link href="/tenants/new" className="text-brand-600 hover:underline">
                {t.tenants.addFirst}
              </Link>
              .
            </>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
                <tr>
                  <th className="px-5 py-3 font-medium">{t.tenants.nameHeader}</th>
                  <th className="px-5 py-3 font-medium">{t.tenants.contactHeader}</th>
                  <th className="px-5 py-3 font-medium">{t.tenants.currentPropertyHeader}</th>
                  <th className="px-5 py-3 font-medium">{t.tenants.statusHeader}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {tenants.map((tenant) => {
                  const lease = tenant.leases[0];
                  return (
                    <tr key={tenant.id} className="hover:bg-stone-50">
                      <td className="px-5 py-3">
                        <Link href={`/tenants/${tenant.id}`} className="font-medium text-stone-900 hover:underline">
                          {tenantDisplayName(tenant)}
                        </Link>
                        {tenant.company && (tenant.firstName || tenant.lastName) && (
                          <div className="text-xs text-stone-400">{tenant.company}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-stone-600">
                        {tenant.email && <div>{tenant.email}</div>}
                        {tenant.phone && <div>{tenant.phone}</div>}
                        {!tenant.email && !tenant.phone && <span className="text-stone-400">—</span>}
                      </td>
                      <td className="px-5 py-3 text-stone-600">
                        {lease ? leaseLocationName(lease) : <span className="text-stone-400">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        <Badge status={lease ? "ACTIVE" : "PENDING"} label={lease ? t.status.ACTIVE : t.status.PENDING} />
                        {!lease && <span className="ml-1 text-xs text-stone-400">{t.tenants.noActiveLease}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
