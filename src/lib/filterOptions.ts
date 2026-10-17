import { prisma } from "@/lib/prisma";
import { tenantDisplayName } from "@/lib/tenantName";

/** Buildings, units (grouped by building) and tenants for the report and expense filters. */
export async function loadFilterOptions() {
  const [buildings, units, tenants] = await Promise.all([
    prisma.building.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.property.findMany({ select: { id: true, name: true, unitCode: true, buildingId: true }, orderBy: { name: "asc" } }),
    prisma.tenant.findMany({ select: { id: true, firstName: true, lastName: true, company: true } }),
  ]);
  const unitGroups = [
    ...buildings.map((b) => ({ id: b.id, name: b.name })),
    { id: "", name: "—" },
  ]
    .map((b) => ({
      ...b,
      units: units
        .filter((u) => (u.buildingId ?? "") === b.id)
        .map((u) => ({ id: u.id, label: u.unitCode ?? u.name }))
        .sort((a, c) => a.label.localeCompare(c.label, "fr", { numeric: true })),
    }))
    .filter((g) => g.units.length > 0);
  return {
    buildings,
    unitGroups,
    unitIds: new Set(units.map((u) => u.id)),
    tenants: tenants
      .map((t) => ({ id: t.id, label: tenantDisplayName(t) }))
      .sort((a, c) => a.label.localeCompare(c.label, "fr")),
  };
}

/** The id from the URL when it is one of the known ids, else null (an old or edited link is ignored). */
export function knownId(value: string | undefined, ids: Iterable<string>): string | null {
  if (!value) return null;
  for (const id of ids) if (id === value) return value;
  return null;
}
