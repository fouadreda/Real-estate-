"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession } from "@/lib/auth";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !valid) {
    redirect("/login?error=1");
  }

  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
