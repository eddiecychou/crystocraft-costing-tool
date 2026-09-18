"use client";

import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import SpecSheetLayout from "@/components/SpecSheetLayout";
import type { Product } from "@/types/product";
import type { SpecSheetField } from "@/types/specSheetTemplate";

// Must match SpecSheetLayout's fixed A4-landscape-at-150dpi size.
const SHEET_W = 1754;
const SHEET_H = 1240;
// Smaller than portrait's 0.5 — a 1754px-wide sheet at 0.5 (877px) is wider
// than the editor's own right column; 0.4 (702px) fits max-w-6xl's grid.
const PREVIEW_SCALE = 0.4;

export interface SpecSheetFormValue {
  name: string;
  photoUrl?: string;
  tagline: string;
  fields: SpecSheetField[];
}

function defaultFieldsFor(product: Product): SpecSheetField[] {
  const fields: SpecSheetField[] = [];
  if (product.category) fields.push({ label: "Category", value: product.category });
  if (product.dimensions) {
    const d = product.dimensions;
    fields.push({ label: "Dimensions", value: `${d.w} × ${d.h} × ${d.d} ${d.unit}` });
  }
  fields.push({ label: "Materials", value: "" });
  fields.push({ label: "SKU", value: "" });
  fields.push({ label: "MOQ", value: "" });
  fields.push({ label: "Price", value: "" });
  return fields;
}

export function defaultSpecSheetValue(product: Product): SpecSheetFormValue {
  return {
    name: `${product.name} — Spec Sheet`,
    photoUrl: product.images.find((i) => i.isBaseReference)?.url || product.images[0]?.url,
    tagline: "",
    fields: defaultFieldsFor(product),
  };
}

export default function SpecSheetEditorForm({
  product,
  value,
  onChange,
  onSave,
  saving,
}: {
  product: Product;
  value: SpecSheetFormValue;
  onChange: (v: SpecSheetFormValue) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  function updateField(idx: number, patch: Partial<SpecSheetField>) {
    const fields = value.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onChange({ ...value, fields });
  }

  function addField() {
    onChange({ ...value, fields: [...value.fields, { label: "", value: "" }] });
  }

  function removeField(idx: number) {
    onChange({ ...value, fields: value.fields.filter((_, i) => i !== idx) });
  }

  async function downloadPng() {
    if (!sheetRef.current) return;
    setExporting(true);
    setExportError("");
    try {
      const dataUrl = await toPng(sheetRef.current, { pixelRatio: 2 });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${value.name || "spec-sheet"}.png`;
      a.click();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "PNG export failed");
    } finally {
      setExporting(false);
    }
  }

  function printPdf() {
    window.print();
  }

  return (
    <div className="grid grid-cols-[380px_1fr] gap-6 items-start">
      <div className="card p-4 flex flex-col gap-4 print:hidden">
        <div>
          <label className="label">Sheet Name</label>
          <input
            className="input"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Photo</label>
          <select
            className="input"
            value={value.photoUrl || ""}
            onChange={(e) => onChange({ ...value, photoUrl: e.target.value || undefined })}
          >
            <option value="">None</option>
            {product.images.map((img, i) => (
              <option key={img.id} value={img.url}>
                {img.caption || `Photo ${i + 1}`}
                {img.isBaseReference ? " (base)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Tagline</label>
          <input
            className="input"
            value={value.tagline}
            onChange={(e) => onChange({ ...value, tagline: e.target.value })}
            placeholder="Optional marketing line"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Fields</label>
            <button type="button" className="btn btn-secondary" onClick={addField}>
              + Field
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {value.fields.map((f, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                {/* .input sets width:100% — wrap each in a sized container
                    rather than putting flex-basis classes on the input
                    itself, or the two inputs fight over the row's width. */}
                <div className="w-24 shrink-0">
                  <input
                    className="input text-xs py-1"
                    placeholder="Label"
                    value={f.label}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    className="input text-xs py-1"
                    placeholder="Value"
                    value={f.value}
                    onChange={(e) => updateField(idx, { value: e.target.value })}
                  />
                </div>
                <button type="button" className="text-xs text-red-700 shrink-0" onClick={() => removeField(idx)}>
                  🗑
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-line">
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={downloadPng} disabled={exporting}>
            {exporting ? "Exporting…" : "Download PNG"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={printPdf}>
            Print / Save as PDF
          </button>
          {exportError && <p className="text-xs text-red-700">{exportError}</p>}
        </div>
      </div>

      {/* CSS transform:scale shrinks the paint but NOT the layout box, so
          scaling the exported/printed node directly left it reserving its
          full 1240x1754 footprint and getting clipped by the surrounding
          grid column. Fix: the scale lives on an inner wrapper, and an outer
          wrapper is sized to the ALREADY-SCALED dimensions with
          overflow:hidden, so layout and paint agree. The unscaled node
          (#spec-sheet-print-target) is what html-to-image/print actually
          capture, so PNG export and printing stay full resolution
          regardless of on-screen preview size. */}
      <div className="overflow-auto">
        <div
          className="spec-sheet-outer border border-line rounded"
          style={{ width: SHEET_W * PREVIEW_SCALE, height: SHEET_H * PREVIEW_SCALE, overflow: "hidden" }}
        >
          <div
            className="spec-sheet-scale-wrapper"
            style={{ width: SHEET_W, height: SHEET_H, transform: `scale(${PREVIEW_SCALE})`, transformOrigin: "top left" }}
          >
            <div id="spec-sheet-print-target" ref={sheetRef}>
              <SpecSheetLayout
                productName={product.name}
                tagline={value.tagline || undefined}
                photoUrl={value.photoUrl}
                fields={value.fields.filter((f) => f.label.trim())}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
