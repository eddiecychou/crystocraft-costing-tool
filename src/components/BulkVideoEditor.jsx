import { useState, useEffect, useCallback, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { designNumber, brandLetter, bodyLetter, normVideos, youtubeEmbed } from '../constants'
import { CheckSquare, Square } from 'lucide-react'
import LoadingBar from './LoadingBar'

// Bulk-add ONE video URL to many products at once, across BOTH catalogues
// (corp gift `products` + Crystocraft range `range_products`) in a single
// unified picker. Appends to each item's existing videos[] (never replaces —
// mirrors the "Add another video" behaviour of VideoUrlsEditor), so items
// that already have videos just gain one more.
export default function BulkVideoEditor() {
  const [corpProducts, setCorpProducts] = useState(null)      // null = loading
  const [rangeProducts, setRangeProducts] = useState(null)
  const [search, setSearch] = useState('')
  const [filterCatalogue, setFilterCatalogue] = useState('')  // '' | 'corp' | 'figurine'
  const [selected, setSelected] = useState(new Set())
  const [videoUrl, setVideoUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const q1 = query(collection(db, 'products'), orderBy('createdAt', 'desc'))
    const unsub1 = onSnapshot(q1, snap => setCorpProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => setCorpProducts([]))
    const q2 = query(collection(db, 'range_products'), orderBy('design_code'))
    const unsub2 = onSnapshot(q2, snap => setRangeProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => setRangeProducts([]))
    return () => { unsub1(); unsub2() }
  }, [])

  const loading = corpProducts === null || rangeProducts === null

  const items = useMemo(() => {
    const corp = (corpProducts || []).map(p => ({
      key: `corp:${p.id}`, id: p.id, catalogue: 'corp', collectionName: 'products',
      code: '', name: p.name || p.id,
      videos: normVideos(p.videos, p.video_url),
    }))
    const range = (rangeProducts || []).map(p => {
      const fallbackBrand = brandLetter(p.design_code) || 'D'
      const designNo = p.design_no || designNumber(p.design_code)
      const body = p.body_code || bodyLetter(p.design_code)
      return {
        key: `figurine:${p.id}`, id: p.id, catalogue: 'figurine', collectionName: 'range_products',
        code: `${fallbackBrand}${body}${designNo}`, name: p.description || p.design_name || designNo,
        videos: normVideos(p.videos, p.video_url),
      }
    })
    return [...corp, ...range]
  }, [corpProducts, rangeProducts])

  const filtered = useMemo(() => items.filter(item => {
    const q = search.toLowerCase()
    const matchSearch = !q || item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q)
    const matchCatalogue = !filterCatalogue || item.catalogue === filterCatalogue
    return matchSearch && matchCatalogue
  }), [items, search, filterCatalogue])

  const allKeys = filtered.map(i => i.key)
  const allChecked = allKeys.length > 0 && allKeys.every(k => selected.has(k))
  const someChecked = allKeys.some(k => selected.has(k))
  const nSelected = allKeys.filter(k => selected.has(k)).length

  const toggleOne = useCallback(key => {
    setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected(prev => {
      const all = allKeys.every(k => prev.has(k))
      const n = new Set(prev)
      all ? allKeys.forEach(k => n.delete(k)) : allKeys.forEach(k => n.add(k))
      return n
    })
  }, [allKeys])

  const looksLikeYoutube = !videoUrl.trim() || youtubeEmbed(videoUrl.trim())

  async function apply() {
    const url = videoUrl.trim()
    if (!nSelected || !url) return
    setSaving(true)
    try {
      const targets = items.filter(i => selected.has(i.key) && allKeys.includes(i.key))
      for (let i = 0; i < targets.length; i += 400) {
        const batch = writeBatch(db)
        targets.slice(i, i + 400).forEach(item => {
          const nextVideos = normVideos([...item.videos, url])
          batch.update(doc(db, item.collectionName, item.id), { videos: nextVideos, updatedAt: serverTimestamp() })
        })
        await batch.commit()
      }
      setSelected(new Set())
      setVideoUrl('')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingBar />

  const canApply = nSelected > 0 && videoUrl.trim() && looksLikeYoutube

  return (
    <div>
      <p className="text-sm text-ink-60 mb-4">
        Filter/select products from either catalogue, then add one video URL to all selected at
        once. Adds to each item's existing videos — never removes or replaces what's already there.
      </p>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          className="input flex-1"
          placeholder="Search name or code…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input sm:w-48" value={filterCatalogue} onChange={e => setFilterCatalogue(e.target.value)}>
          <option value="">All catalogues</option>
          <option value="corp">Corp Gift</option>
          <option value="figurine">Crystocraft Range</option>
        </select>
      </div>

      {/* Sticky action bar */}
      <div className="sticky top-0 z-20 bg-white border border-ivory-dark rounded-none px-4 py-3 mb-4 flex flex-wrap items-center gap-3 shadow-sm">
        <span className="text-sm font-medium text-ink-80 min-w-[90px]">
          {nSelected > 0 ? `${nSelected} selected` : `${filtered.length} rows`}
        </span>
        <div className="flex-1 min-w-[220px]">
          <input
            className="input py-1.5 text-sm w-full"
            placeholder="https://www.youtube.com/watch?v=… — video URL to add"
            value={videoUrl}
            onChange={e => setVideoUrl(e.target.value)}
          />
          {videoUrl.trim() && !looksLikeYoutube && (
            <p className="text-xs text-amber-600 mt-1">This doesn't look like a YouTube link — the video won't display.</p>
          )}
        </div>
        <button onClick={apply} disabled={!canApply || saving} className="btn-primary text-sm py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? 'Saving…' : `Add to ${nSelected}`}
        </button>
        {saved && <span className="text-xs text-green-600">Saved ✓</span>}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ivory-dark bg-ivory text-left text-xs font-medium text-ink-60 uppercase tracking-wide">
              <th className="px-3 py-2.5 w-8">
                <button onClick={toggleAll} className="text-ink-60 hover:text-ink">
                  {allChecked ? <CheckSquare size={16} /> : someChecked ? <CheckSquare size={16} className="opacity-50" /> : <Square size={16} />}
                </button>
              </th>
              <th className="px-3 py-2.5">Catalogue</th>
              <th className="px-3 py-2.5">Code</th>
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5 hidden md:table-cell">Videos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ivory-dark">
            {filtered.map(item => {
              const checked = selected.has(item.key)
              return (
                <tr key={item.key} onClick={() => toggleOne(item.key)}
                    className={`cursor-pointer transition-colors ${checked ? 'bg-brand-50' : 'hover:bg-ivory'}`}>
                  <td className="px-3 py-2.5">
                    <span className={checked ? 'text-brand-600' : 'text-ink-60'}>
                      {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`badge ${item.catalogue === 'corp' ? 'bg-sky-50 text-sky-700' : 'bg-indigo-50 text-indigo-700'}`}>
                      {item.catalogue === 'corp' ? 'Corp Gift' : 'Figurine'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-ink-70 whitespace-nowrap">{item.code || '—'}</td>
                  <td className="px-3 py-2.5 text-ink">{item.name}</td>
                  <td className="px-3 py-2.5 hidden md:table-cell text-ink-60 text-xs">
                    {item.videos.length ? `${item.videos.length} video${item.videos.length > 1 ? 's' : ''}` : '—'}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-ink-60 text-sm">No products match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
