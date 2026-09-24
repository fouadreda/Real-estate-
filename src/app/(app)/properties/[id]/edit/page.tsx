import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateProperty } from "@/lib/actions/properties";
import { requireUserWithDictionary } from "@/lib/auth";

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await requireUserWithDictionary();
  const property = await prisma.property.findUnique({ where: { id } });
  if (!property) notFound();

  const updatePropertyWithId = updateProperty.bind(null, property.id);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href={`/properties/${property.id}`} className="text-sm text-brand-600 hover:underline">
          ← {property.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{t.propertyForm.editTitle}</h1>
      </div>

      <form action={updatePropertyWithId} className="card space-y-4">
        <div>
          <label className="label" htmlFor="name">{t.propertyForm.name}</label>
          <input className="input" id="name" name="name" required defaultValue={property.name} />
        </div>
        <div>
          <label className="label" htmlFor="category">{t.propertyForm.category}</label>
          <select className="input" id="category" name="category" defaultValue={property.category}>
            <option value="APARTMENT">{t.status.APARTMENT}</option>
            <option value="VILLA">{t.status.VILLA}</option>
            <option value="WAREHOUSE">{t.status.WAREHOUSE}</option>
            <option value="SHOP">{t.status.SHOP}</option>
            <option value="OFFICE">{t.status.OFFICE}</option>
            <option value="LAND">{t.status.LAND}</option>
            <option value="COMMERCIAL">{t.status.COMMERCIAL}</option>
            <option value="OTHER">{t.status.OTHER}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="address">{t.propertyForm.address}</label>
          <input className="input" id="address" name="address" required defaultValue={property.address} />
        </div>
        <div>
          <label className="label" htmlFor="city">{t.propertyForm.city}</label>
          <input className="input" id="city" name="city" required defaultValue={property.city} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="dimension">{t.propertyForm.dimension}</label>
            <input
              className="input"
              id="dimension"
              name="dimension"
              type="number"
              min="0"
              step="0.01"
              defaultValue={property.dimension ?? ""}
            />
          </div>
          <div>
            <label className="label" htmlFor="price">{t.propertyForm.price}</label>
            <input
              className="input"
              id="price"
              name="price"
              type="number"
              min="0"
              step="0.01"
              defaultValue={property.price ?? ""}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="bedrooms">{t.propertyForm.bedrooms}</label>
            <input
              className="input"
              id="bedrooms"
              name="bedrooms"
              type="number"
              min="0"
              defaultValue={property.bedrooms ?? ""}
            />
          </div>
          <div>
            <label className="label" htmlFor="bathrooms">{t.propertyForm.bathrooms}</label>
            <input
              className="input"
              id="bathrooms"
              name="bathrooms"
              type="number"
              min="0"
              step="0.5"
              defaultValue={property.bathrooms ?? ""}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="notes">{t.propertyForm.notes}</label>
          <textarea className="input" id="notes" name="notes" rows={3} defaultValue={property.notes ?? ""} />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary">{t.common.save}</button>
          <Link href={`/properties/${property.id}`} className="btn-secondary">{t.common.cancel}</Link>
        </div>
      </form>
    </div>
  );
}
