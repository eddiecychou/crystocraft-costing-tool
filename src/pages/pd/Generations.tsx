import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { listProducts } from "@/lib/firestore/products";
import { listRealCustomers } from "@/lib/firestore/realCustomers";
import { customerDisplayName, type RealCustomer } from "@/types/customer";
import type { Product } from "@/types/product";
import type { Generation } from "@/types/generation";

const STATUS_BADGE: Record<Generation["status"], string> = {
  success: "badge-sampled",
  failed: "badge-retired",
  approved: "badge-active",
  rejected: "badge-retired",
};

export default function GenerationsPage() {
  const [generations, setGenerations] = useState<Generation[] | null>(null);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [customers, setCustomers] = useState<Record<string, RealCustomer>>({});

  useEffect(() => {
    getDocs(collection(db, "pd_generations")).then((snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Generation);
      all.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setGenerations(all);
    });
    listProducts().then((all) => setProducts(Object.fromEntries(all.map((p) => [p.id, p]))));
    listRealCustomers().then((all) => setCustomers(Object.fromEntries(all.map((c) => [c.id, c]))));
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl mb-1">Generations</h1>
      <p className="text-xs text-ink-60 mb-6">
        Every rendered result, across every template — uploaded from a
        template&rsquo;s own page after generating in the Gemini app.
      </p>

      {generations === null && <p className="text-ink-60">Loading…</p>}

      {generations && generations.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-ink-70 mb-4">No generations yet.</p>
          <Link to="/design/templates" className="btn btn-primary">Go to Templates</Link>
        </div>
      )}

      {generations && generations.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {generations.map((g) => (
            <Link key={g.id} to={`/design/templates/${g.templateId}`} className="card overflow-hidden hover:border-brand-300">
              <div className="aspect-square bg-ivory-dark flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.resultImageUrl} alt="" className="max-w-full max-h-full object-contain" />
              </div>
              <div className="p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className={`badge ${STATUS_BADGE[g.status]}`}>{g.status}</span>
                  {g.rating && <span className="text-2xs text-ink-60">{g.rating}/5</span>}
                </div>
                <p className="text-xs text-ink-60 truncate">
                  {products[g.productId]?.name || "—"}
                  {customers[g.customerId] && ` · ${customerDisplayName(customers[g.customerId])}`}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
