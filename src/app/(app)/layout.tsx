import { requireUserWithDictionary } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeLeaseLedger } from "@/lib/ledger";
import Nav from "@/components/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, t } = await requireUserWithDictionary();
  const now = new Date();

  const [leasesWithPayments, expiringCount] = await Promise.all([
    prisma.lease.findMany({
      where: { status: { not: "PENDING" } },
      select: { startDate: true, endDate: true, rentAmount: true, billingFrequency: true, payments: { select: { amount: true } } },
    }),
    prisma.lease.count({
      where: {
        status: "ACTIVE",
        endDate: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  const overdueCount = leasesWithPayments.filter((lease) => {
    const ledger = computeLeaseLedger(lease, lease.payments, now);
    return ledger.oldestUnpaidDate !== null && ledger.oldestUnpaidDate < now;
  }).length;

  return (
    <>
      <Nav user={user} nav={t.nav} alertCount={overdueCount + expiringCount} />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </>
  );
}
