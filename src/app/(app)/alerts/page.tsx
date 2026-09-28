import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, daysUntil } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { computeLeaseLedger } from "@/lib/ledger";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import { dismissAlert } from "@/lib/actions/alerts";
import Badge from "@/components/Badge";

export default async function AlertsPage() {
  const { t, locale } = await requireUserWithDictionary();
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const [leases, expiringLeasesAll, reviewsDueAll, brokenPromisesAll, needsReviewLeasesAll, dismissed] =
    await Promise.all([
      prisma.lease.findMany({
        where: { status: { not: "PENDING" }, needsReview: false },
        include: {
          tenant: true,
          property: { include: { building: true } },
          payments: true,
          rentReviews: { where: { appliedAt: { not: null } } },
        },
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
      prisma.dismissedAlert.findMany(),
    ]);

  const dismissedKeys = new Set(dismissed.map((d) => `${d.kind}:${d.refId}:${d.context}`));
  const isDismissed = (kind: string, refId: string, context: string) => dismissedKeys.has(`${kind}:${refId}:${context}`);

  const overdue = leases
    .map((lease) => ({ lease, ledger: computeLeaseLedger(lease, lease.payments, now) }))
    .filter(({ ledger }) => ledger.oldestUnpaidDate !== null && ledger.oldestUnpaidDate < now)
    .filter(({ lease, ledger }) => !isDismissed("OVERDUE", lease.id, ledger.oldestUnpaidDate!.toISOString()))
    .sort((a, b) => (a.ledger.oldestUnpaidDate!.getTime() - b.ledger.oldestUnpaidDate!.getTime()));

  const expiringLeases = expiringLeasesAll.filter(
    (lease) => !isDismissed("EXPIRING", lease.id, lease.endDate!.toISOString()),
  );
  const reviewsDue = reviewsDueAll.filter((r) => !isDismissed("REVISION", r.id, ""));
  const brokenPromises = brokenPromisesAll.filter((f) => !isDismissed("BROKEN_PROMISE", f.id, ""));
  const needsReviewLeases = needsReviewLeasesAll.filter(
    (lease) => !isDismissed("NEEDS_REVIEW", lease.id, lease.reviewReason ?? ""),
  );

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
            {overdue.map(({ lease, ledger }) => {
              const dismiss = dismissAlert.bind(null, "OVERDUE", lease.id, ledger.oldestUnpaidDate!.toISOString());
              return (
                <div key={lease.id} className="card border-red-100 bg-red-50/40">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/leases/${lease.id}`} className="min-w-0 flex-1 hover:underline">
                      <p className="font-medium text-stone-900">
                        {tenantDisplayName(lease.tenant)}
                      </p>
                      <p className="text-sm text-stone-500">
                        {leaseLocationName(lease)}
                      </p>
                      <p className="mt-1 text-sm text-red-600">
                        {t.alerts.dueOverdue(formatDate(ledger.oldestUnpaidDate!, locale), Math.abs(daysUntil(ledger.oldestUnpaidDate!)))}
                      </p>
                    </Link>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold text-stone-900">{formatMoney(ledger.unpaid, locale)}</p>
                      <Badge status="LATE" label={t.status.LATE} />
                      <form action={dismiss} className="mt-2">
                        <button type="submit" className="text-xs text-stone-500 hover:underline">
                          {t.alerts.dismiss}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {brokenPromises.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-stone-900">{t.alerts.brokenPromisesHeading(brokenPromises.length)}</h2>
          <div className="space-y-3">
            {brokenPromises.map((f) => {
              const dismiss = dismissAlert.bind(null, "BROKEN_PROMISE", f.id, "");
              return (
                <div key={f.id} className="card border-red-100 bg-red-50/40">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/leases/${f.leaseId}`} className="min-w-0 flex-1 hover:underline">
                      <p className="font-medium text-stone-900">{tenantDisplayName(f.lease.tenant)}</p>
                      <p className="text-sm text-stone-500">{leaseLocationName(f.lease)}</p>
                      {f.response && <p className="mt-1 text-sm text-stone-500">{f.response}</p>}
                    </Link>
                    <div className="shrink-0 text-right">
                      {f.promiseAmount && <p className="font-semibold text-stone-900">{formatMoney(f.promiseAmount, locale)}</p>}
                      {f.promiseDate && <p className="text-sm text-stone-500">{formatDate(f.promiseDate, locale)}</p>}
                      <form action={dismiss} className="mt-2">
                        <button type="submit" className="text-xs text-stone-500 hover:underline">
                          {t.alerts.dismiss}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {expiringLeases.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-stone-900">{t.alerts.expiringHeading(expiringLeases.length)}</h2>
          <div className="space-y-3">
            {expiringLeases.map((lease) => {
              const dismiss = dismissAlert.bind(null, "EXPIRING", lease.id, lease.endDate!.toISOString());
              return (
                <div key={lease.id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/leases/${lease.id}`} className="min-w-0 flex-1 hover:underline">
                      <p className="font-medium text-stone-900">
                        {tenantDisplayName(lease.tenant)}
                      </p>
                      <p className="text-sm text-stone-500">
                        {leaseLocationName(lease)}
                      </p>
                    </Link>
                    <div className="shrink-0 text-right">
                      <p className="font-medium text-stone-900">{lease.endDate ? formatDate(lease.endDate, locale) : "—"}</p>
                      <p className="text-sm text-stone-500">{lease.endDate ? t.alerts.daysLeft(daysUntil(lease.endDate)) : ""}</p>
                      <form action={dismiss} className="mt-2">
                        <button type="submit" className="text-xs text-stone-500 hover:underline">
                          {t.alerts.dismiss}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {reviewsDue.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-stone-900">{t.alerts.revisionHeading(reviewsDue.length)}</h2>
          <div className="space-y-3">
            {reviewsDue.map((r) => {
              const dismiss = dismissAlert.bind(null, "REVISION", r.id, "");
              return (
                <div key={r.id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/leases/${r.leaseId}`} className="min-w-0 flex-1 hover:underline">
                      <p className="font-medium text-stone-900">
                        {tenantDisplayName(r.lease.tenant)}
                      </p>
                      <p className="text-sm text-stone-500">
                        {leaseLocationName(r.lease)}
                      </p>
                      {!r.letterSentAt && <p className="mt-1 text-sm text-amber-700">{t.leaseRevision.letterNotSent}</p>}
                    </Link>
                    <div className="shrink-0 text-right">
                      <p className="font-medium text-stone-900">{t.alerts.revisionDue(formatDate(r.dueDate, locale))}</p>
                      <p className="text-sm text-stone-500">{t.alerts.daysLeft(daysUntil(r.dueDate))}</p>
                      <form action={dismiss} className="mt-2">
                        <button type="submit" className="text-xs text-stone-500 hover:underline">
                          {t.alerts.dismiss}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {needsReviewLeases.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-stone-900">{t.alerts.needsReviewHeading(needsReviewLeases.length)}</h2>
          <div className="space-y-3">
            {needsReviewLeases.map((lease) => {
              const dismiss = dismissAlert.bind(null, "NEEDS_REVIEW", lease.id, lease.reviewReason ?? "");
              return (
                <div key={lease.id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/leases/${lease.id}`} className="min-w-0 flex-1 hover:underline">
                      <p className="font-medium text-stone-900">{tenantDisplayName(lease.tenant)}</p>
                      <p className="text-sm text-stone-500">{leaseLocationName(lease)}</p>
                      {lease.reviewReason && <p className="mt-1 text-sm text-amber-700">{lease.reviewReason}</p>}
                    </Link>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <Badge status="TODO" label={t.leaseDetail.needsReview} />
                      <form action={dismiss}>
                        <button type="submit" className="text-xs text-stone-500 hover:underline">
                          {t.alerts.dismiss}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
