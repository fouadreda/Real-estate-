"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ExpenseCategory } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { attachFileToExpense } from "@/lib/actions/attachments";
import { isAllowedUpload } from "@/lib/uploads";

/** Reads the form; an invalid form goes back to `failUrl` with an error code. */
function readExpenseFields(formData: FormData, failUrl: string) {
  const propertyId = String(formData.get("propertyId") ?? "");
  const category = String(formData.get("category") ?? "OTHER") as ExpenseCategory;
  const amount = Number(formData.get("amount") ?? 0);
  const date = new Date(String(formData.get("date") ?? ""));
  const description = String(formData.get("description") ?? "").trim() || null;

  if (!propertyId || Number.isNaN(amount) || amount <= 0 || Number.isNaN(date.getTime())) {
    redirect(`${failUrl}?error=expenseFields`);
  }

  return { propertyId, category, amount, date, description };
}

export async function createExpense(formData: FormData) {
  const user = await requireUser();
  const data = readExpenseFields(formData, "/expenses/new");

  const raw = formData.get("file");
  const file = raw instanceof File && raw.size > 0 ? raw : null;
  if (file && !isAllowedUpload(file)) redirect("/expenses/new?error=file");

  const expense = await prisma.expense.create({ data: { ...data, recordedById: user.id } });
  if (file) {
    try {
      await attachFileToExpense(expense.id, file, user.id);
    } catch {
      // the invoice could not be stored: undo the expense so a retry does not record it twice
      await prisma.expense.delete({ where: { id: expense.id } }).catch(() => undefined);
      redirect("/expenses/new?error=upload");
    }
  }

  revalidatePath("/expenses");
  revalidatePath("/reports");
  redirect("/expenses");
}

export async function updateExpense(expenseId: string, formData: FormData) {
  await requireUser();
  const data = readExpenseFields(formData, `/expenses/${expenseId}/edit`);

  await prisma.expense.update({ where: { id: expenseId }, data });

  revalidatePath("/expenses");
  revalidatePath("/reports");
  redirect("/expenses");
}

export async function deleteExpense(expenseId: string) {
  await requireUser();
  await prisma.expense.delete({ where: { id: expenseId } });
  revalidatePath("/expenses");
  revalidatePath("/reports");
}
