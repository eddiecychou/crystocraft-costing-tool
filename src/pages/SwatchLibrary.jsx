import { useState, useEffect, useMemo, useCallback } from 'react'
import { Gem, Search, X, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import { fetchSwatchRegistry, fetchSwatchImageUrl, loadSwatchNotes, saveSwatchNotes } from '../swatchLibraryApi'

// Admin-facing browser over the render service's photographed swatch
// registry — see Crystal_Fabric_Studio_Spec.md §5a. Built for a sales rep
// to pull up mid-call, not for public/portal use. Reads the SAME registry
// admin.html's photo-capture tool writes (via /api/swatch-library, proxying
// GET /swatches on the Fly service) — no separate Firestore copy of the
// photo data, so there's nothing to drift out of sync here.
const STYLE_LABEL = { fabric: 'Crystal Fabric', rock: 'Fine Rock / Rock' }

function SwatchThumb({ filename, alt }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    let objUrl = null
    fetchSwatchImageUrl(filename).then(u => { if (alive) { objUrl = u; setUrl(u) } }).catch(() => {})
    return () => { alive = false; if (objUrl) URL.revokeObjectURL(objUrl) }
  }, [filename])
  return (
    <div className="aspect-square bg-ivory-dark rounded-none overflow-hidden flex items-center justify-center">
      {url ? <img src={url} alt={alt} className="w-full h-full object-cover" /> : <Gem size={20} className="text-platinum" />}
    </div>
  )
}

// Flattened [{ style, backfilm, file }] list for one colour, every captured
// photo across both styles — what the card carousel cycles through.
function photosOf(entry) {
  const out = []
  for (const [style, backfilms] of Object.entries(entry.slots || {})) {
    for (const [backfilm, slot] of Object.entries(backfilms)) {
      out.push({ style, backfilm, file: slot.file })
    }
  }
  return out
}

// Grid-card carousel — owner, 2026-08-11: "see different effects and colors
// with arrows" on the first-level grid, not just the single static
// thumbnail it had before. Cycles every captured (style, backfilm) photo
// for the colour; arrows stop propagation so they don't also open the
// detail modal (the card's own onClick does that).
function SwatchCardCarousel({ name, entry }) {
  const photos = useMemo(() => photosOf(entry), [entry])
  const [i, setI] = useState(0)
  const [url, setUrl] = useState(null)
  const current = photos[i]

  useEffect(() => {
    if (!current) { setUrl(null); return }
    let alive = true
    let objUrl = null
    fetchSwatchImageUrl(current.file).then(u => { if (alive) { objUrl = u; setUrl(u) } }).catch(() => {})
    return () => { alive = false; if (objUrl) URL.revokeObjectURL(objUrl) }
  }, [current?.file])

  const step = (dir, e) => {
    e.stopPropagation()
    e.preventDefault()
    setI(n => (n + dir + photos.length) % photos.length)
  }

  return (
    <div className="aspect-square bg-ivory-dark relative overflow-hidden group">
      {url ? <img src={url} alt={`${name} — ${current.style} on ${current.backfilm}`} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center"><Gem size={20} className="text-platinum" /></div>}
      {photos.length > 1 && (
        <>
          <button type="button" onClick={e => step(-1, e)}
            className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronLeft size={14} />
          </button>
          <button type="button" onClick={e => step(1, e)}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronRight size={14} />
          </button>
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-white bg-black/40 rounded-full px-1.5 py-0.5">
            {i + 1}/{photos.length}
          </span>
        </>
      )}
    </div>
  )
}

function TagEditor({ label, values, onChange, placeholder }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v) return
    onChange([...values, v])
    setDraft('')
  }
  return (
    <div>
      <p className="text-xs font-label uppercase tracking-wide text-ink-60 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v, i) => (
          <span key={i} className="badge bg-brand-50 text-brand-700 inline-flex items-center gap-1">
            {v}
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} className="hover:text-brand-900">
              <X size={11} />
            </button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-ink-60 italic">None yet</span>}
      </div>
      <div className="flex gap-1.5">
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder} className="input flex-1 text-sm" />
        <button type="button" onClick={add} className="btn-secondary px-2.5"><Plus size={14} /></button>
      </div>
    </div>
  )
}

