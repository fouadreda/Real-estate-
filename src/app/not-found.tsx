import Link from "next/link";
import { fr } from "@/lib/i18n/fr";

/** Any address that matches no page: a French card with a way back, instead of Next's English default. */
export default function NotFound() {
  const t = fr.common;
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-6">
      <div className="card w-full max-w-md space-y-4 text-center">
        <p className="text-lg font-semibold text-stone-900">
          Les <span className="text-brand-600">Cocotiers</span>
        </p>
        <p className="text-stone-700">{t.notFoundTitle}</p>
        <Link href="/" className="btn-primary">
          {t.backHome}
        </Link>
      </div>
    </div>
  );
}
