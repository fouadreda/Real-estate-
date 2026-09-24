"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PropertyCategory } from "@prisma/client";

function parseOptionalFloat(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function readPropertyFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const category = String(formData.get("category") ?? "APARTMENT") as PropertyCategory;
  const dimension = parseOptionalFloat(formData.get("dimension"));
  const bedrooms = parseOptionalInt(formData.get("bedrooms"));
  const bathrooms = parseOptionalFloat(formData.get("bathrooms"));
  const price = parseOptionalFloat(formData.get("price"));
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!name || !address || !city) {
    throw new Error("Name, address, and city are required.");
  }

  return { name, address, city, category, dimension, bedrooms, bathrooms, price, notes };
}

export async function createProperty(formData: FormData) {
  const data = readPropertyFields(formData);

  const property = await prisma.property.create({ data });

  revalidatePath("/properties");
  redirect(`/properties/${property.id}`);
}

export async function updateProperty(propertyId: string, formData: FormData) {
  const data = readPropertyFields(formData);

  await prisma.property.update({ where: { id: propertyId }, data });

  revalidatePath("/properties");
  revalidatePath(`/properties/${propertyId}`);
  redirect(`/properties/${propertyId}`);
}

export async function deleteProperty(propertyId: string) {
  await prisma.property.delete({ where: { id: propertyId } });
  revalidatePath("/properties");
  redirect("/properties");
}
