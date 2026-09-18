import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { listProducts } from "@/lib/firestore/products";
import { listRealCustomers } from "@/lib/firestore/realCustomers";
import { customerDisplayName, type RealCustomer } from "@/types/customer";
import type { Product } from "@/types/product";
import type { PromptTemplate } from "@/types/promptTemplate";

const STATUS_BADGE: Record<PromptTemplate["status"], string> = {
  draft: "badge-sampled",
  approved: "badge-active",
  archived: "badge-retired",
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<PromptTemplate[] | null>(null);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [customers, setCustomers] = useState<Record<string, RealCustomer>>({});

  useEffect(() => {
    getDocs(collection(db, "pd_prompt_templates")).then((snap) => {
      setTemplates(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PromptTemplate));
    });
    listProducts().then((all) => setProducts(Object.fromEntries(all.map((p) => [p.id, p]))));
    listRealCustomers().then((all) => setCustomers(Object.fromEntries(all.map((c) => [c.id, c]))));
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl mb-1">Prompt Templates</h1>
      <p className="text-xs text-ink-60 mb-6">
        Created from a product&rsquo;s own page — pick a product with at
        least one reference photo, then &ldquo;New Template.&rdquo;
      </p>

      {templates === null && <p className="text-ink-60">Loading…</p>}

      {templates && templates.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-ink-70 mb-4">No templates yet.</p>
          <Link to="/design/products" className="btn btn-primary">Go to Products</Link>
        </div>
      )}

      {templates && templates.length > 0 && (
        <div className="grid gap-3">
          {templates.map((t) => (
            <Link key={t.id} to={`/design/templates/${t.id}`} className="card flex items-center justify-between p-4 hover:border-brand-300">
              <div>
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-ink-60">
                  {products[t.productId]?.name || "—"}
                  {customers[t.customerId] && ` · ${customerDisplayName(customers[t.customerId])}`}
                </p>
              </div>
              <span className={`badge ${STATUS_BADGE[t.status]}`}>{t.status}</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
