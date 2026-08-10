import { useState, useEffect, useMemo, useCallback } from 'react'
import { Gem, Search, X, Plus } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import { fetchSwatchRegistry, fetchSwatchImageUrl, loadSwatchNotes, saveSwatchNotes } from '../swatchLibraryApi'
import { CRYSTAL_TYPES } from '../customizerApi'

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
    <div className="aspect-square bg-gray-100 rounded-md overflow-hidden flex items-center justify-center">
      {url ? <img src={url} alt={alt} className="w-full h-full object-cover" /> : <Gem size={20} className="text-gray-300" />}
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
      <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v, i) => (
          <span key={i} className="badge bg-brand-50 text-brand-700 inline-flex items-center gap-1">
            {v}
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} className="hover:text-brand-900">
              <X size={11} />
            </button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-ink-40 italic">None yet</span>}
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
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg text-ink flex items-center gap-2">
            <span className="w-4 h-4 rounded-full border border-ivory-dark shrink-0" style={{ background: entry.rgb ? `rgb(${entry.rgb.map(c => Math.round(c * 255)).join(',')})` : '#ccc' }} />
            {name}
          </h2>
          <button onClick={onClose} className="text-ink-40 hover:text-ink"><X size={18} /></button>
        </div>

        {Object.entries(entry.slots || {}).map(([style, backfilms]) => (
          Object.keys(backfilms).length > 0 && (
            <div key={style} className="mb-4">
              <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-2">{STYLE_LABEL[style] || style}</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {Object.entries(backfilms).map(([bf, slot]) => (
                  <div key={bf}>
                    <SwatchThumb filename={slot.file} alt={`${name} ${style} on ${bf}`} />
                    <p className="text-[11px] text-ink-50 mt-1 text-center truncate">{bf}</p>
                  </div>
                ))}
              </div>
            </div>
          )
        ))}

        {notes ? (
          <div className="space-y-4 pt-2 border-t border-ivory-dark">
            <TagEditor label="Recommended use cases" values={notes.recommended_use_cases}
              onChange={v => persist({ ...notes, recommended_use_cases: v })}
              placeholder="e.g. apparel trim — press Enter" />
            <TagEditor label="Legacy Swarovski references" values={notes.legacy_swarovski_refs}
              onChange={v => persist({ ...notes, legacy_swarovski_refs: v })}
              placeholder="e.g. 2058 Xilion Rose — press Enter" />
            {saving && <p className="text-[11px] text-ink-40">Saving…</p>}
          </div>
        ) : <p className="text-sm text-ink-40 py-4">Loading notes…</p>}
      </div>
    </div>
  )
}

export default function SwatchLibrary() {
  const [registry, setRegistry] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [styleFilter, setStyleFilter] = useState('') // '', 'fabric', 'rock'
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    fetchSwatchRegistry().then(setRegistry).catch(e => setError(e.message))
  }, [])

  const entries = useMemo(() => {
    if (!registry) return []
    const q = search.trim().toLowerCase()
    return Object.entries(registry)
      .filter(([name, entry]) => {
        if (q && !name.toLowerCase().includes(q)) return false
        if (styleFilter && !Object.keys(entry.slots?.[styleFilter] || {}).length) return false
        return true
      })
      .sort(([a], [b]) => a.localeCompare(b))
  }, [registry, search, styleFilter])

  return (
    <div className="p-4 md:p-6">
      <div className="mb-2">
        <h1 className="text-xl md:text-2xl flex items-center gap-2"><Gem size={20} className="text-brand-500" /> Swatch Library</h1>
        <p className="text-sm text-ink-60 mt-0.5">
          The live crystal registry — for sales calls, not customer-facing. Photos come straight from
          the render service; add use-case notes and legacy Swarovski references below.
        </p>
      </div>

      {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 mb-4">{error}</div>}

      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-30" />
          <input type="text" placeholder="Search colour name…" className="input w-full pl-8"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input sm:w-56" value={styleFilter} onChange={e => setStyleFilter(e.target.value)}>
          <option value="">All crystal types</option>
          {[...new Set(CRYSTAL_TYPES.map(t => t.style))].map(s => (
            <option key={s} value={s}>{STYLE_LABEL[s] || s}</option>
          ))}
        </select>
      </div>

      {!registry && !error ? <LoadingBar /> : entries.length === 0 ? (
        <div className="text-center py-20 text-ink-60">No swatches match.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {entries.map(([name, entry]) => {
            const anyPhoto = Object.values(entry.slots || {}).flatMap(s => Object.values(s))[0]
            return (
              <button key={name} onClick={() => setSelected([name, entry])}
                className="card overflow-hidden flex flex-col text-left hover:shadow-md transition-shadow">
                {anyPhoto ? <SwatchThumb filename={anyPhoto.file} alt={name} /> : (
                  <div className="aspect-square bg-gray-100 flex items-center justify-center"><Gem size={20} className="text-gray-300" /></div>
                )}
                <div className="p-2">
                  <p className="text-sm text-ink truncate">{name}</p>
                  <p className="text-[11px] text-ink-50">
                    {Object.entries(entry.slots || {}).filter(([, bf]) => Object.keys(bf).length).map(([s]) => STYLE_LABEL[s] || s).join(' · ') || 'No photos'}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selected && <SwatchDetail name={selected[0]} entry={selected[1]} onClose={() => setSelected(null)} />}
    </div>
  )
}
