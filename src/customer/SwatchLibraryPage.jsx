import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Search, X, ChevronLeft, ChevronRight, PackageCheck } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import { fetchSwatchRegistry, fetchSwatchImageUrl, loadSwatchNotes } from '../swatchLibraryApi'
import { useCart } from './store'

// Portal-facing swatch browser — Crystal_Fabric_Studio_Spec.md §5b. Same
// registry the admin Swatch Library reads (src/pages/SwatchLibrary.jsx),
// same /api/swatch-library proxy, now open to any approved customer. What's
// different from the admin version: no note-editing (legacy refs are
// read-only here), and the detail panel's primary action is "Request a
// sample" — per §4, physical samples are the actual conversion event, not
// a rendered image, so this page never shows a price.
//
// "Request a sample" adds a `type: 'swatch_sample'` line to the SAME
// enquiry cart Corporate/Figurine Gifts use (useCart, store.jsx) rather
// than submitting straight to Firestore on its own — owner, 2026-08-11:
// tried it and it "doesn't go to the enquiry tab" the way adding a product
// does. Review/submit/combine-with-other-items now all go through the
// existing /shop/enquiry flow (EnquiryPage.jsx), so a sample request can
// ride along with a real product enquiry in one submission, same as
// everything else in the cart.
const STYLE_LABEL = { fabric: 'Crystal Fabric', rock: 'Fine Rock / Rock' }

function photosOf(entry) {
  const out = []
  for (const [style, backfilms] of Object.entries(entry.slots || {})) {
    for (const [backfilm, slot] of Object.entries(backfilms)) out.push({ style, backfilm, file: slot.file })
  }
  return out
}

// Fires an authed fetch (JWT verify + Firestore role check + Fly.io proxy —
// see swatch-library.js) per photo, with no pagination on the grid below —
// on a page with dozens of colours that's dozens of concurrent round trips
// at once, which is what made the swatch library "very slow" on mobile.
// Deferring each photo's fetch until its card actually scrolls into view
// keeps only what's on screen in flight at a time.
function useInViewOnce() {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (inView || !ref.current) return
    const el = ref.current
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect() }
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [inView])
  return [ref, inView]
}

function SwatchThumb({ filename, alt }) {
  const [url, setUrl] = useState(null)
  const [ref, inView] = useInViewOnce()
  useEffect(() => {
    if (!inView) return
    let alive = true
    let objUrl = null
    fetchSwatchImageUrl(filename).then(u => { if (alive) { objUrl = u; setUrl(u) } }).catch(() => {})
    return () => { alive = false; if (objUrl) URL.revokeObjectURL(objUrl) }
  }, [filename, inView])
  return (
    <div ref={ref} className="aspect-square bg-gray-100 rounded-md overflow-hidden flex items-center justify-center">
      {url ? <img src={url} alt={alt} className="w-full h-full object-cover" /> : <Sparkles size={20} className="text-gray-300" />}
    </div>
  )
}

function SwatchCardCarousel({ name, entry }) {
  const photos = useMemo(() => photosOf(entry), [entry])
  const [i, setI] = useState(0)
  const [url, setUrl] = useState(null)
  const current = photos[i]
  const [ref, inView] = useInViewOnce()

  useEffect(() => {
    if (!current || !inView) { if (!current) setUrl(null); return }
    let alive = true
    let objUrl = null
    fetchSwatchImageUrl(current.file).then(u => { if (alive) { objUrl = u; setUrl(u) } }).catch(() => {})
    return () => { alive = false; if (objUrl) URL.revokeObjectURL(objUrl) }
  }, [current?.file, inView])

  const step = (dir, e) => {
    e.stopPropagation(); e.preventDefault()
    setI(n => (n + dir + photos.length) % photos.length)
  }

  return (
    <div ref={ref} className="aspect-square bg-gray-100 relative overflow-hidden group">
      {url ? <img src={url} alt={`${name} — ${current.style} on ${current.backfilm}`} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center"><Sparkles size={20} className="text-gray-300" /></div>}
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

function SwatchDetail({ name, entry, onClose }) {
  const cart = useCart()
  const [notes, setNotes] = useState(null)
  const [pickedStyle, setPickedStyle] = useState(null)
  const [note, setNote] = useState('')
  const [added, setAdded] = useState(false)

  useEffect(() => { loadSwatchNotes(name).then(setNotes) }, [name])

  const styles = Object.entries(entry.slots || {}).filter(([, bf]) => Object.keys(bf).length)

  const addToEnquiry = () => {
    cart.add({
      type: 'swatch_sample', id: name, name, code: '', image: '',
      finish: pickedStyle ? (STYLE_LABEL[pickedStyle] || pickedStyle) : '',
      note, qty: 1,
    })
    setAdded(true)
  }

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

        {styles.map(([style, backfilms]) => (
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
        ))}

        {notes?.legacy_swarovski_refs?.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-1.5">Closest legacy Swarovski references</p>
            <div className="flex flex-wrap gap-1.5">
              {notes.legacy_swarovski_refs.map((v, i) => (
                <span key={i} className="badge bg-brand-50 text-brand-700">{v}</span>
              ))}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-ivory-dark">
          {added ? (
            <div className="flex items-center gap-2 text-emerald-700 text-sm py-2">
              <PackageCheck size={16} /> Added to your enquiry.{' '}
              <Link to="/shop/enquiry" className="underline hover:text-emerald-900">Review &amp; send it</Link>
            </div>
          ) : (
            <>
              <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-2">Request a physical sample</p>
              {styles.length > 1 && (
                <select className="input w-full mb-2 text-sm" value={pickedStyle || ''} onChange={e => setPickedStyle(e.target.value || null)}>
                  <option value="">Any crystal type</option>
                  {styles.map(([s]) => <option key={s} value={s}>{STYLE_LABEL[s] || s}</option>)}
                </select>
              )}
              <textarea className="input w-full text-sm" rows={2} value={note} onChange={e => setNote(e.target.value)}
                placeholder="What are you making, and how many? (optional)" />
              <button onClick={addToEnquiry} className="btn-primary mt-2.5 w-full sm:w-auto">
                Add sample request to enquiry
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SwatchLibraryPage({ profile }) {
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
    <div>
      <div className="mb-2">
        <h1 className="text-xl md:text-2xl flex items-center gap-2"><Sparkles size={20} className="text-brand-500" /> Swatch Library</h1>
        <p className="text-sm text-ink-60 mt-0.5">
          Real photographed crystal swatches — browse colours and crystal types, then request a physical sample.
        </p>
      </div>

      {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 mb-4">{error}</div>}

      <div className="relative mb-5">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-30" />
        <input type="text" placeholder="Search colour name…" className="input w-full pl-8"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {!registry && !error ? <LoadingBar /> : entries.length === 0 ? (
        <div className="text-center py-20 text-ink-60">No swatches match.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {entries.map(([name, entry]) => (
            <div key={name} role="button" tabIndex={0}
              onClick={() => setSelected([name, entry])}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected([name, entry]) } }}
              className="card overflow-hidden flex flex-col text-left hover:shadow-md transition-shadow cursor-pointer">
              <SwatchCardCarousel name={name} entry={entry} />
              <div className="p-2">
                <p className="text-sm text-ink truncate">{name}</p>
                <p className="text-[11px] text-ink-50">
                  {Object.entries(entry.slots || {}).filter(([, bf]) => Object.keys(bf).length).map(([s]) => STYLE_LABEL[s] || s).join(' · ')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && <SwatchDetail name={selected[0]} entry={selected[1]} onClose={() => setSelected(null)} />}
    </div>
  )
}
