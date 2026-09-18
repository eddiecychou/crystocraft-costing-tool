// Pure presentational layout for a product spec sheet — deterministic HTML/CSS,
// not AI-generated. Sized to A4 LANDSCAPE at 150dpi (1754x1240px) so the PNG
// export and the print stylesheet agree on the same page. Portrait with a
// stacked photo-over-table left the table sitting in a fixed-height block
// with a large dead gap below it and 18px spec text that read too small
// against a big product photo (Eddie, 2026-09-19) — landscape with the photo
// full-bleed on the left and the specs stretched to fill the right column
// fixes both at once.
export interface SpecSheetLayoutProps {
  productName: string;
  tagline?: string;
  photoUrl?: string;
  fields: { label: string; value: string }[];
}

// Route Firebase Storage photos through the app's own image-proxy edge
// function (same pattern as BlogGenerator.jsx/ManualAdjust.jsx) rather than
// the raw Storage URL. A plain <img> displays a cross-origin Storage image
// fine either way, but html-to-image's PNG export (downloadPng in
// SpecSheetEditorForm) fetches the src itself to inline it as base64, and
// Storage sends no Access-Control-Allow-Origin header — that fetch was
// failing with "PNG export failed" until routed through the proxy, which
// does send one.
function displayUrl(url?: string): string | undefined {
  if (!url) return url;
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

export default function SpecSheetLayout({ productName, tagline, photoUrl, fields }: SpecSheetLayoutProps) {
  return (
    <div className="bg-white text-ink flex" style={{ width: 1754, height: 1240, fontFamily: "var(--font-sans, sans-serif)" }}>
      {/* Photo plate — full sheet height, the product is the hero. */}
      <div
        className="flex items-center justify-center shrink-0 bg-ivory-mid"
        style={{ width: 1016, height: 1240, padding: 56 }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayUrl(photoUrl)} alt="" className="max-w-full max-h-full object-contain" />
        ) : (
          <p className="text-ink-40">No photo selected</p>
        )}
      </div>

      {/* Spec column — stretches to fill the remaining height so rows never
          leave dead space at the bottom, however many fields there are. */}
      <div className="flex flex-col flex-1 min-w-0" style={{ padding: "72px 64px 48px" }}>
        <p className="eyebrow text-brand-600">Specification</p>
        <h1
          className="uppercase font-semibold leading-none mt-2"
          style={{ fontSize: 46, letterSpacing: "0.015em", lineHeight: 1.08, textWrap: "balance" as const }}
        >
          {productName}
        </h1>
        {tagline && <p className="text-ink-60 mt-3" style={{ fontSize: 22 }}>{tagline}</p>}

        <div className="facet-divider" style={{ marginTop: 32, marginBottom: 8 }}>
          <span className="facet-divider-glyph" />
        </div>

        <div className="flex flex-col flex-1">
          {fields.map((f, i) => (
            <div key={i} className="flex items-baseline border-t border-line flex-1" style={{ minHeight: 0 }}>
              <span
                className="shrink-0 text-ink-60 font-medium uppercase font-label"
                style={{ width: 200, fontSize: 16, letterSpacing: "0.08em" }}
              >
                {f.label}
              </span>
              <span className="whitespace-pre-wrap" style={{ fontSize: 28 }}>{f.value}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end pt-6 mt-6 border-t border-line">
          <span
            className="text-ink-60 uppercase font-label"
            style={{ fontSize: 13, letterSpacing: "0.16em" }}
          >
            Crystocraft
          </span>
        </div>
      </div>
    </div>
  );
}
