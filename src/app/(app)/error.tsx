"use client";

import Link from "next/link";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

/** Shown instead of a blank crash page when something unexpected fails while saving or loading. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = typeof document !== "undefined" && document.documentElement.lang === "en" ? en.common : fr.common;
  return (
    <div className="card mx-auto max-w-lg space-y-4 text-center">
      <p className="font-medium text-stone-900">{t.errorTitle}</p>
      <p className="text-sm text-stone-600">{t.errorHint}</p>
      <div className="flex justify-center gap-3">
        <button type="button" className="btn-primary" onClick={() => reset()}>
          {t.retry}
        </button>
        <Link href="/" className="btn-secondary">
          {t.backHome}
        </Link>
      </div>
    </div>
  );
}
