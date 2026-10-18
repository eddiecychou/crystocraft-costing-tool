import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Search, X, ChevronLeft, ChevronRight, PackageCheck } from 'lucide-react'
import SwatchPhoto from '../components/SwatchPhoto'
import LoadingBar from '../components/LoadingBar'
import { fetchSwatchRegistry, loadSwatchNotes } from '../swatchLibraryApi'
import { useCart } from './store'

// The Fabric range reuses the same Firebase registry as the OC uploader.
// One page handles project quotations and optional physical sample requests.
import {FABRIC_STYLE_LABELS as STYLE_LABEL, fabricEnquiryLine} from '../domain/crystalFabric'

function photosOf(entry) {
  const out = []
  for (const [style, backfilms] of Object.entries(entry.slots || {})) {
    for (const [backfilm, slot] of Object.entries(backfilms)) out.push({ style, backfilm, file: slot.file })
  }
  return out
}

// Fires an authenticated Firebase image fetch (Storage publication/role rules —
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
  const [ref, inView] = useInViewOnce()
  return <div ref={ref} className="aspect-square bg-ivory-dark overflow-hidden flex items-center justify-center">
    <SwatchPhoto path={filename} alt={alt} enabled={inView} />
  </div>
}

function SwatchCardCarousel({ name, entry }) {
  const photos = useMemo(() => photosOf(entry), [entry])
  const [i, setI] = useState(0)
  const current = photos[i]
  const [ref, inView] = useInViewOnce()


  const step = (dir, e) => {
    e.stopPropagation(); e.preventDefault()
    setI(n => (n + dir + photos.length) % photos.length)
  }

  return (
    <div ref={ref} className="aspect-square bg-ivory relative overflow-hidden group">
      {current && <SwatchPhoto path={current.file} alt={`${name} — ${current.style} on ${current.backfilm}`} enabled={inView} />}

      {photos.length > 1 && (
        <>
          <button type="button" aria-label="Previous swatch photo" onClick={e => step(-1, e)}
            className="absolute left-1 top-1/2 -translate-y-1/2 min-w-10 min-h-10 rounded-none bg-black/40 text-white flex items-center justify-center focus-visible:ring-2 focus-visible:ring-brand-500">
            <ChevronLeft size={14} />
          </button>
          <button type="button" aria-label="Next swatch photo" onClick={e => step(1, e)}
            className="absolute right-1 top-1/2 -translate-y-1/2 min-w-10 min-h-10 rounded-none bg-black/40 text-white flex items-center justify-center focus-visible:ring-2 focus-visible:ring-brand-500">
            <ChevronRight size={14} />
          </button>
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-white bg-black/40 rounded-full px-1.5 py-0.5">
            {i + 1}/{photos.length}
          </span>
        </>
      )}
    </div>
  )
}

function SwatchDetail({ name, entry, onClose }) {
  const cart = useCart(), dialog = useRef(null)
  const [notes, setNotes] = useState(null)
  const [notesError, setNotesError] = useState('')
  const [pickedSample, setPickedSample] = useState('')
  const [intent, setIntent] = useState('project')
  const [application, setApplication] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => { dialog.current.showModal() }, [])
  useEffect(() => {
    let active = true
    if (entry) loadSwatchNotes(entry.notes_key || name).then(n => { if(active)setNotes(n) }).catch(e => { if(active)setNotesError(e.message) })
    return () => { active = false }
  }, [name, entry])
  const styles = Object.entries(entry?.slots || {}).filter(([, bf]) => Object.keys(bf).length)
  const choices = styles.flatMap(([style, slots]) => Object.entries(slots).map(([backing, slot]) => ({...slot, style, backing:slot.backing_label || backing})))
  const chosen = choices.find(slot => slot.sample_id === pickedSample)
  const reference = chosen ? {id:chosen.sample_id, revision:chosen.revision, publication:'published', color_name:name, style:chosen.style, backing_label:chosen.backing, media:{thumbnail:chosen.file}} : null
  const line = intent === 'project' ? fabricEnquiryLine(reference, {application,note}) : chosen ? {
    type:'swatch_sample', id:chosen.sample_id, name, code:'', image:'',
    swatch_sample_id:chosen.sample_id, swatch_revision:chosen.revision,
    finish:STYLE_LABEL[chosen.style] || chosen.style, color:chosen.backing, note, qty:1,
  } : null
  const added = line && cart.has(line)
  return (
    <dialog ref={dialog} aria-labelledby="fabric-enquiry-title" onCancel={onClose}
      onClick={e => { if(e.target === e.currentTarget)onClose() }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-2xl max-h-[85vh] overflow-y-auto card p-5 backdrop:bg-black/40">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h2 id="fabric-enquiry-title" className="text-lg text-ink">{name || 'Crystal Fabric enquiry'}</h2>
        <button aria-label="Close swatch details" onClick={onClose} className="btn-ghost min-h-11 min-w-11"><X size={18}/></button>
      </div>
      {styles.map(([style, backfilms]) => (
        <div key={style} className="mb-4">
          <p className="label mb-2">{STYLE_LABEL[style] || style}</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {Object.entries(backfilms).map(([bf, slot]) => <div key={bf}>
              <SwatchThumb filename={slot.display || slot.file} alt={name+' '+style+' on '+bf}/>
              <p className="text-xs text-ink-60 mt-1 text-center break-words">{slot.backing_label || bf}</p>
              {slot.description && <p className="text-xs text-ink-60 mt-1">{slot.description}</p>}
            </div>)}
          </div>
        </div>
      ))}
      {notesError && <p role="alert" className="text-sm text-brand-700">{notesError}</p>}
      {notes?.legacy_swarovski_refs?.length > 0 && <div className="mb-4"><p className="label mb-1.5">Closest legacy Swarovski references</p><div className="flex flex-wrap gap-1.5">{notes.legacy_swarovski_refs.map((v,i)=><span key={i} className="badge bg-brand-50 text-brand-700">{v}</span>)}</div></div>}
      <div className="pt-3 border-t border-ivory-dark space-y-3">
        {choices.length > 0 && <>
          <label className="block"><span className="label block mb-1">Enquiry type</span>
            <select className="input" value={intent} onChange={e=>setIntent(e.target.value)}><option value="project">Quotation for my project</option><option value="sample">Physical sample request</option></select>
          </label>
          <label className="block"><span className="label block mb-1">Photographed sample</span>
            <select className="input text-sm" value={pickedSample} onChange={e=>setPickedSample(e.target.value)}>
              <option value="">{intent==='project'?'Not sure yet — discuss with us':'Choose material and backing'}</option>
              {choices.map(slot=><option key={slot.sample_id} value={slot.sample_id}>{STYLE_LABEL[slot.style]} · {slot.backing}</option>)}
            </select>
          </label>
        </>}
        {intent==='project' && <>
          <p className="text-sm text-ink-70">Quoted from your actual drawing and intended application. Attach your drawing on the enquiry page, or discuss your idea with us first.</p>
          <label className="block"><span className="label block mb-1">Intended application</span><textarea className="input text-sm" rows={2} value={application} onChange={e=>setApplication(e.target.value)} placeholder="How and where will the fabric be used? (if known)"/></label>
        </>}
        <label className="block"><span className="label block mb-1">Project notes (optional)</span><textarea className="input w-full text-sm" rows={2} value={note} onChange={e=>setNote(e.target.value)} placeholder="Quantity, dimensions, adhesive, effects or deadline — if known"/></label>
        {added ? <div role="status" className="flex flex-wrap items-center gap-2 text-ink text-sm py-2"><PackageCheck size={16}/> Added to your enquiry. <Link to="/shop/enquiry" className="underline">Review &amp; send it</Link></div>
          : <button disabled={!line} onClick={()=>cart.add(line)} className="btn-primary min-h-11 w-full sm:w-auto">{intent==='project'?'Add fabric project to enquiry':'Add sample request to enquiry'}</button>}
      </div>
    </dialog>
  )
}

