import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [buildings, properties, tenants, leases, payments, expenses, followUps, rentReviews, dataIssues, attachments, dismissedAlerts] =
    await Promise.all([
      prisma.building.findMany(),
      prisma.property.findMany(),
      prisma.tenant.findMany(),
      prisma.lease.findMany(),
      prisma.payment.findMany(),
      prisma.expense.findMany(),
      prisma.followUp.findMany(),
      prisma.rentReview.findMany(),
      prisma.dataIssue.findMany(),
      prisma.attachment.findMany(),
      prisma.dismissedAlert.findMany(),
    ]);

  const data = { buildings, properties, tenants, leases, payments, expenses, followUps, rentReviews, dataIssues, attachments, dismissedAlerts };
  const counts = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
  const exportedAt = new Date();

  return new NextResponse(JSON.stringify({ exportedAt: exportedAt.toISOString(), counts, ...data }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="cocotiers-backup-${exportedAt.toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
