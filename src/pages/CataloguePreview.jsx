import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { doc, getDoc, collection, query, orderBy, getDocs } from 'firebase/firestore'
import { Printer } from 'lucide-react'
import { db } from '../firebase'
import CatalogueCover from '../components/CatalogueCover'
import CatalogueProductPages, { CatalogueSheet } from '../components/CatalogueProductPages'
import catalogueFont from '../assets/fonts/Questrial-Regular.ttf'
import labelFont from '../assets/fonts/WorkSans-Regular.ttf'
import { catalogueCSS } from '../cataloguePrintStyles'

const fonts = `@font-face { font-family: 'Catalogue Questrial'; src: url('${catalogueFont}') format('truetype'); } @font-face { font-family: 'Catalogue Work Sans'; src: url('${labelFont}') format('truetype'); }`

export default function CataloguePreview() {
  const { id } = useParams()
  const [catalogue, setCatalogue] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [status, setStatus] = useState({ ready: false, error: '' })
  const [scale, setScale] = useState(1)
  const wrapperRef = useRef(null)
  const handleStatus = useCallback(value => setStatus(value), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setStatus({ ready: false, error: '' })
    setLoadError('')
    Promise.all([
      getDoc(doc(db, 'catalogues', id)),
      getDocs(query(collection(db, 'catalogues', id, 'items'), orderBy('sort_order'))),
    ]).then(([catSnap, itemsSnap]) => {
      if (!active) return
      setCatalogue(catSnap.exists() ? { id: catSnap.id, ...catSnap.data() } : null)
      setItems(itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
      setLoading(false)
    }).catch(err => { if (active) { setLoadError(err.message); setLoading(false) } })
    return () => { active = false }
  }, [id])

  useEffect(() => {
    if (!wrapperRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, Math.max(0.1, (entry.contentRect.width - 32) / (297 * 96 / 25.4)))))
    observer.observe(wrapperRef.current)
    return () => observer.disconnect()
  }, [loading, catalogue])

  if (loading) return <div className="p-4 md:p-6"><p className="eyebrow text-ink-40 py-10 text-center">Loading…</p></div>
  if (loadError) return <div className="p-4 md:p-6" role="alert">Could not load catalogue: {loadError}</div>
  if (!catalogue) return <div className="p-4 md:p-6 text-center py-16"><p className="eyebrow text-ink-40 mb-1.5">Not found</p><Link to="/catalogues" className="text-sm text-brand-600 hover:underline">← Catalogues</Link></div>

  return <>
    <div className="no-print fixed top-0 left-0 right-0 z-50 bg-white border-b border-warm-grey px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <Link to={`/catalogues/${id}`} className="text-sm text-brand-600 hover:underline">← Back to Builder</Link>
        <p className="text-xs text-ink-60" role="status">{status.error || (status.ready ? `${status.pages} pages · All images and text checked` : 'Preparing pages and checking images…')}</p>
      </div>
      <button disabled={!status.ready} onClick={() => {
        const previous = document.title
        document.title = catalogue.name
        window.print()
        document.title = previous
      }} className="btn-primary inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50">
        <Printer size={15} /><span>Print / Save as PDF</span>
      </button>
    </div>
    <div ref={wrapperRef} className={`catalogue-wrapper catalogue-print-root${status.ready ? '' : ' cat-print-blocked'}`}>
      <style>{fonts + catalogueCSS}</style>
      <p className="cat-print-notice">{status.error || 'Please wait for the catalogue to finish preparing before printing.'}</p>
      <CatalogueSheet scale={scale} last={items.length === 0}><CatalogueCover catalogue={catalogue} /></CatalogueSheet>
      <CatalogueProductPages catalogue={catalogue} items={items} scale={scale} onStatus={handleStatus} />
    </div>
  </>
}
