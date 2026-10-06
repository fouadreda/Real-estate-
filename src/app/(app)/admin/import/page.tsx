import { requireUserWithDictionary } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { IMPORT_BUILDINGS, IMPORT_META } from "@/lib/import2026/sync";
import ImportRunner from "@/components/ImportRunner";

// One building per request, but each can touch a few hundred rows.
export const maxDuration = 60;

export default async function ImportPage() {
  const { user, t, locale } = await requireUserWithDictionary();

  // Functions can't cross into the client component, so leave registerDate behind.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { registerDate: _registerDate, ...runnerLabels } = t.importer;

  if (user.role !== "ADMIN") {
    return (
      <div className="card text-sm text-stone-600">{t.importer.adminOnly}</div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{t.importer.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-500">{t.importer.subtitle}</p>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold text-stone-900">{t.importer.backupHeading}</h2>
        <p className="text-sm text-stone-500">{t.importer.backupHelp}</p>
        <a href="/api/backup" className="btn-secondary inline-block">
          {t.importer.backupButton}
        </a>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold text-stone-900">{t.importer.sourcesHeading}</h2>
        <p className="text-sm text-stone-500">
          {t.importer.registerDate(formatDate(new Date(`${IMPORT_META.registerAsOf}T00:00:00Z`), locale))}
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-stone-600">
          {IMPORT_META.sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>

      <ImportRunner buildings={IMPORT_BUILDINGS} labels={runnerLabels} />
    </div>
  );
}
