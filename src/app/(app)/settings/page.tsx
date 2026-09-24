import { requireUserWithDictionary } from "@/lib/auth";
import { updateProfile, updatePassword, updateLanguage } from "@/lib/actions/settings";
import { formatDate } from "@/lib/format";
import Avatar from "@/components/Avatar";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string; password?: string; language?: string }>;
}) {
  const { user, t, locale } = await requireUserWithDictionary();
  const params = await searchParams;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{t.settings.title}</h1>
        <p className="mt-1 text-sm text-stone-500">{t.settings.subtitle}</p>
      </div>

      <div className="card flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <Avatar name={user.name} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-stone-900">{user.name}</p>
          <p className="truncate text-sm text-stone-500">{user.email}</p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span className="badge bg-brand-100 text-brand-700">
              {user.role === "ADMIN" ? t.nav.admin : t.nav.manager}
            </span>
            <span className="text-xs text-stone-400">{t.settings.memberSince(formatDate(user.createdAt, locale))}</span>
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-stone-900">{t.settings.profileHeading}</h2>
        {params.profile === "success" && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {t.settings.profileUpdated}
          </div>
        )}
        {params.profile === "emailInUse" && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{t.settings.emailInUse}</div>
        )}
        <form action={updateProfile} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">{t.settings.name}</label>
            <input className="input" id="name" name="name" required defaultValue={user.name} />
          </div>
          <div>
            <label className="label" htmlFor="email">{t.settings.email}</label>
            <input className="input" id="email" name="email" type="email" required defaultValue={user.email} />
          </div>
          <button type="submit" className="btn-primary w-full sm:w-auto">{t.settings.saveProfile}</button>
        </form>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-stone-900">{t.settings.passwordHeading}</h2>
        {params.password === "success" && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {t.settings.passwordUpdated}
          </div>
        )}
        {params.password === "wrong" && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{t.settings.wrongPassword}</div>
        )}
        {params.password === "mismatch" && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{t.settings.passwordMismatch}</div>
        )}
        {params.password === "short" && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{t.settings.passwordTooShort}</div>
        )}
        <form action={updatePassword} className="space-y-4">
          <div>
            <label className="label" htmlFor="currentPassword">{t.settings.currentPassword}</label>
            <input className="input" id="currentPassword" name="currentPassword" type="password" required />
          </div>
          <div>
            <label className="label" htmlFor="newPassword">{t.settings.newPassword}</label>
            <input className="input" id="newPassword" name="newPassword" type="password" required minLength={8} />
          </div>
          <div>
            <label className="label" htmlFor="confirmPassword">{t.settings.confirmPassword}</label>
            <input className="input" id="confirmPassword" name="confirmPassword" type="password" required minLength={8} />
          </div>
          <button type="submit" className="btn-primary w-full sm:w-auto">{t.settings.savePassword}</button>
        </form>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-stone-900">{t.settings.languageHeading}</h2>
        <p className="text-sm text-stone-500">{t.settings.languageHelp}</p>
        {params.language === "success" && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {t.settings.languageUpdated}
          </div>
        )}
        <form action={updateLanguage} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="label" htmlFor="language">{t.settings.languageHeading}</label>
            <select className="input" id="language" name="language" defaultValue={user.language}>
              <option value="EN">{t.settings.english}</option>
              <option value="FR">{t.settings.french}</option>
            </select>
          </div>
          <button type="submit" className="btn-primary w-full sm:w-auto">{t.settings.saveLanguage}</button>
        </form>
      </div>
    </div>
  );
}