function SwatchDetail({ name, entry, onClose }) {
  const [notes, setNotes] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadSwatchNotes(name).then(setNotes) }, [name])

  const persist = useCallback(async next => {
    setNotes(next)
    setSaving(true)
    try { await saveSwatchNotes(name, next) } finally { setSaving(false) }
  }, [name])

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-none max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg text-ink flex items-center gap-2">
            <span className="w-4 h-4 rounded-full border border-ivory-dark shrink-0" style={{ background: entry.rgb ? `rgb(${entry.rgb.map(c => Math.round(c * 255)).join(',')})` : '#ccc' }} />
            {name}
          </h2>
          <button onClick={onClose} className="text-ink-60 hover:text-ink"><X size={18} /></button>
        </div>

        {Object.entries(entry.slots || {}).map(([style, backfilms]) => (
          Object.keys(backfilms).length > 0 && (
            <div key={style} className="mb-4">
              <p className="text-xs font-label uppercase tracking-wide text-ink-60 mb-2">{STYLE_LABEL[style] || style}</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {Object.entries(backfilms).map(([bf, slot]) => (
                  <div key={bf}>
                    <SwatchThumb filename={slot.file} alt={`${name} ${style} on ${bf}`} />
                    <p className="text-[11px] text-ink-60 mt-1 text-center truncate">{bf}</p>
                  </div>
                ))}
              </div>
            </div>
          )
        ))}

        {notes ? (
          <div className="space-y-4 pt-2 border-t border-ivory-dark">
            <TagEditor label="Legacy Swarovski references" values={notes.legacy_swarovski_refs}
              onChange={v => persist({ ...notes, legacy_swarovski_refs: v })}
              placeholder="e.g. 2058 Xilion Rose — press Enter" />
            {saving && <p className="text-[11px] text-ink-60">Saving…</p>}
          </div>
        ) : <p className="text-sm text-ink-60 py-4">Loading notes…</p>}
      </div>
    </div>
  )
}

export default function SwatchLibrary() {
  const [registry, setRegistry] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    fetchSwatchRegistry().then(setRegistry).catch(e => setError(e.message))
  }, [])

  const entries = useMemo(() => {
    if (!registry) return []
    const q = search.trim().toLowerCase()
    return Object.entries(registry)
      .filter(([name]) => !q || name.toLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b))
  }, [registry, search])

  return (
    <div className="p-4 md:p-6">
      <div className="mb-2">
        <h1 className="text-xl md:text-2xl flex items-center gap-2"><Gem size={20} className="text-brand-500" /> Swatch Library</h1>
        <p className="text-sm text-ink-60 mt-0.5">
          The live crystal registry — for sales calls, not customer-facing. Photos come straight from
          the render service; add use-case notes and legacy Swarovski references below.
        </p>
      </div>

      {error && <div className="rounded-none bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 mb-4">{error}</div>}

      <div className="relative mb-5">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-60" />
        <input type="text" placeholder="Search colour name…" className="input w-full pl-8"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {!registry && !error ? <LoadingBar /> : entries.length === 0 ? (
        <div className="text-center py-20 text-ink-60">No swatches match.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {entries.map(([name, entry]) => {
            return (
              // Not a <button> — SwatchCardCarousel renders real <button>
              // arrows inside it, and a button can't nest another button.
              <div key={name} role="button" tabIndex={0}
                onClick={() => setSelected([name, entry])}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected([name, entry]) } }}
                className="card overflow-hidden flex flex-col text-left hover:shadow-md transition-shadow cursor-pointer">
                <SwatchCardCarousel name={name} entry={entry} />
                <div className="p-2">
                  <p className="text-sm text-ink truncate">{name}</p>
                  <p className="text-[11px] text-ink-60">
                    {Object.entries(entry.slots || {}).filter(([, bf]) => Object.keys(bf).length).map(([s]) => STYLE_LABEL[s] || s).join(' · ') || 'No photos'}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selected && <SwatchDetail name={selected[0]} entry={selected[1]} onClose={() => setSelected(null)} />}
    </div>
  )
}
