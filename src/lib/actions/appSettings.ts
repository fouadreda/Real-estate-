"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/** Admin-only: saves the number of days after which a late tenant is Overdue. */
export async function updateOverdueDays(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/settings?paymentStatus=forbidden");

  const days = Math.round(Number(formData.get("overdueDays")));
  if (!Number.isFinite(days) || days < 1 || days > 365) redirect("/settings?paymentStatus=invalid");

  try {
    await prisma.appSetting.upsert({
      where: { key: "overdueDays" },
      update: { value: String(days) },
      create: { key: "overdueDays", value: String(days) },
    });
  } catch {
    redirect("/settings?paymentStatus=unavailable");
  }

  revalidatePath("/", "layout");
  redirect("/settings?paymentStatus=success");
}
