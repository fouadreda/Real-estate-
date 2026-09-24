import { login } from "@/lib/actions/auth";
import { en } from "@/lib/i18n/en";

const t = en.login;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-stone-900">
            Les <span className="text-brand-600">Cocotiers</span>
          </h1>
          <p className="mt-1 text-sm text-stone-500">{t.subtitle}</p>
        </div>

        <form action={login} className="card space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {t.error}
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">{t.email}</label>
            <input className="input" id="email" name="email" type="email" required autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="password">{t.password}</label>
            <input className="input" id="password" name="password" type="password" required />
          </div>
          <button type="submit" className="btn-primary w-full">{t.submit}</button>
        </form>
      </div>
    </div>
  );
}
