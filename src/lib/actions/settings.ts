"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import type { Language } from "@prisma/client";

export async function updateProfile(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!name || !email) {
    redirect("/settings?profile=error");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.id !== user.id) {
    redirect("/settings?profile=emailInUse");
  }

  await prisma.user.update({ where: { id: user.id }, data: { name, email } });
  revalidatePath("/settings");
  redirect("/settings?profile=success");
}

export async function updatePassword(formData: FormData) {
  const user = await requireUser();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    redirect("/settings?password=wrong");
  }

  if (newPassword.length < 8) {
    redirect("/settings?password=short");
  }

  if (newPassword !== confirmPassword) {
    redirect("/settings?password=mismatch");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  redirect("/settings?password=success");
}

export async function updateLanguage(formData: FormData) {
  const user = await requireUser();
  const language = String(formData.get("language") ?? "EN") as Language;

  await prisma.user.update({ where: { id: user.id }, data: { language } });
  revalidatePath("/", "layout");
  redirect("/settings?language=success");
}
