"use client";

import { useEffect, useState } from "react";
import { getCustomerBrand } from "@/lib/firestore/customerBrands";
import type { CustomerBrand } from "@/types/customerBrand";

// Collapsed-by-default panel so it's there to glance at while editing a
// template's JSON, without competing for space with the JSON itself.
export default function BrandQuickView({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState<CustomerBrand | null | "loading">("loading");

  useEffect(() => {
    if (!open || brand !== "loading") return;
    getCustomerBrand(customerId).then(setBrand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="border border-line rounded">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-2xs uppercase tracking-wide text-ink-60 hover:bg-ivory-mid"
        onClick={() => setOpen((v) => !v)}
      >
        <span>Brand Elements</span>
        <span>{open ? "▲ Hide" : "▼ Show"}</span>
      </button>
      {open && (
        <div className="p-3 border-t border-line bg-ivory-mid text-xs flex flex-col gap-2 max-h-64 overflow-y-auto">
          {brand === "loading" ? (
            <p className="text-ink-40">Loading…</p>
          ) : brand === null ? (
            <p className="text-ink-40">No brand profile saved for this customer yet.</p>
          ) : (
            <>
              {brand.brandJson.summary && (
                <p><span className="font-semibold">Summary — </span>{brand.brandJson.summary}</p>
              )}
              {brand.brandJson.tone && (
                <p><span className="font-semibold">Tone — </span>{brand.brandJson.tone}</p>
              )}
              {brand.brandJson.color_palette?.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold">Palette — </span>
                  {brand.brandJson.color_palette.map((c, i) => (
                    <span key={i} className="inline-flex items-center gap-1 font-mono">
                      <span className="inline-block w-3 h-3 rounded-full border border-line" style={{ background: c }} />
                      {c}
                    </span>
                  ))}
                </div>
              )}
              {brand.brandJson.core_motifs?.length > 0 && (
                <p><span className="font-semibold">Motifs — </span>{brand.brandJson.core_motifs.join(", ")}</p>
              )}
              {brand.brandJson.negative_space_rule && (
                <p><span className="font-semibold">Negative space — </span>{brand.brandJson.negative_space_rule}</p>
              )}
              {brand.brandJson.logo_description && (
                <p><span className="font-semibold">Logo — </span>{brand.brandJson.logo_description}</p>
              )}
              {brand.brandJson.notes && (
                <p><span className="font-semibold">Notes — </span>{brand.brandJson.notes}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
