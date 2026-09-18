import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProduct } from "@/lib/firestore/products";
import { getSpecSheet, updateSpecSheet, deleteSpecSheet } from "@/lib/firestore/specSheetTemplates";
import type { Product } from "@/types/product";
import type { SpecSheetTemplate } from "@/types/specSheetTemplate";
import SpecSheetEditorForm, { type SpecSheetFormValue } from "@/components/SpecSheetEditorForm";

export default function SpecSheetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<SpecSheetTemplate | null | "loading">("loading");
  const [product, setProduct] = useState<Product | null>(null);
  const [value, setValue] = useState<SpecSheetFormValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    getSpecSheet(id).then(async (s) => {
      setSheet(s);
      if (s) {
        const p = await getProduct(s.productId);
        setProduct(p);
        setValue({ name: s.name, photoUrl: s.photoUrl, tagline: s.tagline || "", fields: s.fields });
      }
    });
  }, [id]);

  async function handleSave() {
    if (!value) return;
    setSaving(true);
    await updateSpecSheet(id, {
      name: value.name,
      photoUrl: value.photoUrl,
      tagline: value.tagline || undefined,
      fields: value.fields.filter((f) => f.label.trim()),
    });
    setSaving(false);
  }

  async function handleDelete() {
    const ok = window.confirm(`Delete spec sheet "${value?.name}"? This cannot be undone.`);
    if (!ok) return;
    setDeleting(true);
    await deleteSpecSheet(id);
    navigate(product ? `/design/products/${product.id}` : "/design");
  }

  if (sheet === "loading" || !value) return <main className="p-10 text-ink-60">Loading…</main>;
  if (!sheet || !product) return <main className="p-10 text-ink-60">Spec sheet not found.</main>;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <h1 className="text-2xl">{product.name} — Spec Sheet</h1>
        <button type="button" className="btn btn-secondary text-red-700" onClick={handleDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
      <SpecSheetEditorForm product={product} value={value} onChange={setValue} onSave={handleSave} saving={saving} />
    </main>
  );
}
