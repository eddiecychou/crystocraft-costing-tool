// Pure presentational layout for a product spec sheet — deterministic HTML/CSS,
// not AI-generated. Sized to A4 portrait at 150dpi (1240x1754px) so the PNG
// export and the print stylesheet agree on the same page.
export interface SpecSheetLayoutProps {
  productName: string;
  tagline?: string;
  photoUrl?: string;
  fields: { label: string; value: string }[];
}

export default function SpecSheetLayout({ productName, tagline, photoUrl, fields }: SpecSheetLayoutProps) {
  return (
    <div
      className="bg-white text-ink flex flex-col"
      style={{ width: 1240, height: 1754, padding: 64, fontFamily: "var(--font-sans, sans-serif)" }}
    >
      <div className="mb-8">
        <h1 className="text-4xl font-semibold leading-tight">{productName}</h1>
        {tagline && <p className="text-lg text-ink-60 mt-1">{tagline}</p>}
      </div>

      <div className="flex-1 flex items-center justify-center bg-ivory-mid rounded-lg overflow-hidden mb-8" style={{ minHeight: 700 }}>
        {photoUrl ? (
          // Deliberately no crossOrigin here — Firebase Storage download
          // URLs don't send CORS headers, and setting crossOrigin on a plain
          // <img> makes the browser refuse to display it at all rather than
          // just affecting canvas readback. html-to-image fetches the image
          // itself for PNG export and handles that separately.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="max-w-full max-h-full object-contain" />
        ) : (
          <p className="text-ink-40">No photo selected</p>
        )}
      </div>

      <table className="w-full text-lg border-collapse">
        <tbody>
          {fields.map((f, i) => (
            <tr key={i} className="border-t border-line">
              <td className="py-3 pr-6 text-ink-60 font-medium align-top" style={{ width: 260 }}>
                {f.label}
              </td>
              <td className="py-3 align-top whitespace-pre-wrap">{f.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
