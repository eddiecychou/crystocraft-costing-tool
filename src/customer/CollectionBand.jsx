import { useMemo } from 'react'
import { useCollections, useBandSettings, visibleCollections, collectionProducts, accentOf } from '../catalogueCollections'

// Customer-facing "Shop by…" band. Augments the grid — never gates it (spec §1).
// `products` is the shop's already-loaded list; each item must carry id, the
// catalogue's filter field (design_type / category), is_new, image, name.
// `onApply(collection)` lets the parent shop filter its grid to the tile.
export default function CollectionBand({ catalogue, products, active, onApply }) {
  const rows = useCollections(catalogue)
  const band = useBandSettings()
  const cfg = band[catalogue]

  const tiles = useMemo(() => {
    if (!rows || cfg?.show_section === false) return []
    return visibleCollections(rows, cfg).map(c => {
      const matched = collectionProducts(c, products, catalogue)
      const rep = matched.find(p => p.image)?.image || ''
      return { c, count: matched.length, image: rep }
    }).filter(t => t.count > 0)   // hide tiles that resolve to nothing (guardrail 10)
  }, [rows, cfg, products, catalogue])

  if (!tiles.length) return null
  const cols = Math.max(3, Math.min(5, cfg?.columns || 4))

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-ink-80 mb-3">Shop by</h2>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {tiles.map(({ c, image }) => {
          const ac = accentOf(c.accent)
          const on = active?.id === c.id
          const custom = c.image_mode === 'custom' && c.custom_url
          if (custom) {
            // Full-bleed image (fills the tile, no letterbox) with the label
            // overlaid on a configurable scrim.
            const tcol = c.title_color === 'black' ? '#1a1a1a' : '#ffffff'
            const rgb = c.overlay_color === 'white' ? '255,255,255' : '0,0,0'
            const op = c.overlay_color === 'none' ? 0 : (c.overlay_opacity ?? 0.55)
            const shadow = c.title_color === 'black' ? 'none' : '0 1px 3px rgba(0,0,0,0.55)'
            return (
              <button key={c.id} onClick={() => onApply(c)}
                      className={`group relative rounded-xl overflow-hidden text-left transition-shadow hover:shadow-lg ${on ? 'ring-2 ring-inset ring-ink' : ''}`}>
                <div className="aspect-square overflow-hidden">
                  <img src={c.custom_url} alt="" loading="lazy"
                       className="block w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                </div>
                <div className="absolute inset-x-0 bottom-0 px-2.5 py-2"
                     style={{ background: `linear-gradient(to top, rgba(${rgb},${op}), rgba(${rgb},0))` }}>
                  <p className="text-xs font-medium truncate" style={{ color: tcol, textShadow: shadow }}>{c.title}</p>
                  {c.subtitle && <p className="text-[10px] truncate" style={{ color: tcol, opacity: 0.85, textShadow: shadow }}>{c.subtitle}</p>}
                </div>
              </button>
            )
          }
          return (
            <button key={c.id} onClick={() => onApply(c)}
                    className={`group rounded-xl overflow-hidden border text-left transition-shadow hover:shadow-md ${on ? 'border-ink' : 'border-ivory-dark'}`}>
              <div className="aspect-square flex items-center justify-center overflow-hidden relative" style={{ background: ac.tile }}>
                {image
                  ? <img src={image} alt="" className="w-[78%] h-[78%] object-contain" loading="lazy" />
                  : <span className="text-2xl font-medium" style={{ color: ac.ink }}>{(c.title || '?').slice(0, 1)}</span>}
              </div>
              <div className="px-2.5 py-2" style={{ background: ac.tile }}>
                <p className="text-xs font-medium truncate" style={{ color: ac.ink }}>{c.title}</p>
                {c.subtitle && <p className="text-[10px] truncate opacity-70" style={{ color: ac.ink }}>{c.subtitle}</p>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
