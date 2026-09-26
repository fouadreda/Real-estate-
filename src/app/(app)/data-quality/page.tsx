import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUserWithDictionary } from "@/lib/auth";
import { leaseLocationName } from "@/lib/leaseLocation";
import { tenantDisplayName } from "@/lib/tenantName";
import { updateDataIssueStatus } from "@/lib/actions/dataIssues";
import Badge from "@/components/Badge";
import type { IssueStatus } from "@prisma/client";

export default async function DataQualityPage() {
  const { t } = await requireUserWithDictionary();
  const issues = await prisma.dataIssue.findMany({
    include: {
      lease: { include: { tenant: true, property: { include: { building: true } } } },
      property: { include: { building: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const statusOptions: IssueStatus[] = ["TODO", "IN_PROGRESS", "FIXED"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{t.dataQuality.title}</h1>
        <p className="mt-1 text-sm text-stone-500">{t.dataQuality.subtitle}</p>
        <p className="mt-1 text-sm text-stone-500">{t.dataQuality.total(issues.length)}</p>
      </div>

      {issues.length === 0 ? (
        <div className="card text-sm text-stone-500">{t.dataQuality.empty}</div>
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => (
            <div key={issue.id} className="card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  {issue.lease ? (
                    <Link href={`/leases/${issue.leaseId}`} className="text-sm font-medium text-stone-900 hover:underline">
                      {leaseLocationName(issue.lease)} · {tenantDisplayName(issue.lease.tenant)}
                    </Link>
                  ) : issue.property ? (
                    <Link href={`/properties/${issue.propertyId}`} className="text-sm font-medium text-stone-900 hover:underline">
                      {issue.property.building ? `${issue.property.building.name} — ${issue.property.unitCode ?? issue.property.name}` : issue.property.name}
                    </Link>
                  ) : null}
                  <p className="mt-1 text-sm text-stone-600">{issue.problem}</p>
                  {issue.action && <p className="mt-1 text-xs text-stone-500">{t.dataQuality.actionHeader}: {issue.action}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge status={issue.status} label={t.status[issue.status]} />
                  <div className="flex gap-1">
                    {statusOptions.map((status) => {
                      const setStatus = updateDataIssueStatus.bind(null, issue.id, status);
                      return (
                        <form key={status} action={setStatus}>
                          <button
                            type="submit"
                            disabled={issue.status === status}
                            className="text-xs text-brand-600 hover:underline disabled:text-stone-300"
                          >
                            {t.status[status]}
                          </button>
                        </form>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
