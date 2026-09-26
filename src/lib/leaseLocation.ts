import type { Property, Building } from "@prisma/client";

type PropertyWithBuilding = Property & { building?: Building | null };

/** Display label for a property: "Building — unit code" when it's part of a building, else its name. */
export function propertyLabel(property: PropertyWithBuilding): string {
  if (property.building && property.unitCode) {
    return `${property.building.name} — ${property.unitCode}`;
  }
  if (property.building) {
    return `${property.building.name} — ${property.name}`;
  }
  return property.name;
}

type LeaseWithProperty = { property: PropertyWithBuilding };

export function leaseLocationName(lease: LeaseWithProperty): string {
  return propertyLabel(lease.property);
}

export function leaseLocationHref(lease: { property: { id: string } }): string {
  return `/properties/${lease.property.id}`;
}
