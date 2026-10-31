import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, daysUntil } from "@/lib/format";
import { requireUserWithDictionary } from "@/lib/auth";
import { computeLeaseLedger, paymentStatusFor } from "@/lib/ledger";
import { getSettings } from "@/lib/settings";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import { dismissAlert, restoreAlert } from "@/lib/actions/alerts";
import Badge from "@/components/Badge";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";

export default async function AlertsPage() {
  const { t, locale } = await requireUserWithDictionary();
  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const { overdueDays } = await getSettings();

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
        where: { status: "ACTIVE", endDate: { not: null, lte: in90Days } },
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
      prisma.dismissedAlert.findMany({ include: { dismissedBy: { select: { name: true } } }, orderBy: { dismissedAt: "desc" } }),
    ]);

  const dismissedKeys = new Set(dismissed.map((d) => `${d.kind}:${d.refId}:${d.context}`));
  // the dismissals that hide an alert right now: only those are listed as hidden (one for an older
  // overdue date, or a promise kept since, hides nothing any more)
  const hidingNow = new Set<string>();
  const isDismissed = (kind: string, refId: string, context: string) => {
    const key = `${kind}:${refId}:${context}`;
    if (!dismissedKeys.has(key)) return false;
    hidingNow.add(key);
    return true;
  };

  const overdueAll = leases
    .map((lease) => ({ lease, ledger: computeLeaseLedger(lease, lease.payments, now) }))
    .filter(({ ledger }) => ledger.oldestUnpaidDate !== null && ledger.oldestUnpaidDate < now)
    .filter(({ lease, ledger }) => !isDismissed("OVERDUE", lease.id, ledger.oldestUnpaidDate!.toISOString()))
    // days late counted from Paid Until, exactly like the lease page
    .map((row) => ({ ...row, daysLate: paymentStatusFor(row.ledger.paidUntil, now, overdueDays).daysLate }))
    .sort((a, b) => (a.ledger.oldestUnpaidDate!.getTime() - b.ledger.oldestUnpaidDate!.getTime()));

  // same rule as the lease page: Overdue once the tenant is the Settings number of days past Paid Until
  const isCritical = (r: (typeof overdueAll)[number]) => r.daysLate >= overdueDays;
  const criticalOverdue = overdueAll.filter(isCritical);
  const overdue = overdueAll.filter((r) => !isCritical(r));

  const expiringLeases = expiringLeasesAll.filter(
    (lease) => !isDismissed("EXPIRING", lease.id, lease.endDate!.toISOString()),
  );
  const reviewsDue = reviewsDueAll.filter((r) => !isDismissed("REVISION", r.id, ""));
  const brokenPromises = brokenPromisesAll.filter((f) => !isDismissed("BROKEN_PROMISE", f.id, ""));
  const needsReviewLeases = needsReviewLeasesAll.filter(
    (lease) => !isDismissed("NEEDS_REVIEW", lease.id, lease.reviewReason ?? ""),
  );

  const hidden = dismissed.filter((d) => hidingNow.has(`${d.kind}:${d.refId}:${d.context}`));

  // which lease each hidden alert is about (overdue / expiring / to verify point at a lease; a review or a promise at its lease)
  const [hiddenReviews, hiddenPromises] = await Promise.all([
    prisma.rentReview.findMany({ where: { id: { in: hidden.filter((d) => d.kind === "REVISION").map((d) => d.refId) } }, select: { id: true, leaseId: true } }),
    prisma.followUp.findMany({ where: { id: { in: hidden.filter((d) => d.kind === "BROKEN_PROMISE").map((d) => d.refId) } }, select: { id: true, leaseId: true } }),
  ]);
  const leaseIdOfRef = new Map<string, string>([...hiddenReviews, ...hiddenPromises].map((x) => [x.id, x.leaseId]));
  const hiddenLeaseIds = hidden.map((d) => (d.kind === "REVISION" || d.kind === "BROKEN_PROMISE" ? leaseIdOfRef.get(d.refId) : d.refId)).filter((x): x is string => !!x);
  const hiddenLeases = await prisma.lease.findMany({ where: { id: { in: hiddenLeaseIds } }, include: { tenant: true, property: { include: { building: true } } } });
  const hiddenLeaseById = new Map(hiddenLeases.map((l) => [l.id, l]));
  const hiddenLeaseOf = new Map(
    hidden.map((d) => [d.id, hiddenLeaseById.get((d.kind === "REVISION" || d.kind === "BROKEN_PROMISE" ? leaseIdOfRef.get(d.refId) : d.refId) ?? "")]),
  );

  const hasAlerts =
    criticalOverdue.length > 0 ||
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

      {criticalOverdue.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-stone-900">{t.alerts.criticalOverdueHeading(criticalOverdue.length, overdueDays)}</h2>
          <div className="space-y-3">
            {criticalOverdue.map(({ lease, ledger, daysLate }) => {
              const dismiss = dismissAlert.bind(null, "OVERDUE", lease.id, ledger.oldestUnpaidDate!.toISOString());
              return (
                <div key={lease.id} className="card border-red-300 bg-red-100/60">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/leases/${lease.id}`} className="min-w-0 flex-1 hover:underline">
                      <p className="font-medium text-stone-900">
                        {tenantDisplayName(lease.tenant)}
                      </p>
                      <p className="text-sm text-stone-500">
                        {leaseLocationName(lease)}
                      </p>
                      <p className="mt-1 text-sm font-medium text-red-700">
                        {t.alerts.dueOverdue(formatDate(ledger.oldestUnpaidDate!, locale), daysLate)}
                      </p>
                    </Link>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold text-stone-900">{formatMoney(ledger.unpaid, locale)}</p>
                      <Badge status="TERMINATED" label={t.alerts.criticalBadge(overdueDays)} />
                      <form action={dismiss} className="mt-2">
                        <ConfirmSubmitButton
                          confirmMessage={t.alerts.dismissConfirm}
                          confirmLabel={t.alerts.dismissYes}
                          cancelLabel={t.common.cancel}
                          className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                        >
                          {t.alerts.dismiss}
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {overdue.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-stone-900">{t.alerts.overdueHeading(overdue.length)}</h2>
          <div className="space-y-3">
            {overdue.map(({ lease, ledger, daysLate }) => {
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
                        {t.alerts.dueOverdue(formatDate(ledger.oldestUnpaidDate!, locale), daysLate)}
                      </p>
                    </Link>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold text-stone-900">{formatMoney(ledger.unpaid, locale)}</p>
                      <Badge status="LATE" label={t.status.LATE} />
                      <form action={dismiss} className="mt-2">
                        <ConfirmSubmitButton
                          confirmMessage={t.alerts.dismissConfirm}
                          confirmLabel={t.alerts.dismissYes}
                          cancelLabel={t.common.cancel}
                          className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                        >
                          {t.alerts.dismiss}
                        </ConfirmSubmitButton>
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
                        <ConfirmSubmitButton
                          confirmMessage={t.alerts.dismissConfirm}
                          confirmLabel={t.alerts.dismissYes}
                          cancelLabel={t.common.cancel}
                          className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                        >
                          {t.alerts.dismiss}
                        </ConfirmSubmitButton>
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
                        <ConfirmSubmitButton
                          confirmMessage={t.alerts.dismissConfirm}
                          confirmLabel={t.alerts.dismissYes}
                          cancelLabel={t.common.cancel}
                          className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                        >
                          {t.alerts.dismiss}
                        </ConfirmSubmitButton>
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
                        <ConfirmSubmitButton
                          confirmMessage={t.alerts.dismissConfirm}
                          confirmLabel={t.alerts.dismissYes}
                          cancelLabel={t.common.cancel}
                          className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                        >
                          {t.alerts.dismiss}
                        </ConfirmSubmitButton>
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
                        <ConfirmSubmitButton
                          confirmMessage={t.alerts.dismissConfirm}
                          confirmLabel={t.alerts.dismissYes}
                          cancelLabel={t.common.cancel}
                          className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                        >
                          {t.alerts.dismiss}
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hidden.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold text-stone-900">{t.alerts.hiddenHeading(hidden.length)}</summary>
          <p className="mt-2 text-sm text-stone-500">{t.alerts.hiddenHint}</p>
          <ul className="mt-3 divide-y divide-stone-100">
            {hidden.map((d) => {
              const lease = hiddenLeaseOf.get(d.id);
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-stone-900">{t.alerts.kindLabels[d.kind]}</span>
                    {lease && (
                      <>
                        {" · "}
                        <Link href={`/leases/${lease.id}`} className="text-brand-600 hover:underline">
                          {tenantDisplayName(lease.tenant)} — {leaseLocationName(lease)}
                        </Link>
                      </>
                    )}
                    <span className="block text-xs text-stone-400">
                      {t.alerts.hiddenOn(formatDate(d.dismissedAt, locale), d.dismissedBy?.name ?? "—")}
                    </span>
                  </span>
                  <form action={restoreAlert.bind(null, d.id)}>
                    <button type="submit" className="btn-secondary">{t.alerts.restore}</button>
                  </form>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
