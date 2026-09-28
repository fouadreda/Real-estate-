import { requireUserWithDictionary } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeLeaseLedger } from "@/lib/ledger";
import Nav from "@/components/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, t } = await requireUserWithDictionary();
  const now = new Date();

  const [leasesWithPayments, expiringLeases, dismissed] = await Promise.all([
    prisma.lease.findMany({
      where: { status: { not: "PENDING" }, needsReview: false },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        ledgerStartDate: true,
        rentAmount: true,
        billingFrequency: true,
        payments: { select: { amount: true, kind: true, confirmed: true, date: true } },
      },
    }),
    prisma.lease.findMany({
      where: {
        status: "ACTIVE",
        endDate: { not: null, lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
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
      <Nav user={user} nav={t.nav} alertCount={overdueCount + expiringCount} />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </>
  );
}
