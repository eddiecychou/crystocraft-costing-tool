import { CheckCircle2, Image as ImageIcon, Trash2 } from 'lucide-react'
import { LINE_TYPES, lineTypeOf } from '../../shipping'

export default function ShipmentLineRow({ line: l, index: i, setLine, classify, onPickImage, removeLine }) {
  const t = l.line_type ? lineTypeOf(l.line_type) : null
  return (
    <div className={`rounded-none border p-3 ${l.line_type ? 'border-warm-grey' : 'border-amber-200 bg-amber-50/40'}`}>
      <div className="grid grid-cols-[auto_auto_1fr_auto] gap-3 items-start">
        <div className="text-xs text-ink-60 pt-2 w-6">{l.line_no ?? i + 1}</div>
        {/* Line image — Corp Gift, Ad-hoc, and Figurine (range).
            Figurine lines were excluded outright until V8.8
            Phase 2 (owner, 2026-08-01): a range product's
            gallery shot won't reflect the specific plating ×
            crystal-colour combination ordered, so offering one
            would put a subtly wrong picture on an invoice.
            LineImagePicker now sources figurine lines from
            variant.colour_images, a "usable" tier that's
            reviewed per colour before it's ever offered here —
            see docs/specs/Range_Colour_Preview_Spec.md §P2.0/§P2.3a.
            Charge lines still have nothing to show. */}
        {(l.line_type === 'corp_gift' || l.line_type === 'ad_hoc' || l.line_type === 'range') ? (
          <button type="button" onClick={() => onPickImage(i)}
            title={l.line_image ? 'Change this line’s invoice image' : 'Add an image for the Proforma / Invoice'}
            className="group relative w-14 h-14 rounded-none bg-ivory-dark border border-warm-grey overflow-hidden flex items-center justify-center shrink-0">
            {l.line_image
              ? <img src={l.line_image} alt="" className="w-full h-full object-cover" />
              : <ImageIcon size={16} strokeWidth={1.5} className="text-platinum" />}
            <span className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
              <span className="bg-white/90 text-2xs px-1 py-0.5 rounded-none text-ink-80">
                {l.line_image ? 'change' : 'add'}
              </span>
            </span>
          </button>
        ) : <div className="w-0" />}
        <div className="min-w-0 space-y-2">
          <div className="grid grid-cols-[100px_1fr] sm:grid-cols-[140px_1fr] gap-2">
            <input className="input py-1.5 text-sm font-mono" value={l.item_code} onChange={e => setLine(i, { item_code: e.target.value })} placeholder="Item code" />
            {/* A textarea, not an input: one-off "MISC" lines
                routinely carry multi-line descriptions in JES —
                "SOCKS\nMaterial: Cotton + Polyester\nSize: 25-27".
                A single-line input made those impossible to enter
                at all. Drag to expand; newlines are preserved and
                printed. */}
            <textarea className="input py-1.5 text-sm resize-y leading-snug" rows={1} style={{ minHeight: '2.15rem' }}
                      value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="Description" />
          </div>
          <textarea className="input py-1.5 text-sm resize-y leading-snug" rows={1}
            aria-label={`Tier remarks for line ${i + 1}`} placeholder="Tier remarks (customer-facing)"
            value={l.tier_remarks || ''} onChange={e => setLine(i, { tier_remarks: e.target.value })} />
          <div className="flex gap-2 items-center flex-wrap">
            <input className="input py-1.5 text-sm w-20 sm:w-24" type="number" value={l.qty_ordered ?? ''} onChange={e => setLine(i, { qty_ordered: e.target.value })} placeholder="Qty" />
            <input className="input py-1.5 text-sm w-16 sm:w-20" value={l.unit ?? ''} onChange={e => setLine(i, { unit: e.target.value })} placeholder="pcs" />
            <input className="input py-1.5 text-sm w-24 sm:w-28" type="number" step="0.01" value={l.unit_price ?? ''} onChange={e => setLine(i, { unit_price: e.target.value })} placeholder="Unit price" />
            {l.matched_product_ref && (
              <span className="inline-flex items-center gap-1 text-xs text-green-700 truncate max-w-full"
                title={l.matched_product_ref.name ? undefined : 'This product has no Description set in Crystocraft Range'}>
                <CheckCircle2 size={13} /> {l.matched_product_ref.name || 'matched (no name set)'}
              </span>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {LINE_TYPES.map(lt => (
              <button key={lt.value} type="button" onClick={() => classify(i, lt.value)}
                className={`px-2.5 py-1 rounded-full text-2xs font-medium border transition-colors ${
 l.line_type === lt.value ? lt.style + ' border-current' : 'bg-white text-ink-60 border-warm-grey hover:border-ink-60'
                }`}>
                {lt.label}
              </button>
            ))}
            {t && !t.packable && <span className="text-2xs text-ink-60 self-center ml-1">excluded from packing</span>}
          </div>
        </div>
        <button type="button" onClick={() => removeLine(i)} className="text-platinum hover:text-red-500 pt-2"><Trash2 size={15} /></button>
      </div>
    </div>
  )
}
