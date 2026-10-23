import { requireUserWithDictionary } from "@/lib/auth";
import { updateProfile, updatePassword, updateLanguage } from "@/lib/actions/settings";
import { updateOverdueDays } from "@/lib/actions/appSettings";
import { getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/format";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import SubmitButton from "@/components/SubmitButton";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string; password?: string; language?: string; paymentStatus?: string }>;
}) {
  const { user, t, locale } = await requireUserWithDictionary();
  const params = await searchParams;
  const { overdueDays } = await getSettings();

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

      {user.role === "ADMIN" && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-stone-900">{t.users.settingsCard}</h2>
          <p className="text-sm text-stone-500">{t.users.settingsHelp}</p>
          <Link href="/settings/users" className="btn-primary inline-block">
            {t.users.open}
          </Link>
        </div>
      )}

      {user.role === "ADMIN" && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-stone-900">{t.importer.settingsCard}</h2>
          <p className="text-sm text-stone-500">{t.importer.settingsHelp}</p>
          <Link href="/admin/import" className="btn-secondary inline-block">
            {t.importer.openImport}
          </Link>
        </div>
      )}

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
          <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel={t.leaseDetail.saving}>{t.settings.saveProfile}</SubmitButton>
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
          <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel={t.leaseDetail.saving}>{t.settings.savePassword}</SubmitButton>
        </form>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-stone-900">{t.settings.paymentStatusHeading}</h2>
        <p className="text-sm text-stone-500">{t.settings.paymentStatusHelp}</p>
        {params.paymentStatus === "success" && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{t.settings.paymentStatusSaved}</div>
        )}
        {params.paymentStatus === "invalid" && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{t.settings.paymentStatusInvalid}</div>
        )}
        {params.paymentStatus === "forbidden" && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{t.settings.paymentStatusForbidden}</div>
        )}
        {params.paymentStatus === "unavailable" && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t.settings.paymentStatusUnavailable}</div>
        )}
        {user.role === "ADMIN" ? (
          <form action={updateOverdueDays} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div>
              <label className="label" htmlFor="overdueDays">{t.settings.overdueDaysLabel}</label>
              <input className="input w-32" id="overdueDays" name="overdueDays" type="number" min={1} max={365} step={1} required defaultValue={overdueDays} />
            </div>
            <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel={t.leaseDetail.saving}>{t.settings.saveOverdueDays}</SubmitButton>
          </form>
        ) : (
          <p className="text-sm text-stone-700">
            {t.settings.overdueDaysLabel}: <strong>{overdueDays}</strong>
          </p>
        )}
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
          <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel={t.leaseDetail.saving}>{t.settings.saveLanguage}</SubmitButton>
        </form>
      </div>
    </div>
  );
}
