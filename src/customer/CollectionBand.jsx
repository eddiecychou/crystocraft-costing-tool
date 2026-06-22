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
          return (
            <button key={c.id} onClick={() => onApply(c)}
                    className={`group rounded-xl overflow-hidden border text-left transition-shadow hover:shadow-md ${on ? 'border-ink' : 'border-ivory-dark'}`}>
              <div className="aspect-square flex items-center justify-center overflow-hidden relative"
                   style={{ background: custom ? undefined : ac.tile }}>
                {custom
                  ? <img src={c.custom_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  : image
                    ? <img src={image} alt="" className="w-[78%] h-[78%] object-contain" loading="lazy" />
                    : <span className="text-2xl font-medium" style={{ color: ac.ink }}>{(c.title || '?').slice(0, 1)}</span>}
              </div>
              <div className="px-2.5 py-2" style={{ background: custom ? undefined : ac.tile }}>
                <p className="text-xs font-medium truncate" style={{ color: custom ? undefined : ac.ink }}>{c.title}</p>
                {c.subtitle && <p className="text-[10px] truncate opacity-70" style={{ color: custom ? undefined : ac.ink }}>{c.subtitle}</p>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
