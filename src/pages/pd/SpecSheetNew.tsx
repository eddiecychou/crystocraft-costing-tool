import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProduct } from "@/lib/firestore/products";
import { createSpecSheet } from "@/lib/firestore/specSheetTemplates";
import type { Product } from "@/types/product";
import SpecSheetEditorForm, { defaultSpecSheetValue, type SpecSheetFormValue } from "@/components/SpecSheetEditorForm";

export default function NewSpecSheetPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null | "loading">("loading");
  const [value, setValue] = useState<SpecSheetFormValue | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getProduct(id).then((p) => {
      setProduct(p);
      if (p) setValue(defaultSpecSheetValue(p));
    });
  }, [id]);

  async function handleSave() {
    if (!value || product === "loading" || !product) return;
    setSaving(true);
    const newId = await createSpecSheet({
      productId: id,
      name: value.name,
      photoUrl: value.photoUrl,
      tagline: value.tagline || undefined,
      fields: value.fields.filter((f) => f.label.trim()),
    });
    navigate(`/design/spec-sheets/${newId}`);
  }

  if (product === "loading" || !value) return <main className="p-10 text-ink-60">Loading…</main>;
  if (!product) return <main className="p-10 text-ink-60">Product not found.</main>;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl mb-6 print:hidden">New Spec Sheet — {product.name}</h1>
      <SpecSheetEditorForm product={product} value={value} onChange={setValue} onSave={handleSave} saving={saving} />
    </main>
  );
}
