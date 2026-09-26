import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, daysUntil } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { computeLeaseLedger } from "@/lib/ledger";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import Badge from "@/components/Badge";

export default async function AlertsPage() {
  const { t, locale } = await requireUserWithDictionary();
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const [leases, expiringLeases, reviewsDue, brokenPromises, needsReviewLeases] = await Promise.all([
    prisma.lease.findMany({
      where: { status: { not: "PENDING" }, needsReview: false },
      include: { tenant: true, property: { include: { building: true } }, payments: true },
    }),
    prisma.lease.findMany({
      where: { status: "ACTIVE", endDate: { not: null, lte: in30Days } },
      include: { tenant: true, property: { include: { building: true } } },
      orderBy: { endDate: "asc" },
    }),
    prisma.rentReview.findMany({
      where: { dueDate: { lte: in60Days }, appliedAt: null },
      include: { lease: { include: { tenant: true, property: { include: { building: true } } } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.followUp.findMany({
      where: { result: "BROKEN" },
      include: { lease: { include: { tenant: true, property: { include: { building: true } } } } },
      orderBy: { date: "desc" },
    }),
    prisma.lease.findMany({
      where: { needsReview: true },
      include: { tenant: true, property: { include: { building: true } } },
    }),
  ]);

  const overdue = leases
    .map((lease) => ({ lease, ledger: computeLeaseLedger(lease, lease.payments, now) }))
    .filter(({ ledger }) => ledger.oldestUnpaidDate !== null && ledger.oldestUnpaidDate < now)
    .sort((a, b) => (a.ledger.oldestUnpaidDate!.getTime() - b.ledger.oldestUnpaidDate!.getTime()));

  const hasAlerts =
    overdue.length > 0 ||
    expiringLeases.length > 0 ||
    reviewsDue.length > 0 ||
    brokenPromises.length > 0 ||
    needsReviewLeases.length > 0;

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
                      {tenantDisplayName(lease.tenant)}
                    </p>
                    <p className="text-sm text-stone-500">
                      {leaseLocationName(lease)}
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

      {brokenPromises.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-stone-900">{t.alerts.brokenPromisesHeading(brokenPromises.length)}</h2>
          <div className="space-y-3">
            {brokenPromises.map((f) => (
              <Link key={f.id} href={`/leases/${f.leaseId}`} className="card block border-red-100 bg-red-50/40 hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-stone-900">{tenantDisplayName(f.lease.tenant)}</p>
                    <p className="text-sm text-stone-500">{leaseLocationName(f.lease)}</p>
                    {f.response && <p className="mt-1 text-sm text-stone-500">{f.response}</p>}
                  </div>
                  <div className="text-right">
                    {f.promiseAmount && <p className="font-semibold text-stone-900">{formatMoney(f.promiseAmount, locale)}</p>}
                    {f.promiseDate && <p className="text-sm text-stone-500">{formatDate(f.promiseDate, locale)}</p>}
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
                      {tenantDisplayName(lease.tenant)}
                    </p>
                    <p className="text-sm text-stone-500">
                      {leaseLocationName(lease)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-stone-900">{lease.endDate ? formatDate(lease.endDate, locale) : "—"}</p>
                    <p className="text-sm text-stone-500">{lease.endDate ? t.alerts.daysLeft(daysUntil(lease.endDate)) : ""}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {reviewsDue.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-stone-900">{t.alerts.revisionHeading(reviewsDue.length)}</h2>
          <div className="space-y-3">
            {reviewsDue.map((r) => (
              <Link key={r.id} href={`/leases/${r.leaseId}`} className="card block hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-stone-900">
                      {tenantDisplayName(r.lease.tenant)}
                    </p>
                    <p className="text-sm text-stone-500">
                      {leaseLocationName(r.lease)}
                    </p>
                    {!r.letterSentAt && <p className="mt-1 text-sm text-amber-700">{t.leaseRevision.letterNotSent}</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-stone-900">{t.alerts.revisionDue(formatDate(r.dueDate, locale))}</p>
                    <p className="text-sm text-stone-500">{t.alerts.daysLeft(daysUntil(r.dueDate))}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {needsReviewLeases.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-stone-900">{t.alerts.needsReviewHeading(needsReviewLeases.length)}</h2>
          <div className="space-y-3">
            {needsReviewLeases.map((lease) => (
              <Link key={lease.id} href={`/leases/${lease.id}`} className="card block hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-stone-900">{tenantDisplayName(lease.tenant)}</p>
                    <p className="text-sm text-stone-500">{leaseLocationName(lease)}</p>
                    {lease.reviewReason && <p className="mt-1 text-sm text-amber-700">{lease.reviewReason}</p>}
                  </div>
                  <Badge status="TODO" label={t.leaseDetail.needsReview} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
