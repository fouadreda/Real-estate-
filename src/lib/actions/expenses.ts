"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ExpenseCategory } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { attachFileToExpense } from "@/lib/actions/attachments";

function readExpenseFields(formData: FormData) {
  const propertyId = String(formData.get("propertyId") ?? "");
  const category = String(formData.get("category") ?? "OTHER") as ExpenseCategory;
  const amount = Number(formData.get("amount") ?? 0);
  const date = new Date(String(formData.get("date") ?? ""));
  const description = String(formData.get("description") ?? "").trim() || null;

  if (!propertyId || Number.isNaN(amount) || !date.getTime()) {
    throw new Error("Property, amount, and date are required.");
  }

  return { propertyId, category, amount, date, description };
}

export async function createExpense(formData: FormData) {
  const user = await requireUser();
  const data = readExpenseFields(formData);

  const expense = await prisma.expense.create({ data: { ...data, recordedById: user.id } });

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    await attachFileToExpense(expense.id, file, user.id);
  }

  revalidatePath("/expenses");
  revalidatePath("/reports");
  redirect("/expenses");
}

export async function updateExpense(expenseId: string, formData: FormData) {
  const data = readExpenseFields(formData);

  await prisma.expense.update({ where: { id: expenseId }, data });

  revalidatePath("/expenses");
  revalidatePath("/reports");
  redirect("/expenses");
}

export async function deleteExpense(expenseId: string) {
  await prisma.expense.delete({ where: { id: expenseId } });
  revalidatePath("/expenses");
  revalidatePath("/reports");
}
