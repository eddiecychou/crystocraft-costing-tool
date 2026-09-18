import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listProducts, deleteProduct } from "@/lib/firestore/products";
import { listRealSuppliers } from "@/lib/firestore/realSuppliers";
import type { Product } from "@/types/product";
import { supplierDisplayName, type RealSupplier } from "@/types/supplier";

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [suppliers, setSuppliers] = useState<Record<string, RealSupplier>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    listProducts().then(setProducts);
    listRealSuppliers().then((all) => {
      setSuppliers(Object.fromEntries(all.map((s) => [s.id, s])));
    });
  }, []);

  async function handleDelete(p: Product) {
    const ok = window.confirm(
      `Delete "${p.name}"? This removes it and all ${p.images.length} uploaded photo(s) permanently — it cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId(p.id);
    await deleteProduct(p.id);
    setProducts((prev) => (prev ? prev.filter((x) => x.id !== p.id) : prev));
    setDeletingId(null);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl">Products</h1>
        {products && products.length > 0 && (
          <Link to="/design/products/new" className="btn btn-primary">New Product</Link>
        )}
      </div>

      {products === null && <p className="text-ink-60">Loading…</p>}

      {products && products.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-ink-70 mb-4">No products yet.</p>
          <Link to="/design/products/new" className="btn btn-primary">Add your first product</Link>
        </div>
      )}

      {products && products.length > 0 && (
        <div className="grid gap-3">
          {products.map((p) => (
            <div key={p.id} className="card flex items-center gap-4 p-4 hover:border-brand-300">
              <Link to={`/design/products/${p.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                <div className="h-14 w-14 bg-ivory-dark flex-shrink-0 flex items-center justify-center overflow-hidden">
                  {p.images?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0].url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-ink-60 text-2xs">no image</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-ink-60">
                    {suppliers[p.supplierId] ? supplierDisplayName(suppliers[p.supplierId]) : "—"}
                  </p>
                </div>
              </Link>
              <div className="flex gap-2 flex-shrink-0">
                <Link to={`/design/products/${p.id}/edit`} className="btn btn-secondary">Edit</Link>
                <button
                  type="button"
                  className="btn btn-secondary text-red-700"
                  disabled={deletingId === p.id}
                  onClick={() => handleDelete(p)}
                >
                  {deletingId === p.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
