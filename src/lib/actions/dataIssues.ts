"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { IssueStatus } from "@prisma/client";

export async function updateDataIssueStatus(issueId: string, status: IssueStatus) {
  await prisma.dataIssue.update({ where: { id: issueId }, data: { status } });
  revalidatePath("/data-quality");
}
