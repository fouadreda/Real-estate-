const COLORS: Record<string, string> = {
  VACANT: "bg-amber-100 text-amber-700",
  OCCUPIED: "bg-emerald-100 text-emerald-700",
  MAINTENANCE: "bg-stone-200 text-stone-700",
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-700",
  ENDED: "bg-stone-200 text-stone-700",
  TERMINATED: "bg-red-100 text-red-700",
  PAID: "bg-emerald-100 text-emerald-700",
  LATE: "bg-red-100 text-red-700",
  APARTMENT: "bg-brand-50 text-brand-700",
  VILLA: "bg-teal-100 text-teal-700",
  WAREHOUSE: "bg-orange-100 text-orange-700",
  SHOP: "bg-pink-100 text-pink-700",
  OFFICE: "bg-indigo-100 text-indigo-700",
  LAND: "bg-lime-100 text-lime-700",
  COMMERCIAL: "bg-purple-100 text-purple-700",
  OTHER: "bg-stone-100 text-stone-600",
  UTILITIES: "bg-sky-100 text-sky-700",
  REPAIRS: "bg-orange-100 text-orange-700",
  INSURANCE: "bg-indigo-100 text-indigo-700",
  TAXES: "bg-red-100 text-red-700",
  MANAGEMENT_FEE: "bg-purple-100 text-purple-700",
  SALES_SERVICE_FEES: "bg-orange-100 text-orange-700",
  TRANSPORT_COMMS: "bg-teal-100 text-teal-700",
  OFFICE_SUPPLIES: "bg-lime-100 text-lime-700",
  SALARY: "bg-fuchsia-100 text-fuchsia-700",
  SITE_STAFF: "bg-fuchsia-100 text-fuchsia-700",
  OFFICE_EQUIPMENT: "bg-lime-100 text-lime-700",
  // Building types
  BUILDING: "bg-cyan-100 text-cyan-700",
  WAREHOUSE_SITE: "bg-orange-100 text-orange-700",
  // Payment kinds
  RENT: "bg-emerald-100 text-emerald-700",
  ARREARS: "bg-red-100 text-red-700",
  ADVANCE_AT_ENTRY: "bg-sky-100 text-sky-700",
  DEPOSIT: "bg-indigo-100 text-indigo-700",
  DEPOSIT_REFUND: "bg-purple-100 text-purple-700",
  // Follow-up actions / results
  CALL_VISIT: "bg-sky-100 text-sky-700",
  SMS_WHATSAPP: "bg-teal-100 text-teal-700",
  LETTER: "bg-amber-100 text-amber-700",
  FORMAL_NOTICE: "bg-red-100 text-red-700",
  LAWYER: "bg-red-100 text-red-700",
  BROKEN: "bg-red-100 text-red-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  // Data issue status
  TODO: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-sky-100 text-sky-700",
  FIXED: "bg-emerald-100 text-emerald-700",
};

export default function Badge({ status, label }: { status: string; label?: string }) {
  const classes = COLORS[status] ?? "bg-stone-100 text-stone-600";
  return <span className={`badge ${classes}`}>{label ?? status.replace("_", " ")}</span>;
}
