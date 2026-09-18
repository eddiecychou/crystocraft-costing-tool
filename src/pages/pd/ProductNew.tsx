import { useEffect, useState, type FormEvent, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createProduct } from "@/lib/firestore/products";
import { listRealSuppliers } from "@/lib/firestore/realSuppliers";
import { supplierDisplayName, type RealSupplier } from "@/types/supplier";

function NewProductForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedSupplierId = searchParams.get("supplierId") || "";

  const [suppliers, setSuppliers] = useState<RealSupplier[]>([]);
  const [supplierId, setSupplierId] = useState(preselectedSupplierId);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listRealSuppliers().then(setSuppliers);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const id = await createProduct({
      supplierId,
      name,
      category: category || undefined,
      tags: [],
      status: "active",
    });
    navigate(`/design/products/${id}`);
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <h1 className="text-2xl mb-6">New Product</h1>
      <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-4">
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
          <label className="label" htmlFor="name">Name</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <input id="category" className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="music box, trophy, drinkware…" />
        </div>
        <button type="submit" className="btn btn-primary self-start" disabled={busy || !name || !supplierId}>
          {busy ? "Saving…" : "Save Product"}
        </button>
      </form>
    </main>
  );
}

export default function NewProductPage() {
  return (
    <Suspense fallback={<main className="p-10 text-ink-60">Loading…</main>}>
      <NewProductForm />
    </Suspense>
  );
}
