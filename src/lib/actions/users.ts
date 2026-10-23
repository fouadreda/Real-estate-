"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import type { Role } from "@prisma/client";

const PAGE = "/settings/users";
const MIN_PASSWORD = 8;
const ROLES: Role[] = ["MANAGER", "ADMIN"];

/** Administrators create accounts for managers (or other administrators) with a temporary password. */
export async function createUser(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const roleRaw = String(formData.get("role") ?? "MANAGER");
  const role = (ROLES as string[]).includes(roleRaw) ? (roleRaw as Role) : "MANAGER";

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < MIN_PASSWORD) {
    redirect(`${PAGE}?error=fields`);
  }
  if (await prisma.user.findUnique({ where: { email } })) redirect(`${PAGE}?error=emailInUse`);

  await prisma.user.create({
    data: { name, email, role, language: "FR", passwordHash: await bcrypt.hash(password, 10) },
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?done=created`);
}

/** Sets a new password for someone (e.g. they forgot theirs) and signs them out everywhere. */
export async function resetUserPassword(userId: string, formData: FormData) {
  await requireAdmin();
  const password = String(formData.get("password") ?? "");
  if (password.length < MIN_PASSWORD) redirect(`${PAGE}?error=password`);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, 10) } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  revalidatePath(PAGE);
  redirect(`${PAGE}?done=passwordReset`);
}

/** Removes someone's access (signed out at once, cannot sign in) or gives it back. Their records are kept. */
export async function setUserAccess(userId: string, active: boolean) {
  const admin = await requireAdmin();
  if (!active) {
    if (userId === admin.id) redirect(`${PAGE}?error=self`);
    const target = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    if (target.role === "ADMIN") {
      const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", active: true, id: { not: userId } } });
      if (otherAdmins === 0) redirect(`${PAGE}?error=lastAdmin`);
    }
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { active } }),
    ...(active ? [] : [prisma.session.deleteMany({ where: { userId } })]),
  ]);
  revalidatePath(PAGE);
  redirect(`${PAGE}?done=${active ? "accessRestored" : "accessRemoved"}`);
}
