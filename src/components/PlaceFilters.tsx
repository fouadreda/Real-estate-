/** Building / unit / tenant selects shared by the Reports and Expenses filter forms (plain GET form fields). */
export default function PlaceFilters({
  options,
  selected,
  labels,
  showTenant = true,
}: {
  options: {
    buildings: { id: string; name: string }[];
    unitGroups: { id: string; name: string; units: { id: string; label: string }[] }[];
    tenants: { id: string; label: string }[];
  };
  selected: { building: string | null; unit: string | null; tenant?: string | null };
  labels: {
    buildingFilter: string;
    allBuildings: string;
    unitFilter: string;
    allUnits: string;
    tenantFilter: string;
    allTenants: string;
  };
  showTenant?: boolean;
}) {
  // once a building is chosen, only its units are offered
  const groups = selected.building ? options.unitGroups.filter((g) => g.id === selected.building) : options.unitGroups;
  return (
    <>
      <div className="min-w-0">
        <label className="label" htmlFor="building">{labels.buildingFilter}</label>
        <select className="input" id="building" name="building" defaultValue={selected.building ?? ""}>
          <option value="">{labels.allBuildings}</option>
          {options.buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0">
        <label className="label" htmlFor="unit">{labels.unitFilter}</label>
        <select className="input" id="unit" name="unit" defaultValue={selected.unit ?? ""}>
          <option value="">{labels.allUnits}</option>
          {groups.map((g) => (
            <optgroup key={g.id || "none"} label={g.name}>
              {g.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {showTenant && (
        <div className="min-w-0">
          <label className="label" htmlFor="tenant">{labels.tenantFilter}</label>
          <select className="input" id="tenant" name="tenant" defaultValue={selected.tenant ?? ""}>
            <option value="">{labels.allTenants}</option>
            {options.tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
