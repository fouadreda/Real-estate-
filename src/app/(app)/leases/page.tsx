import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import Badge from "@/components/Badge";

export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { t, locale } = await requireUserWithDictionary();
  const leases = await prisma.lease.findMany({
    where: q
      ? {
          OR: [
            { tenant: { firstName: { contains: q } } },
            { tenant: { lastName: { contains: q } } },
            { tenant: { company: { contains: q } } },
            { property: { name: { contains: q } } },
            { property: { city: { contains: q } } },
            { property: { unitCode: { contains: q } } },
            { property: { building: { name: { contains: q } } } },
          ],
        }
      : undefined,
    include: { tenant: true, property: { include: { building: true } } },
    orderBy: { startDate: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">{t.leases.title}</h1>
          <p className="mt-1 text-sm text-stone-500">{t.leases.total(leases.length)}</p>
        </div>
        <Link href="/leases/new" className="btn-primary">
          {t.leases.add}
        </Link>
      </div>

      <form action="/leases" method="GET" className="flex gap-2">
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={t.leases.searchPlaceholder}
        />
        <button type="submit" className="btn-secondary shrink-0">{t.common.search}</button>
      </form>

      {leases.length === 0 ? (
        <div className="card text-center text-stone-500">
          {q ? (
            t.common.noResults
          ) : (
            <>
              {t.leases.empty}{" "}
              <Link href="/leases/new" className="text-brand-600 hover:underline">
                {t.leases.addFirst}
              </Link>
              .
            </>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
              <tr>
                <th className="px-5 py-3 font-medium">{t.leases.tenantHeader}</th>
                <th className="px-5 py-3 font-medium">{t.leases.propertyHeader}</th>
                <th className="px-5 py-3 font-medium">{t.leases.termHeader}</th>
                <th className="px-5 py-3 font-medium">{t.leases.rentHeader}</th>
                <th className="px-5 py-3 font-medium">{t.leases.statusHeader}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {leases.map((lease) => (
                <tr key={lease.id} className="hover:bg-stone-50">
                  <td className="px-5 py-3">
                    <Link href={`/leases/${lease.id}`} className="font-medium text-stone-900 hover:underline">
                      {tenantDisplayName(lease.tenant)}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-stone-600">
                    {leaseLocationName(lease)}
                  </td>
                  <td className="px-5 py-3 text-stone-600">
                    {formatDate(lease.startDate, locale)} – {lease.endDate ? formatDate(lease.endDate, locale) : t.leaseDetail.openEnded}
                  </td>
                  <td className="px-5 py-3 text-stone-600">
                    {formatMoney(lease.rentAmount, locale)} / {t.leaseNew.frequencyShort[lease.billingFrequency]}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      {lease.needsReview && <Badge status="TODO" label={t.leaseDetail.needsReview} />}
                      <Badge status={lease.status} label={t.status[lease.status]} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
