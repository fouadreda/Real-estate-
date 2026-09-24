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
};

export default function Badge({ status, label }: { status: string; label?: string }) {
  const classes = COLORS[status] ?? "bg-stone-100 text-stone-600";
  return <span className={`badge ${classes}`}>{label ?? status.replace("_", " ")}</span>;
}
