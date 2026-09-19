import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listProducts, deleteProduct } from "@/lib/firestore/products";
import { listRealSuppliers } from "@/lib/firestore/realSuppliers";
import { listRealCustomers } from "@/lib/firestore/realCustomers";
import { listApprovedConcepts, type ApprovedConcept } from "@/lib/pdConcepts";
import type { Product } from "@/types/product";
import { supplierDisplayName, type RealSupplier } from "@/types/supplier";
import { customerDisplayName, type RealCustomer } from "@/types/customer";

function ConceptCard({ item }: { item: ApprovedConcept }) {
  const { template, product, thumbUrl } = item;
  return (
    <div className="card overflow-hidden">
      <Link to={`/design/templates/${template.id}`} className="block hover:border-brand-300">
        <div className="aspect-square bg-ivory-dark flex items-center justify-center overflow-hidden">
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl} alt="" className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-2xs text-ink-60">No image</span>
          )}
        </div>
      </Link>
      <div className="p-2">
        <p className="text-xs font-medium truncate">{template.name}</p>
        <p className="text-2xs text-ink-60 truncate mb-1">{product?.name || "—"}</p>
        {thumbUrl && (
          // Same image-proxy trick as the generation Download link on
          // TemplateDetail.tsx — routed through our own origin so `download`
          // actually forces a save instead of navigating to the cross-origin
          // Storage URL (download is ignored cross-origin unless the
          // response opts in, which Storage doesn't).
          <a
            href={`/api/image-proxy?url=${encodeURIComponent(thumbUrl)}`}
            download={`${template.name}.jpg`}
            className="text-2xs text-brand-600 uppercase tracking-wide hover:underline"
          >
            Download
          </a>
        )}
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [suppliers, setSuppliers] = useState<RealSupplier[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [concepts, setConcepts] = useState<ApprovedConcept[] | undefined>(undefined);
  const [customers, setCustomers] = useState<Record<string, RealCustomer>>({});

  useEffect(() => {
    listProducts().then(setProducts);
    listRealSuppliers().then(setSuppliers);
    listApprovedConcepts().then(setConcepts);
    listRealCustomers().then((all) => setCustomers(Object.fromEntries(all.map((c) => [c.id, c]))));
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

  // Products grouped by supplier — a catalogue, not a flat list, so it
  // reads the way the factory relationships behind these mockups actually
  // work (Eddie, 2026-09-20: "see the product based on supplier catalog").
  const supplierMap = Object.fromEntries(suppliers.map((s) => [s.id, s]));
  const bySupplier = new Map<string, Product[]>();
  for (const p of products || []) {
    const key = p.supplierId || "__none__";
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(p);
  }
  const supplierGroups = Array.from(bySupplier.entries())
    .map(([supplierId, items]) => ({
      supplierId,
      label: supplierId === "__none__" ? "No supplier set" : supplierDisplayName(supplierMap[supplierId] || { id: supplierId }),
      items,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Approved concepts grouped by customer — the global overview across
  // everyone (Eddie: "the product design gallery that shows all the
  // approved designs of each customer"). Same data CustomerDetail.jsx's
  // own card shows, scoped to one customer — this is the bird's-eye
  // version, not a duplicate feature.
  const byCustomer = new Map<string, ApprovedConcept[]>();
  for (const c of concepts || []) {
    const cid = c.template.customerId;
    if (!byCustomer.has(cid)) byCustomer.set(cid, []);
    byCustomer.get(cid)!.push(c);
  }
  const conceptGroups = Array.from(byCustomer.entries())
    .map(([customerId, items]) => ({
      customerId,
      label: customers[customerId] ? customerDisplayName(customers[customerId]) : "Unknown customer",
      items,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl">Product Design</h1>
        {products && products.length > 0 && (
          <Link to="/design/products/new" className="btn btn-primary">New Product</Link>
        )}
      </div>

      {/* Product Design Gallery — every approved concept, across every
          customer. Deliberately separate from Products below: a concept is
          a not-yet-real product, this is its own overview, not folded into
          the supplier catalogue. */}
      <div className="mb-10">
        <h2 className="text-sm text-ink-80 mb-1">Product Design Gallery</h2>
        <p className="text-xs text-ink-60 mb-3">
          Every approved design concept, across every customer — an overview
          of what&rsquo;s been picked, not a catalogue of real products. A
          customer&rsquo;s own page shows just theirs.
        </p>
        {concepts === undefined ? (
          <p className="text-xs text-ink-60">Loading…</p>
        ) : conceptGroups.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-xs text-ink-60">No approved concepts yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {conceptGroups.map(({ customerId, label, items }) => (
              <div key={customerId}>
                <p className="text-xs font-medium text-ink-80 mb-2">{label}</p>
                <div className="grid grid-cols-4 gap-3">
                  {items.map((item) => <ConceptCard key={item.template.id} item={item} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 className="text-sm text-ink-80 mb-1">Products</h2>
      <p className="text-xs text-ink-60 mb-3">Grouped by supplier, like their real catalogue.</p>

      {products === null && <p className="text-ink-60">Loading…</p>}

      {products && products.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-ink-70 mb-4">No products yet.</p>
          <Link to="/design/products/new" className="btn btn-primary">Add your first product</Link>
        </div>
      )}

      {products && products.length > 0 && (
        <div className="flex flex-col gap-6">
          {supplierGroups.map(({ supplierId, label, items }) => (
            <div key={supplierId}>
              <p className="text-xs font-medium text-ink-80 mb-2">{label}</p>
              <div className="grid gap-3">
                {items.map((p) => (
                  <div key={p.id} className="card flex items-center gap-4 p-4 hover:border-brand-300">
                    <Link to={`/design/products/${p.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="h-14 w-14 bg-ivory-dark flex-shrink-0 flex items-center justify-center overflow-hidden">
                        {p.images?.[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.images[0].url} alt="" className="h-full w-full object-contain" />
                        ) : (
                          <span className="text-ink-60 text-2xs">no image</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
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
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
