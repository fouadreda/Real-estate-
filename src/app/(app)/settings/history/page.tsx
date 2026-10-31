import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUserWithDictionary } from "@/lib/auth";

const ENTITIES = ["payment", "expense", "lease", "tenant", "property", "rentReview", "followUp", "alert", "user"] as const;
type Entity = (typeof ENTITIES)[number];
const PAGE_SIZE = 100;

/** Where a history line leads: the record itself when it still exists, else its lease. */
function recordHref(entry: { entity: string; entityId: string; leaseId: string | null; action: string }): string | null {
  if (entry.entity === "user") return "/settings/users";
  if (entry.action === "deleted") return entry.leaseId && entry.entity !== "lease" ? `/leases/${entry.leaseId}` : null;
  switch (entry.entity) {
    case "expense":
      return `/expenses/${entry.entityId}/edit`;
    case "tenant":
      return `/tenants/${entry.entityId}`;
    case "property":
      return `/properties/${entry.entityId}`;
    default:
      return entry.leaseId ? `/leases/${entry.leaseId}` : null;
  }
}

/** Every change made in the app (who, when, what), newest first: corrections can be traced and checked. */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ entity?: string; page?: string }> }) {
  await requireAdmin();
  const { t, locale } = await requireUserWithDictionary();
  const { entity: entityParam, page: pageParam } = await searchParams;
  const entity = (ENTITIES as readonly string[]).includes(entityParam ?? "") ? (entityParam as Entity) : null;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const where = entity ? { entity } : {};
  // shown empty rather than failing if the history table is not there yet (first deploy)
  const [entries, total] = await Promise.all([
    prisma.changeLog.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }).catch(() => []),
    prisma.changeLog.count({ where }).catch(() => 0),
  ]);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const pageHref = (p: number) => `/settings/history?${new URLSearchParams({ ...(entity ? { entity } : {}), page: String(p) })}`;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-brand-600 hover:underline">
          ← {t.users.backToSettings}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{t.history.title}</h1>
        <p className="mt-1 text-sm text-stone-500">{t.history.subtitle}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/settings/history" className={`badge ${entity === null ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700"}`}>
          {t.history.all}
        </Link>
        {ENTITIES.map((e) => (
          <Link
            key={e}
            href={`/settings/history?entity=${e}`}
            className={`badge ${entity === e ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700"}`}
          >
            {t.history.entities[e]}
          </Link>
        ))}
      </div>

      {entries.length === 0 ? (
        <div className="card text-sm text-stone-500">{t.history.empty}</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <ul className="divide-y divide-stone-100">
            {entries.map((entry) => {
              const href = recordHref(entry);
              return (
                <li key={entry.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-stone-900">
                      {t.history.entities[entry.entity as Entity] ?? entry.entity} · {t.history.actions[entry.action as keyof typeof t.history.actions] ?? entry.action}
                    </span>
                    <span className="text-xs text-stone-500">
                      {when.format(entry.at)} · {entry.userName}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-stone-600">{entry.summary}</p>
                  {href && (
                    <Link href={href} className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline">
                      {t.history.open}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={pageHref(page - 1)} className="text-brand-600 hover:underline">← {t.history.newer}</Link> : <span />}
          <span className="text-stone-500">{t.history.pageOf(page, Math.ceil(total / PAGE_SIZE))}</span>
          {page * PAGE_SIZE < total ? <Link href={pageHref(page + 1)} className="text-brand-600 hover:underline">{t.history.older} →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
