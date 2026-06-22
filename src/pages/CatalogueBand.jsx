import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import {
  useCollections, useBandSettings, saveCollection, deleteCollection,
  reorderCollections, saveBandSettings, FILTER_FIELD, ACCENTS, accentOf, SMART_RULES,
} from '../catalogueCollections'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import { ChevronUp, ChevronDown, Pencil, Trash2, Plus, X } from 'lucide-react'

const CATALOGUES = [{ key: 'range', label: 'Figurine Gifts' }, { key: 'corp_gift', label: 'Corporate Gifts' }]
const blank = cat => ({ catalogue: cat, title: '', subtitle: '', type: 'filter', filter_value: '', product_ids: [], smart_rule: 'new_in', accent: 'teal', image_mode: 'template', custom_url: '', title_color: 'white', overlay_color: 'black', overlay_opacity: 0.55, active: true })

export default function CatalogueBand() {
  const [catalogue, setCatalogue] = useState('range')
  const rows = useCollections(catalogue)
  const band = useBandSettings()
  const [products, setProducts] = useState([])
  const [editing, setEditing] = useState(null)     // collection object or null
  const [confirmDel, setConfirmDel] = useState(null)

  // Load the catalogue's products (for the filter dropdown + manual picker).
  useEffect(() => {
    const path = catalogue === 'corp_gift' ? 'products' : 'range_products'
    getDocs(collection(db, path)).then(snap => {
      setProducts(snap.docs.map(d => {
        const p = { id: d.id, ...d.data() }
        const name = catalogue === 'corp_gift'
          ? (p.name || p.id)
          : (p.design_name || p.description || p.design_code || p.id)
        const cat = catalogue === 'corp_gift' ? (p.category || '') : (p.design_type || p.category || '')
        const image = catalogue === 'corp_gift' ? (p.heroImage || '') : (p.gallery?.[0]?.url || p.gallery?.[0] || '')
        return { id: p.id, name, cat, image }
      }))
    })
  }, [catalogue])

  const filterValues = useMemo(
    () => [...new Set(products.map(p => p.cat).filter(Boolean))].sort(),
    [products])

  const cfg = band[catalogue]
  const setCfg = patch => saveBandSettings(catalogue, { ...cfg, ...patch })

  async function move(i, dir) {
    const next = [...rows]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    await reorderCollections(catalogue, next)
  }

  if (rows === null) return <LoadingBar />

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <h1 className="text-xl md:text-2xl mb-1">Catalogue Band</h1>
      <p className="text-sm text-ink-60 mb-4">Curated “Shop by…” tiles shown at the top of the customer catalogue. Admin only.</p>

      {/* Catalogue switch */}
      <div className="inline-flex rounded-lg border border-ivory-dark overflow-hidden mb-5">
        {CATALOGUES.map(c => (
          <button key={c.key} onClick={() => setCatalogue(c.key)}
                  className={`px-3 py-1.5 text-sm border-l first:border-l-0 border-ivory-dark transition-colors ${catalogue === c.key ? 'bg-ink text-white' : 'bg-white text-ink-70 hover:bg-ivory'}`}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Band settings */}
      <div className="card p-4 mb-5 flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={cfg.show_section !== false}
                 onChange={e => setCfg({ show_section: e.target.checked })} />
          Show band on this catalogue
        </label>
        <div>
          <label className="label">Columns</label>
          <select className="input py-1.5 text-sm w-24" value={cfg.columns} onChange={e => setCfg({ columns: Number(e.target.value) })}>
            {[3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Max tiles</label>
          <select className="input py-1.5 text-sm w-24" value={cfg.max_tiles} onChange={e => setCfg({ max_tiles: Number(e.target.value) })}>
            {[3, 4, 5, 6, 8].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <p className="text-xs text-ink-50 basis-full">Tiles fill whole rows — fewer than one full row of active tiles hides the band.</p>
      </div>

      {/* Collections list */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-ink-80">Collections ({rows.length})</h2>
        <button onClick={() => setEditing(blank(catalogue))} className="btn-primary text-sm inline-flex items-center gap-1"><Plus size={14} /> New collection</button>
      </div>

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-50">No collections yet for this catalogue.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((c, i) => {
            const ac = accentOf(c.accent)
            return (
              <div key={c.id} className={`card p-3 flex items-center gap-3 ${c.active === false ? 'opacity-60' : ''}`}>
                <div className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="text-ink-40 hover:text-ink disabled:opacity-30"><ChevronUp size={15} /></button>
                  <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="text-ink-40 hover:text-ink disabled:opacity-30"><ChevronDown size={15} /></button>
                </div>
                <div className="w-10 h-10 rounded shrink-0 flex items-center justify-center text-[10px] font-medium" style={{ background: ac.tile, color: ac.ink }}>
                  {c.image_mode === 'custom' && c.custom_url ? <img src={c.custom_url} alt="" className="w-full h-full object-cover rounded" /> : 'Aa'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-90 truncate">{c.title || <span className="text-ink-40 italic">Untitled</span>}</p>
                  <p className="text-xs text-ink-50 truncate">
                    {c.type === 'filter' && `Filter · ${c.filter_value || '(none)'}`}
                    {c.type === 'manual' && `Manual · ${c.product_ids.length} product${c.product_ids.length === 1 ? '' : 's'}`}
                    {c.type === 'smart' && `Smart · ${c.smart_rule}`}
                    {c.active === false && ' · hidden'}
                  </p>
                </div>
                <button onClick={() => setEditing(c)} className="text-ink-50 hover:text-brand-600 p-1"><Pencil size={15} /></button>
                <button onClick={() => setConfirmDel(c)} className="text-ink-40 hover:text-red-500 p-1"><Trash2 size={15} /></button>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <CollectionEditor
          value={editing} catalogue={catalogue} filterValues={filterValues} products={products}
          onClose={() => setEditing(null)}
          onSave={async data => { await saveCollection(catalogue, data); setEditing(null) }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog title="Delete collection" message={`Delete “${confirmDel.title || 'Untitled'}”? This cannot be undone.`}
          onConfirm={async () => { await deleteCollection(catalogue, confirmDel.id); setConfirmDel(null) }}
          onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  )
}

function CollectionEditor({ value, catalogue, filterValues, products, onClose, onSave }) {
  const [f, setF] = useState(value)
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const picked = new Set(f.product_ids || [])
  const matches = useMemo(() => {
    const q = search.toLowerCase()
    return products.filter(p => !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)).slice(0, 40)
  }, [products, search])

  async function upload(file) {
    if (!file) return
    setUploading(true)
    try {
      // Upload under catalogues/* — an already-allowed Storage path (no rule change needed).
      const r = storageRef(storage, `catalogues/band/${catalogue}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`)
      await uploadBytes(r, file)
      set('custom_url', await getDownloadURL(r))
      set('image_mode', 'custom')
    } finally { setUploading(false) }
  }

  const canSave = f.title.trim() && (f.type !== 'filter' || f.filter_value) && (f.type !== 'manual' || (f.product_ids || []).length)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-ivory-dark">
          <h2 className="font-semibold text-ink-90">{f.id ? 'Edit collection' : 'New collection'}</h2>
          <button onClick={onClose} className="text-ink-40 hover:text-ink"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Title *</label><input className="input" value={f.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Animals" /></div>
            <div><label className="label">Subtitle</label><input className="input" value={f.subtitle} onChange={e => set('subtitle', e.target.value)} placeholder="optional" /></div>
          </div>

          <div>
            <label className="label">Type</label>
            <div className="inline-flex rounded-lg border border-ivory-dark overflow-hidden">
              {[['filter', 'Use a category'], ['manual', 'Pick products'], ['smart', 'Smart (New In)']].map(([v, lbl]) => (
                <button key={v} type="button" onClick={() => set('type', v)}
                        className={`px-3 py-1.5 text-sm border-l first:border-l-0 border-ivory-dark ${f.type === v ? 'bg-ink text-white' : 'bg-white text-ink-70 hover:bg-ivory'}`}>{lbl}</button>
              ))}
            </div>
          </div>

          {f.type === 'filter' && (
            <div>
              <label className="label">Category ({FILTER_FIELD[catalogue]})</label>
              <select className="input" value={f.filter_value} onChange={e => set('filter_value', e.target.value)}>
                <option value="">— select —</option>
                {filterValues.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <p className="text-xs text-ink-50 mt-1">Clicking the tile filters the grid to this category.</p>
            </div>
          )}

          {f.type === 'manual' && (
            <div>
              <label className="label">Products ({(f.product_ids || []).length} picked)</label>
              <input className="input mb-2" placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} />
              <div className="border border-ivory-dark rounded max-h-52 overflow-y-auto divide-y divide-ivory">
                {matches.map(p => {
                  const on = picked.has(p.id)
                  return (
                    <button key={p.id} type="button"
                            onClick={() => set('product_ids', on ? f.product_ids.filter(x => x !== p.id) : [...(f.product_ids || []), p.id])}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-ivory ${on ? 'bg-brand-50' : ''}`}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-brand-600 border-brand-600 text-white' : 'border-ink-30'}`}>{on ? '✓' : ''}</span>
                      {p.image ? <img src={p.image} alt="" className="w-7 h-7 object-contain rounded bg-white border border-ivory" /> : <span className="w-7 h-7 rounded bg-ivory" />}
                      <span className="text-sm text-ink-80 truncate flex-1">{p.name}</span>
                      <span className="text-[10px] text-ink-40">{p.cat}</span>
                    </button>
                  )
                })}
                {matches.length === 0 && <p className="text-xs text-ink-40 text-center py-4">No products found.</p>}
              </div>
            </div>
          )}

          {f.type === 'smart' && (
            <div>
              <label className="label">Rule</label>
              <select className="input" value={f.smart_rule} onChange={e => set('smart_rule', e.target.value)}>
                {SMART_RULES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <p className="text-xs text-ink-50 mt-1">Auto-updates from the products tagged “New arrival”.</p>
            </div>
          )}

          <div>
            <label className="label">Accent colour</label>
            <div className="flex gap-2 flex-wrap">
              {ACCENTS.map(a => (
                <button key={a.key} type="button" onClick={() => set('accent', a.key)} title={a.label}
                        className={`w-8 h-8 rounded-md border-2 ${f.accent === a.key ? 'border-ink' : 'border-transparent'}`}
                        style={{ background: a.tile }}>
                  <span className="text-[10px] font-medium" style={{ color: a.ink }}>Aa</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Tile image</label>
            <div className="flex items-center gap-3">
              <select className="input py-1.5 text-sm w-40" value={f.image_mode} onChange={e => set('image_mode', e.target.value)}>
                <option value="template">Templated (product photo)</option>
                <option value="custom">Custom upload</option>
              </select>
              {f.image_mode === 'custom' && (
                <label className="btn-secondary text-sm cursor-pointer">
                  {uploading ? 'Uploading…' : f.custom_url ? 'Replace image' : 'Upload image'}
                  <input type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files?.[0])} />
                </label>
              )}
              {f.image_mode === 'custom' && f.custom_url && <img src={f.custom_url} alt="" className="w-10 h-10 object-cover rounded border border-ivory-dark" />}
            </div>
            <p className="text-xs text-ink-50 mt-1">Custom uses your full-bleed image with the title overlaid (best look — keep a consistent style across tiles). Templated falls back to a representative product photo on the accent colour.</p>
          </div>

          {f.image_mode === 'custom' && (
            <div className="rounded-lg border border-ivory-dark p-3 space-y-3">
              <p className="text-xs font-medium text-ink-70">Label &amp; overlay</p>
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="label">Title colour</label>
                  <div className="inline-flex rounded-lg border border-ivory-dark overflow-hidden">
                    {[['white', 'White'], ['black', 'Black']].map(([v, lbl]) => (
                      <button key={v} type="button" onClick={() => set('title_color', v)}
                              className={`px-3 py-1.5 text-sm border-l first:border-l-0 border-ivory-dark ${(f.title_color || 'white') === v ? 'bg-ink text-white' : 'bg-white text-ink-70 hover:bg-ivory'}`}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">Overlay</label>
                  <select className="input py-1.5 text-sm w-28" value={f.overlay_color || 'black'} onChange={e => set('overlay_color', e.target.value)}>
                    <option value="black">Dark</option>
                    <option value="white">Light</option>
                    <option value="none">None</option>
                  </select>
                </div>
                {(f.overlay_color || 'black') !== 'none' && (
                  <div className="flex-1 min-w-[140px]">
                    <label className="label">Overlay strength · {Math.round((f.overlay_opacity ?? 0.55) * 100)}%</label>
                    <input type="range" min="0" max="80" step="5" className="w-full"
                           value={Math.round((f.overlay_opacity ?? 0.55) * 100)}
                           onChange={e => set('overlay_opacity', Number(e.target.value) / 100)} />
                  </div>
                )}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={f.active !== false} onChange={e => set('active', e.target.checked)} />
            Active (visible in the shop)
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-ivory-dark">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={() => onSave(f)} disabled={!canSave} className="btn-primary text-sm">Save</button>
        </div>
      </div>
    </div>
  )
}
