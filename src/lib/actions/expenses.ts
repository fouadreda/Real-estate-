"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ExpenseCategory } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { attachFileToExpense } from "@/lib/actions/attachments";
import { isAllowedUpload } from "@/lib/uploads";
import { changedFields, describe, logChange } from "@/lib/changeLog";
import { propertyLabel } from "@/lib/leaseLocation";
import { safeBackPath } from "@/lib/backPath";

/** Reads the form; an invalid form goes back to `failUrl` with an error code. */
function readExpenseFields(formData: FormData, failUrl: string) {
  const propertyId = String(formData.get("propertyId") ?? "");
  const category = String(formData.get("category") ?? "OTHER") as ExpenseCategory;
  const amount = Number(formData.get("amount") ?? 0);
  const date = new Date(String(formData.get("date") ?? ""));
  const description = String(formData.get("description") ?? "").trim() || null;

  if (!propertyId || Number.isNaN(amount) || amount <= 0 || Number.isNaN(date.getTime())) {
    redirect(`${failUrl}${failUrl.includes("?") ? "&" : "?"}error=expenseFields`);
  }

  return { propertyId, category, amount, date, description };
}

/** An expense changes Reports, the Expenses page, the dashboard and the assistant's answers: refresh them all. */
function refreshExpensePages() {
  revalidatePath("/", "layout");
}

const expenseSummary = (e: { amount: number; category: string; date: Date; description: string | null; property: Parameters<typeof propertyLabel>[0] }) =>
  `${describe.money(e.amount)} · ${describe.code(e.category)} · ${describe.day(e.date)} — ${propertyLabel(e.property)}${e.description ? ` — ${e.description}` : ""}`;

export async function createExpense(formData: FormData) {
  const user = await requireUser();
  const data = readExpenseFields(formData, "/expenses/new");

  const raw = formData.get("file");
  const file = raw instanceof File && raw.size > 0 ? raw : null;
  if (file && !isAllowedUpload(file)) redirect("/expenses/new?error=file");

  const expense = await prisma.expense.create({
    data: { ...data, recordedById: user.id },
    include: { property: { include: { building: true } } },
  });
  if (file) {
    try {
      await attachFileToExpense(expense.id, file, user.id);
    } catch {
      // the invoice could not be stored: undo the expense so a retry does not record it twice
      await prisma.expense.delete({ where: { id: expense.id } }).catch(() => undefined);
      redirect("/expenses/new?error=upload");
    }
  }

  await logChange(user, { entity: "expense", entityId: expense.id, action: "created", summary: expenseSummary(expense) });
  refreshExpensePages();
  redirect("/expenses");
}

export async function updateExpense(expenseId: string, formData: FormData) {
  const user = await requireUser();
  const back = safeBackPath(formData.get("back"));
  const data = readExpenseFields(formData, `/expenses/${expenseId}/edit${back ? `?back=${encodeURIComponent(back)}` : ""}`);

  const before = await prisma.expense.findUnique({ where: { id: expenseId }, include: { property: { include: { building: true } } } });
  // deleted in the meantime (another tab, a colleague): back to the list instead of an error page
  if (!before) redirect(back ?? "/expenses");
  const after = await prisma.expense.update({ where: { id: expenseId }, data, include: { property: { include: { building: true } } } });

  await logChange(user, {
    entity: "expense",
    entityId: expenseId,
    action: "updated",
    summary: `${changedFields([
      ["bien", propertyLabel(before.property), propertyLabel(after.property)],
      ["catégorie", describe.code(before.category), describe.code(after.category)],
      ["montant", describe.money(before.amount), describe.money(after.amount)],
      ["date", describe.day(before.date), describe.day(after.date)],
      ["description", before.description ?? "—", after.description ?? "—"],
    ])} — ${expenseSummary(after)}`,
  });
  refreshExpensePages();
  redirect(back ?? "/expenses");
}

export async function deleteExpense(expenseId: string) {
  const user = await requireUser();
  const expense = await prisma.expense.findUnique({ where: { id: expenseId }, include: { property: { include: { building: true } } } });
  // already deleted (double tap, another tab): nothing to do
  if (!expense) return;
  await prisma.expense.delete({ where: { id: expenseId } });
  await logChange(user, { entity: "expense", entityId: expenseId, action: "deleted", summary: expenseSummary(expense) });
  refreshExpensePages();
}

/** Delete from the expense's own page, then go back to where staff came from. */
export async function deleteExpenseAndReturn(expenseId: string, back: string | null) {
  await deleteExpense(expenseId);
  redirect(safeBackPath(back) ?? "/expenses");
}
