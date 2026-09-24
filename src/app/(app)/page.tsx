import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMoney, formatDate, daysUntil } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { computeLeaseLedger, monthlyEquivalentRent } from "@/lib/ledger";
import Badge from "@/components/Badge";

export default async function DashboardPage() {
  const { t, locale } = await requireUserWithDictionary();
  const now = new Date();

  const [properties, activeLeases, leasesWithPayments, upcomingExpirations] =
    await Promise.all([
      prisma.property.findMany(),
      prisma.lease.findMany({
        where: { status: "ACTIVE" },
        include: { tenant: true, property: true },
      }),
      prisma.lease.findMany({
        where: { status: { not: "PENDING" } },
        include: { tenant: true, property: true, payments: true },
      }),
      prisma.lease.findMany({
        where: {
          status: "ACTIVE",
          endDate: { lte: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) },
        },
        include: { tenant: true, property: true },
        orderBy: { endDate: "asc" },
      }),
    ]);

  const occupied = properties.filter((p) => p.status === "OCCUPIED").length;
  const vacant = properties.filter((p) => p.status === "VACANT").length;
  const monthlyRentRoll = activeLeases.reduce(
    (sum, l) => sum + monthlyEquivalentRent(l.rentAmount, l.billingFrequency),
    0,
  );
  const occupancyRate = properties.length > 0 ? Math.round((occupied / properties.length) * 100) : 0;

  const latePayments = leasesWithPayments
    .map((lease) => ({ lease, ledger: computeLeaseLedger(lease, lease.payments, now) }))
    .filter(({ ledger }) => ledger.oldestUnpaidDate !== null && ledger.oldestUnpaidDate < now)
    .sort((a, b) => a.ledger.oldestUnpaidDate!.getTime() - b.ledger.oldestUnpaidDate!.getTime())
    .slice(0, 5);

  const stats = [
    { label: t.dashboard.properties, value: properties.length },
    { label: t.dashboard.occupiedVacant, value: `${occupied} / ${vacant}` },
    { label: t.dashboard.occupancyRate, value: `${occupancyRate}%` },
    { label: t.dashboard.monthlyRentRoll, value: formatMoney(monthlyRentRoll, locale) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{t.dashboard.title}</h1>
        <p className="mt-1 text-sm text-stone-500">{t.dashboard.subtitle}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-tile">
            <p className="stat-label">{stat.label}</p>
            <p className="stat-value">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-stone-900">{t.dashboard.expiringHeading}</h2>
            <Link href="/leases" className="text-sm text-brand-600 hover:underline">
              {t.dashboard.viewAll}
            </Link>
          </div>
          {upcomingExpirations.length === 0 ? (
            <p className="text-sm text-stone-500">{t.dashboard.noExpiring}</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {upcomingExpirations.map((lease) => (
                <li key={lease.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link href={`/leases/${lease.id}`} className="font-medium text-stone-900 hover:underline">
                      {lease.tenant.firstName} {lease.tenant.lastName}
                    </Link>
                    <p className="text-sm text-stone-500">
                      {lease.property.name}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-stone-900">{formatDate(lease.endDate, locale)}</p>
                    <p className="text-stone-500">{t.dashboard.days(daysUntil(lease.endDate))}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-stone-900">{t.dashboard.lateHeading}</h2>
            <Link href="/alerts" className="text-sm text-brand-600 hover:underline">
              {t.dashboard.viewAll}
            </Link>
          </div>
          {latePayments.length === 0 ? (
            <p className="text-sm text-stone-500">{t.dashboard.noLate}</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {latePayments.map(({ lease, ledger }) => (
                <li key={lease.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link
                      href={`/leases/${lease.id}`}
                      className="font-medium text-stone-900 hover:underline"
                    >
                      {lease.tenant.firstName} {lease.tenant.lastName}
                    </Link>
                    <p className="text-sm text-stone-500">
                      {lease.property.name}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-medium text-red-600">{formatMoney(ledger.unpaid, locale)}</p>
                    <Badge status="LATE" label={t.status.LATE} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
