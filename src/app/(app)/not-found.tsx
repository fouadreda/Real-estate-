import Link from "next/link";
import { requireUserWithDictionary } from "@/lib/auth";

export default async function NotFound() {
  const { t } = await requireUserWithDictionary();
  return (
    <div className="card mx-auto max-w-lg space-y-4 text-center">
      <p className="text-stone-700">{t.common.notFoundTitle}</p>
      <Link href="/" className="btn-primary">
        {t.common.backHome}
      </Link>
    </div>
  );
}
