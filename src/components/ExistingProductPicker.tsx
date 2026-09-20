import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Search } from "lucide-react";

export interface ExistingProductOption {
  id: string;
  type: "range" | "corp_gift";
  name: string;
  cat: string;
  image: string;
}

// One-step "pick a product from either catalogue" search modal — same
// dual-collection load + display-name fallback chain as
// FrontPageProductPicker.jsx (the precedent for merging range_products and
// products into one search list), but without that component's second
// "then pick one of its photos" step, since here we're pushing a single
// image IN rather than pulling one out.
export default function ExistingProductPicker({
  onSelect,
  onClose,
  busyId,
  error,
}: {
  onSelect: (product: ExistingProductOption) => void;
  onClose: () => void;
  busyId?: string | null;
  error?: string;
}) {
  const [products, setProducts] = useState<ExistingProductOption[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([getDocs(collection(db, "range_products")), getDocs(collection(db, "products"))]).then(
      ([rangeSnap, corpSnap]) => {
        const range: ExistingProductOption[] = rangeSnap.docs.map((d) => {
          const p = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            type: "range",
            name: (p.design_name as string) || (p.description as string) || (p.design_code as string) || d.id,
            cat: (p.design_type as string) || (p.category as string) || "",
            image: (Array.isArray(p.gallery) && (p.gallery[0] as { url?: string })?.url) || "",
          };
        });
        const corp: ExistingProductOption[] = corpSnap.docs.map((d) => {
          const p = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            type: "corp_gift",
            name: (p.name as string) || d.id,
            cat: (p.category as string) || "",
            image: (p.heroImage as string) || "",
          };
        });
        setProducts([...range, ...corp]);
      },
    );
  }, []);

  const filtered = (products || []).filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.cat.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-none shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-warm-grey">
          <h2 className="text-ink text-sm">Add this image to an existing product</h2>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70 text-xl leading-none">
            ×
          </button>
        </div>

        <div className="px-4 pt-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-platinum" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search figurine or corporate gift products…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-warm-grey rounded-none focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              autoFocus
            />
          </div>
        </div>

        {error && <p className="px-4 pt-2 text-xs text-red-700">{error}</p>}

        <div className="overflow-y-auto flex-1 p-4">
          {products === null ? (
            <p className="text-sm text-ink-60 text-center py-8">Loading products…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-ink-60 text-center py-6">No matching products.</p>
          ) : (
            <div className="space-y-1">
              {filtered.map((p) => (
                <button
                  key={`${p.type}-${p.id}`}
                  type="button"
                  disabled={!!busyId}
                  onClick={() => onSelect(p)}
                  className="w-full flex items-center gap-3 p-2 rounded-none hover:bg-ivory text-left disabled:opacity-50 disabled:cursor-wait"
                >
                  <div className="w-10 h-10 rounded-none bg-ivory-dark shrink-0 overflow-hidden">
                    {p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink truncate">{p.name}</p>
                    <p className="text-xs text-ink-60 truncate">{p.cat}</p>
                  </div>
                  {busyId === p.id ? (
                    <span className="text-2xs text-ink-60 uppercase tracking-wide shrink-0">Adding…</span>
                  ) : (
                    <span
                      className={`text-2xs px-1.5 py-0.5 rounded-none uppercase tracking-wide shrink-0 ${
                        p.type === "range" ? "bg-brand-50 text-brand-700" : "bg-sapphire/10 text-sapphire"
                      }`}
                    >
                      {p.type === "range" ? "Figurine" : "Corporate"}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
