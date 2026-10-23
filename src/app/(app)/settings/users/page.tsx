import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUserWithDictionary } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createUser, resetUserPassword, setUserAccess } from "@/lib/actions/users";
import Avatar from "@/components/Avatar";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import SubmitButton from "@/components/SubmitButton";

const DONE = ["created", "passwordReset", "accessRemoved", "accessRestored"] as const;
const ERRORS = ["fields", "emailInUse", "password", "self", "lastAdmin"] as const;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const admin = await requireAdmin();
  const { t, locale } = await requireUserWithDictionary();
  const { done, error } = await searchParams;
  const users = await prisma.user.findMany({ orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }] });

  const doneMessage = (DONE as readonly string[]).includes(done ?? "") ? t.users[done as (typeof DONE)[number]] : null;
  const errorMessage = (ERRORS as readonly string[]).includes(error ?? "")
    ? {
        fields: t.users.errorFields,
        emailInUse: t.users.errorEmailInUse,
        password: t.users.errorPassword,
        self: t.users.errorSelf,
        lastAdmin: t.users.errorLastAdmin,
      }[error as (typeof ERRORS)[number]]
    : null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-brand-600 hover:underline">
          ← {t.users.backToSettings}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{t.users.title}</h1>
        <p className="mt-1 text-sm text-stone-500">{t.users.subtitle}</p>
      </div>

      {doneMessage && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{doneMessage}</p>
      )}
      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{errorMessage}</p>
      )}

      <form action={createUser} className="card space-y-4">
        <h2 className="font-semibold text-stone-900">{t.users.addHeading}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">{t.users.name}</label>
            <input className="input" id="name" name="name" required autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="email">{t.users.email}</label>
            <input className="input" id="email" name="email" type="email" required autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="password">{t.users.tempPassword}</label>
            <input className="input" id="password" name="password" type="text" minLength={8} required autoComplete="new-password" />
            <p className="mt-1 text-xs text-stone-500">{t.users.tempPasswordHelp}</p>
          </div>
          <div>
            <label className="label" htmlFor="role">{t.users.role}</label>
            <select className="input" id="role" name="role" defaultValue="MANAGER">
              <option value="MANAGER">{t.nav.manager}</option>
              <option value="ADMIN">{t.nav.admin}</option>
            </select>
          </div>
        </div>
        <SubmitButton className="btn-primary" pendingLabel={t.leaseDetail.saving}>
          {t.users.create}
        </SubmitButton>
      </form>

      <div className="space-y-3">
        <h2 className="font-semibold text-stone-900">{t.users.listHeading}</h2>
        {users.map((u) => {
          const isMe = u.id === admin.id;
          const reset = resetUserPassword.bind(null, u.id);
          const remove = setUserAccess.bind(null, u.id, false);
          const restore = setUserAccess.bind(null, u.id, true);
          return (
            <div key={u.id} className={`card space-y-3 ${u.active ? "" : "bg-stone-50"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <Avatar name={u.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-stone-900">
                    {u.name}
                    {isMe && <span className="ml-1 text-sm font-normal text-stone-400">({t.users.you})</span>}
                  </p>
                  <p className="truncate text-sm text-stone-500">{u.email}</p>
                </div>
                <span className="badge bg-brand-100 text-brand-700">{u.role === "ADMIN" ? t.nav.admin : t.nav.manager}</span>
                <span className={`badge ${u.active ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  {u.active ? t.users.active : t.users.removed}
                </span>
                <span className="text-xs text-stone-400">{t.settings.memberSince(formatDate(u.createdAt, locale))}</span>
              </div>

              <div className="flex flex-wrap items-end gap-3 border-t border-stone-100 pt-3">
                <form action={reset} className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="label" htmlFor={`pw-${u.id}`}>{t.users.newPassword}</label>
                    <input
                      className="input !w-56"
                      id={`pw-${u.id}`}
                      name="password"
                      type="text"
                      minLength={8}
                      required
                      autoComplete="new-password"
                    />
                  </div>
                  <SubmitButton className="btn-secondary" pendingLabel={t.leaseDetail.saving}>
                    {t.users.resetPassword}
                  </SubmitButton>
                </form>
                {!isMe &&
                  (u.active ? (
                    <form action={remove} className="sm:ml-auto">
                      <ConfirmSubmitButton
                        confirmMessage={t.users.removeConfirm}
                        confirmLabel={t.users.removeYes}
                        cancelLabel={t.common.cancel}
                        className="btn-danger"
                      >
                        {t.users.removeAccess}
                      </ConfirmSubmitButton>
                    </form>
                  ) : (
                    <form action={restore} className="sm:ml-auto">
                      <SubmitButton className="btn-primary" pendingLabel={t.leaseDetail.saving}>
                        {t.users.restoreAccess}
                      </SubmitButton>
                    </form>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
