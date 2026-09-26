"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PropertyCategory, BuildingType } from "@prisma/client";

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

async function resolveBuildingId(formData: FormData): Promise<string | null> {
  const buildingId = String(formData.get("buildingId") ?? "").trim();
  const newBuildingName = String(formData.get("newBuildingName") ?? "").trim();
  const newBuildingType = String(formData.get("newBuildingType") ?? "BUILDING") as BuildingType;

  if (buildingId === "__new__" && newBuildingName) {
    const building = await prisma.building.upsert({
      where: { name: newBuildingName },
      update: {},
      create: { name: newBuildingName, type: newBuildingType },
    });
    return building.id;
  }
  return buildingId || null;
}

function readPropertyFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const category = String(formData.get("category") ?? "APARTMENT") as PropertyCategory;
  const dimension = parseOptionalFloat(formData.get("dimension"));
  const areaLabel = String(formData.get("areaLabel") ?? "").trim() || null;
  const bedrooms = parseOptionalInt(formData.get("bedrooms"));
  const bathrooms = parseOptionalFloat(formData.get("bathrooms"));
  const price = parseOptionalFloat(formData.get("price"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const floor = String(formData.get("floor") ?? "").trim() || null;
  const unitCode = String(formData.get("unitCode") ?? "").trim() || null;

  if (!name || !address || !city) {
    throw new Error("Name, address, and city are required.");
  }

  return { name, address, city, category, dimension, areaLabel, bedrooms, bathrooms, price, notes, floor, unitCode };
}

export async function createProperty(formData: FormData) {
  const data = readPropertyFields(formData);
  const buildingId = await resolveBuildingId(formData);

  const property = await prisma.property.create({ data: { ...data, buildingId } });

  revalidatePath("/properties");
  redirect(`/properties/${property.id}`);
}

export async function updateProperty(propertyId: string, formData: FormData) {
  const data = readPropertyFields(formData);
  const buildingId = await resolveBuildingId(formData);

  await prisma.property.update({ where: { id: propertyId }, data: { ...data, buildingId } });

  revalidatePath("/properties");
  revalidatePath(`/properties/${propertyId}`);
  redirect(`/properties/${propertyId}`);
}

export async function deleteProperty(propertyId: string) {
  await prisma.property.delete({ where: { id: propertyId } });
  revalidatePath("/properties");
  redirect("/properties");
}
