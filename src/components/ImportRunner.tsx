"use client";

import { useState } from "react";
import { runImport } from "@/lib/actions/importData";
import type { SyncResult } from "@/lib/import2026/sync";
import type { Dictionary } from "@/lib/i18n";

type Building = { key: string; name: string; units: number; leases: number; payments: number };
type Row = { state: "idle" | "running" | "done" | "error"; result?: SyncResult; error?: string; applied?: boolean };

export default function ImportRunner({ buildings, labels }: { buildings: Building[]; labels: Omit<Dictionary["importer"], "registerDate"> }) {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [replaceOld, setReplaceOld] = useState(false);

  async function run(apply: boolean) {
    setBusy(true);
    setAsking(false);
    setMessage(null);
    setRows({});
    let failed = false;
    for (const b of buildings) {
      setRows((prev) => ({ ...prev, [b.key]: { state: "running" } }));
      try {
        const outcome = await runImport(b.key, apply, replaceOld);
        if (outcome.ok) {
          setRows((prev) => ({ ...prev, [b.key]: { state: "done", result: outcome.result, applied: apply } }));
        } else {
          failed = true;
          setRows((prev) => ({ ...prev, [b.key]: { state: "error", error: outcome.error } }));
        }
      } catch (e) {
        failed = true;
        setRows((prev) => ({ ...prev, [b.key]: { state: "error", error: e instanceof Error ? e.message : String(e) } }));
      }
    }
    setBusy(false);
    if (!failed) {
      setMessage(apply ? labels.importDone : labels.previewDone);
      if (!apply) setPreviewed(true);
    } else {
      setPreviewed(false);
    }
  }

  const notes = Object.values(rows).flatMap((r) => r.result?.notes ?? []);

  return (
    <div className="space-y-4">
      <label className="card flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-stone-300"
          checked={replaceOld}
          disabled={busy}
          onChange={(e) => {
            setReplaceOld(e.target.checked);
            setPreviewed(false);
          }}
        />
        <span>
          <span className="block font-medium text-stone-900">{labels.replaceLabel}</span>
          <span className="mt-1 block text-sm text-stone-500">{labels.replaceHelp}</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(false)}>
          {labels.previewAll}
        </button>
        {!asking ? (
          <button type="button" className="btn-primary" disabled={busy || !previewed} onClick={() => setAsking(true)}>
            {labels.importAll}
          </button>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-sm text-stone-600">{labels.importConfirm}</span>
            <button type="button" className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700" disabled={busy} onClick={() => run(true)}>
              {labels.importYes}
            </button>
            <button type="button" className="text-sm text-stone-600 hover:underline" onClick={() => setAsking(false)}>
              {labels.cancel}
            </button>
          </span>
        )}
      </div>

      {message && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
              <tr>
                <th className="px-5 py-3 font-medium">{labels.buildingHeader}</th>
                <th className="px-5 py-3 font-medium">{labels.unitsHeader}</th>
                <th className="px-5 py-3 font-medium">{labels.leasesHeader}</th>
                <th className="px-5 py-3 font-medium">{labels.paymentsHeader}</th>
                <th className="px-5 py-3 font-medium">{labels.statusHeader}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {buildings.map((b) => {
                const row = rows[b.key];
                const c = row?.result?.counts;
                return (
                  <tr key={b.key} className="align-top">
                    <td className="px-5 py-3 font-medium text-stone-900">{b.name}</td>
                    <td className="px-5 py-3 text-stone-600">{b.units}</td>
                    <td className="px-5 py-3 text-stone-600">{b.leases}</td>
                    <td className="px-5 py-3 text-stone-600">{b.payments}</td>
                    <td className="px-5 py-3 text-stone-600">
                      {!row && <span className="text-stone-400">{labels.pending}</span>}
                      {row?.state === "running" && labels.running}
                      {row?.state === "error" && (
                        <span className="text-red-600">
                          {labels.failed}: {row.error}
                        </span>
                      )}
                      {c && (
                        <ul className="space-y-0.5">
                          <li className="font-medium text-stone-900">{row.applied ? labels.importedTag : labels.previewTag}</li>
                          <li>{labels.properties}: {c.propertiesCreated} {labels.created} · {c.propertiesUpdated} {labels.updated}</li>
                          <li>{labels.tenants}: {c.tenantsCreated} {labels.created} · {c.tenantsUpdated} {labels.updated}</li>
                          <li>
                            {labels.leases}: {c.leasesCreated} {labels.created} · {c.leasesUpdated} {labels.updated}
                            {c.leasesEnded > 0 ? ` · ${c.leasesEnded} ${labels.closed}` : ""}
                          </li>
                          <li>
                            {labels.payments}: {c.paymentsCreated} {labels.created} · {c.paymentsSkipped} {labels.skipped}
                            {c.paymentsRemoved > 0 ? ` · ${c.paymentsRemoved} ${labels.removed}` : ""}
                            {c.paymentsRedated > 0 ? ` · ${c.paymentsRedated} ${labels.redated}` : ""}
                          </li>
                          <li>{labels.reviews}: {c.reviewsCreated} · {labels.followUps}: {c.followUpsCreated} · {labels.issues}: {c.issuesCreated}</li>
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {notes.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-stone-900">{labels.notesHeading}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