export default function SwatchLibraryPage() {
  const [registry, setRegistry] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [material, setMaterial] = useState('')
  const [selected, setSelected] = useState(null)

  const load = () => { setError(''); fetchSwatchRegistry().then(setRegistry).catch(() => setError('The fabric swatches could not be loaded. Please retry.')) }
  useEffect(load, [])

  const entries = useMemo(() => {
    if (!registry) return []
    const q = search.trim().toLowerCase()
    return Object.entries(registry)
      .map(([name,entry]) => [name, {...entry,slots:Object.fromEntries(Object.entries(entry.slots || {}).filter(([style])=>!material || style===material))}])
      .filter(([,entry]) => Object.keys(entry.slots).length)
      .filter(([name]) => !q || name.toLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b))
  }, [registry, search, material])

  return (
    <div className="py-8 space-y-5">
      <Link to="/shop/crystal-components" className="text-sm text-brand-600 inline-flex min-h-11 items-center">← Crystal Components</Link>
      <div className="space-y-3">
        <p className="eyebrow tracking-[0.08em] text-bronze mb-1.5">Crystocraft Crystal Components</p>
        <h1 className="text-2xl md:text-3xl text-ink">Crystal Fabric</h1>
        <p className="text-sm text-ink-60 mt-0.5">
          Explore our existing photographed colours, materials and backings for your project. Pricing is confirmed from the actual drawing and intended application.
        </p>
        <button className="btn-secondary min-h-11" disabled={!registry || !!error} onClick={()=>setSelected(['',null])}>Enquire without a swatch</button>
      </div>

      {error && <div className="rounded-none bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 mb-4">{error}<button className="btn-ghost min-h-11" onClick={load}>Retry swatches</button></div>}

      <div className="grid sm:grid-cols-2 gap-3"><label className="relative block"><span className="sr-only">Search colour</span>
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-60" />
        <input type="text" placeholder="Search colour name…" className="input w-full pl-8"
          value={search} onChange={e => setSearch(e.target.value)} />
      </label><label><span className="sr-only">Material</span><select className="input" value={material} onChange={e=>setMaterial(e.target.value)}><option value="">All photographed materials</option>{Object.entries(STYLE_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
      <p className="text-xs text-ink-60">Photographs are reference samples. Backing labels follow the photographed samples; final construction, adhesive and effects are agreed for your application.</p>
      {!registry && !error ? <LoadingBar /> : entries.length === 0 ? (
        <div className="text-center py-16">
          <p className="eyebrow text-ink-60 mb-1.5">No matches</p>
          <p className="text-sm text-ink-60">No swatches match your search.</p>
        </div>
      ) : (
        <div className="mosaic-grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {entries.map(([name, entry]) => (
            <div key={name} role="button" tabIndex={0}
              onClick={() => setSelected([name, entry])}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected([name, entry]) } }}
              className="mosaic-tile group flex flex-col text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset">
              <SwatchCardCarousel name={name} entry={entry} />
              <div className="p-2">
                <p className="text-sm text-ink truncate">{name}</p>
                <p className="text-xs text-ink-60">
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
