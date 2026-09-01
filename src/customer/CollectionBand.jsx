import { useMemo } from 'react'
import { useCollections, useBandSettings, visibleCollections, collectionProducts, accentOf } from '../catalogueCollections'

// Customer-facing "Shop by…" band. Augments the grid — never gates it (spec §1).
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
    }).filter(t => t.count > 0)
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
            const tcol = c.title_color === 'black' ? '#1a1a1a' : '#ffffff'
            const rgb = c.overlay_color === 'white' ? '255,255,255' : '0,0,0'
            const op = c.overlay_color === 'none' ? 0 : (c.overlay_opacity ?? 0.55)
            const shadow = c.title_color === 'black' ? 'none' : '0 1px 3px rgba(0,0,0,0.55)'
            return (
              <button key={c.id} onClick={() => onApply(c)}
                      className={`group relative aspect-square rounded-none overflow-hidden text-left transition-shadow hover:shadow-lg ${on ? 'ring-2 ring-inset ring-ink' : ''}`}>
                <img src={c.custom_url} alt="" loading="lazy"
                     className="block w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                <div className="absolute inset-x-0 bottom-0 px-2.5 py-2"
                     style={{ background: `linear-gradient(to top, rgba(${rgb},${op}), rgba(${rgb},0))` }}>
                  <p className="text-xs font-medium truncate" style={{ color: tcol, textShadow: shadow }}>{c.title}</p>
                  {c.subtitle && <p className="text-[10px] truncate" style={{ color: tcol, opacity: 0.85, textShadow: shadow }}>{c.subtitle}</p>}
                </div>
              </button>
            )
          }

          // Templated tile: accent background, product image centred, label overlay at bottom
          return (
            <button key={c.id} onClick={() => onApply(c)}
                    className={`group relative aspect-square rounded-none overflow-hidden text-left transition-shadow hover:shadow-md ${on ? 'ring-2 ring-inset ring-ink' : ''}`}
                    style={{ background: ac.tile }}>
              <div className="w-full h-full flex items-center justify-center pb-7">
                {image
                  ? <img src={image} alt="" className="w-[72%] h-[72%] object-contain" loading="lazy" />
                  : <span className="text-2xl font-medium" style={{ color: ac.ink }}>{(c.title || '?').slice(0, 1)}</span>}
              </div>
              <div className="absolute inset-x-0 bottom-0 px-2.5 py-2" style={{ background: ac.tile }}>
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
