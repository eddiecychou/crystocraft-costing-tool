import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { getProduct, updateProduct } from "@/lib/firestore/products";
import { listRealSuppliers } from "@/lib/firestore/realSuppliers";
import { supplierDisplayName, type RealSupplier } from "@/types/supplier";
import type { Product } from "@/types/product";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [product, setProduct] = useState<Product | null | "loading">("loading");
  const [suppliers, setSuppliers] = useState<RealSupplier[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getProduct(id).then((p) => {
      setProduct(p);
      if (p) {
        setName(p.name);
        setCategory(p.category || "");
        setSupplierId(p.supplierId);
        setTags(p.tags.join(", "));
        setStatus(p.status);
      }
    });
    listRealSuppliers().then(setSuppliers);
  }, [id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await updateProduct(id, {
      name,
      category: category || undefined,
      supplierId,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      status,
    });
    navigate(`/design/products/${id}`);
  }

  if (product === "loading") return <main className="p-10 text-ink-60">Loading…</main>;
  if (!product) return <main className="p-10 text-ink-60">Product not found.</main>;

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <h1 className="text-2xl mb-6">Edit Product</h1>
      <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <input id="category" className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="supplier">Supplier</label>
          <select
            id="supplier"
            className="input"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            required
          >
            <option value="" disabled>Choose a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{supplierDisplayName(s)}</option>
            ))}
          </select>
          <p className="text-xs text-ink-60 mt-1">
            Pulled from the costing-tool app&rsquo;s supplier roster — to add a
            supplier that isn&rsquo;t listed, add it there first.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="tags">Tags (comma-separated)</label>
          <input id="tags" className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select
            id="status"
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="flex gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy || !name || !supplierId}>
            {busy ? "Saving…" : "Save Changes"}
          </button>
          <Link to={`/design/products/${id}`} className="btn btn-secondary">Cancel</Link>
        </div>
      </form>
    </main>
  );
}
