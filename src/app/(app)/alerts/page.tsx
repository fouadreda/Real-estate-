import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, daysUntil } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { computeLeaseLedger } from "@/lib/ledger";
import Badge from "@/components/Badge";

export default async function AlertsPage() {
  const { t, locale } = await requireUserWithDictionary();
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [leases, expiringLeases] = await Promise.all([
    prisma.lease.findMany({
      where: { status: { not: "PENDING" } },
      include: { tenant: true, property: true, payments: true },
    }),
    prisma.lease.findMany({
      where: { status: "ACTIVE", endDate: { lte: in30Days } },
      include: { tenant: true, property: true },
      orderBy: { endDate: "asc" },
    }),
  ]);

  const overdue = leases
    .map((lease) => ({ lease, ledger: computeLeaseLedger(lease, lease.payments, now) }))
    .filter(({ ledger }) => ledger.oldestUnpaidDate !== null && ledger.oldestUnpaidDate < now)
    .sort((a, b) => (a.ledger.oldestUnpaidDate!.getTime() - b.ledger.oldestUnpaidDate!.getTime()));

  const hasAlerts = overdue.length > 0 || expiringLeases.length > 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{t.alerts.title}</h1>
        <p className="mt-1 text-sm text-stone-500">{t.alerts.subtitle}</p>
      </div>

      {!hasAlerts && (
        <div className="card text-sm text-stone-500">{t.alerts.none}</div>
      )}

      {overdue.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-stone-900">{t.alerts.overdueHeading(overdue.length)}</h2>
          <div className="space-y-3">
            {overdue.map(({ lease, ledger }) => (
              <Link
                key={lease.id}
                href={`/leases/${lease.id}`}
                className="card block border-red-100 bg-red-50/40 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-stone-900">
                      {lease.tenant.firstName} {lease.tenant.lastName}
                    </p>
                    <p className="text-sm text-stone-500">
                      {lease.property.name}
                    </p>
                    <p className="mt-1 text-sm text-red-600">
                      {t.alerts.dueOverdue(formatDate(ledger.oldestUnpaidDate!, locale), Math.abs(daysUntil(ledger.oldestUnpaidDate!)))}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-stone-900">{formatMoney(ledger.unpaid, locale)}</p>
                    <Badge status="LATE" label={t.status.LATE} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {expiringLeases.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-stone-900">{t.alerts.expiringHeading(expiringLeases.length)}</h2>
          <div className="space-y-3">
            {expiringLeases.map((lease) => (
              <Link key={lease.id} href={`/leases/${lease.id}`} className="card block hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-stone-900">
                      {lease.tenant.firstName} {lease.tenant.lastName}
                    </p>
                    <p className="text-sm text-stone-500">
                      {lease.property.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-stone-900">{formatDate(lease.endDate, locale)}</p>
                    <p className="text-sm text-stone-500">{t.alerts.daysLeft(daysUntil(lease.endDate))}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
