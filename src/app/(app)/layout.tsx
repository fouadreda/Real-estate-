import { requireUserWithDictionary } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeLeaseLedger } from "@/lib/ledger";
import Nav from "@/components/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, t } = await requireUserWithDictionary();
  const now = new Date();

  // An Upcoming lease becomes Active by itself on its start date, and its unit becomes occupied.
  const starting = await prisma.lease
    .findMany({ where: { status: "PENDING", startDate: { lte: now } }, select: { id: true, propertyId: true } })
    .catch(() => []);
  if (starting.length > 0) {
    await prisma
      .$transaction([
        prisma.lease.updateMany({ where: { id: { in: starting.map((l) => l.id) }, status: "PENDING" }, data: { status: "ACTIVE" } }),
        prisma.property.updateMany({ where: { id: { in: starting.map((l) => l.propertyId) } }, data: { status: "OCCUPIED" } }),
      ])
      .catch(() => undefined);
  }

  const [leasesWithPayments, expiringLeases, dismissed] = await Promise.all([
    prisma.lease.findMany({
      where: { status: { not: "PENDING" }, needsReview: false },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        ledgerStartDate: true,
        closedAt: true,
        rentAmount: true,
        billingFrequency: true,
        payments: { select: { amount: true, kind: true, confirmed: true, date: true, notes: true, monthsCovered: true, recordedById: true } },
        rentReviews: { where: { appliedAt: { not: null } }, select: { dueDate: true, rate: true, appliedAt: true } },
      },
    }),
    prisma.lease.findMany({
      where: {
        status: "ACTIVE",
        endDate: { not: null, lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, endDate: true },
    }),
    prisma.dismissedAlert.findMany({
      where: { kind: { in: ["OVERDUE", "EXPIRING"] } },
      select: { kind: true, refId: true, context: true },
    }),
  ]);

  const dismissedKeys = new Set(dismissed.map((d) => `${d.kind}:${d.refId}:${d.context}`));

  const overdueCount = leasesWithPayments.filter((lease) => {
    const ledger = computeLeaseLedger(lease, lease.payments, now);
    return (
      ledger.oldestUnpaidDate !== null &&
      ledger.oldestUnpaidDate < now &&
      !dismissedKeys.has(`OVERDUE:${lease.id}:${ledger.oldestUnpaidDate.toISOString()}`)
    );
  }).length;

  const expiringCount = expiringLeases.filter(
    (lease) => !dismissedKeys.has(`EXPIRING:${lease.id}:${lease.endDate!.toISOString()}`),
  ).length;

  return (
    <>
      <Nav user={{ name: user.name, role: user.role }} nav={t.nav} alertCount={overdueCount + expiringCount} />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </>
  );
}
