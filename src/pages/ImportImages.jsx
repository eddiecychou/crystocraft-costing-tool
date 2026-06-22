import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, orderBy, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { buildRangeSku } from '../rangeSku'
import { designNumber, brandLetter } from '../constants'
import LoadingBar from '../components/LoadingBar'
import { ArrowLeft } from 'lucide-react'

// Default catalogue pages (the same blog links used in the WS Catalog Excel).
const DEFAULT_PAGES = [
  'https://www.crystocraft.com/blog/crystocraft-figurines-active-models-catalogue-2026/',
  'https://www.crystocraft.com/blog/gold-plated-figurine-freestand-ready-to-ship/',
  'https://www.crystocraft.com/blog/chrome-plated-figurine-freestand-ready-to-ship/',
  'https://www.crystocraft.com/blog/zodiac-signs-ready-to-ship/',
  'https://www.crystocraft.com/blog/sentiment-heart-gifts-ready-to-ship/',
  'https://www.crystocraft.com/blog/crystal-bible-figurines/',
  'https://www.crystocraft.com/blog/new-musical-boxes-2026/',
].join('\n')

// Base item code for a variant, e.g. D0018-001-G (no crystal suffix).
function variantBaseCode(p, v) {
  return buildRangeSku({
    brand_code: v.brand_code || brandLetter(p.design_code) || '',
    design_no: p.design_no || designNumber(p.design_code) || '',
    format: p.format_code || '001',
    plating_code: v.plating_code || '',
    running_no: v.running_no || '',
  })
}

async function scrapePages(urls) {
  const res = await fetch('/api/scrape-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

export default function ImportImages() {
  const [products, setProducts] = useState(null)
  const [pages, setPages] = useState(DEFAULT_PAGES)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [poolInfo, setPoolInfo] = useState(null) // { count, errors }
  const [rows, setRows] = useState(null)          // match preview
  const [picked, setPicked] = useState({})        // `${pid}|${url}` -> bool
  const [applying, setApplying] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => {
    getDocs(query(collection(db, 'range_products'), orderBy('design_code')))
      .then(snap => setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => setProducts([]))
  }, [])

  const pageList = useMemo(
    () => pages.split('\n').map(s => s.trim()).filter(Boolean),
    [pages],
  )

  async function handleScan() {
    if (!products) return
    setScanning(true); setError(''); setRows(null); setDone('')
    try {
      const { images, errors } = await scrapePages(pageList)
      setPoolInfo({ count: images.length, errors: errors || [] })

      // Longest filenames first so an exact/closest match wins per base code.
      const pool = [...images].sort((a, b) => a.filename.length - b.filename.length)

      const preview = []
      const nextPicked = {}
      for (const p of products) {
        const variants = Array.isArray(p.variants) ? p.variants : []
        const existing = new Set((p.gallery || []).map(g => g.url))
        const matches = new Map() // url -> { url, filename }
        for (const v of variants) {
          const base = variantBaseCode(p, v)
          if (!base || base.length < 6) continue
          for (const img of pool) {
            if (img.filename.startsWith(base) && !existing.has(img.url)) {
              if (!matches.has(img.url)) matches.set(img.url, img)
            }
          }
        }
        if (matches.size) {
          const list = [...matches.values()]
          preview.push({ product: p, images: list, existingCount: existing.size })
          for (const img of list) nextPicked[`${p.id}|${img.url}`] = true
        }
      }
      setRows(preview)
      setPicked(nextPicked)
    } catch (err) {
      setError(err.message || 'Scan failed.')
    } finally {
      setScanning(false)
    }
  }

  const selectedCount = Object.values(picked).filter(Boolean).length

  async function handleApply() {
    if (!rows) return
    setApplying(true); setError(''); setDone('')
    try {
      let updated = 0, added = 0
      for (const row of rows) {
        const chosen = row.images.filter(img => picked[`${row.product.id}|${img.url}`])
        if (!chosen.length) continue
        const current = Array.isArray(row.product.gallery) ? row.product.gallery : []
        const have = new Set(current.map(g => g.url))
        const additions = chosen
          .filter(img => !have.has(img.url))
          .map(img => ({ url: img.url, caption: img.filename }))
        if (!additions.length) continue
        await updateDoc(doc(db, 'range_products', row.product.id), {
          gallery: [...current, ...additions],
        })
        updated += 1; added += additions.length
      }
      setDone(`Added ${added} image${added === 1 ? '' : 's'} across ${updated} product${updated === 1 ? '' : 's'}.`)
      setRows(null); setPicked({})
    } catch (err) {
      setError(err.message || 'Apply failed.')
    } finally {
      setApplying(false)
    }
  }

  if (products === null) return <LoadingBar />

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <Link to="/range" className="inline-flex items-center gap-1 text-sm text-ink-60 hover:text-ink mb-4">
        <ArrowLeft size={15} /> Back to Figurine Gifts
      </Link>
      <h1 className="text-xl md:text-2xl mb-1">Import Images from WordPress</h1>
      <p className="text-sm text-ink-60 mb-4">
        Scans the catalogue pages below, matches each photo to a product by its item
        code (e.g. <span className="font-mono">D0018-001-G</span> → <span className="font-mono">D0018-001-GMX.jpg</span>),
        and adds the matched photos to each product's Images gallery. Nothing is changed until you review and click Apply.
      </p>

      <div className="card p-4 space-y-3 mb-4">
        <label className="label">Catalogue page URLs (one per line)</label>
        <textarea className="input font-mono text-xs" rows={7} value={pages}
                  onChange={e => setPages(e.target.value)} />
        <div className="flex items-center gap-3">
          <button onClick={handleScan} disabled={scanning || !pageList.length} className="btn-primary">
            {scanning ? 'Scanning…' : 'Scan & match'}
          </button>
          {poolInfo && <span className="text-xs text-ink-60">{poolInfo.count} images found on {pageList.length} page(s)</span>}
        </div>
        {poolInfo?.errors?.length > 0 && (
          <p className="text-xs text-amber-600">Some pages could not be read: {poolInfo.errors.map(e => e.url).join(', ')}</p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        {done && <p className="text-sm text-emerald-600">{done}</p>}
      </div>

      {rows && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3 sticky top-0 bg-white py-1">
            <p className="text-sm">
              {rows.length === 0
                ? 'No new image matches found.'
                : `${rows.length} product(s) matched · ${selectedCount} image(s) selected`}
            </p>
            {rows.length > 0 && (
              <button onClick={handleApply} disabled={applying || selectedCount === 0} className="btn-primary text-sm">
                {applying ? 'Applying…' : `Apply ${selectedCount} image(s)`}
              </button>
            )}
          </div>

          <div className="space-y-4">
            {rows.map(row => (
              <div key={row.product.id} className="border border-ivory-dark rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">
                    {row.product.design_name || row.product.design_code || row.product.id}
                    <span className="ml-2 text-xs font-mono text-ink-50">{row.product.design_code}</span>
                  </p>
                  <span className="text-xs text-ink-50">{row.existingCount} already · +{row.images.length} new</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2">
                  {row.images.map(img => {
                    const key = `${row.product.id}|${img.url}`
                    const on = !!picked[key]
                    return (
                      <button key={img.url} type="button"
                              onClick={() => setPicked(p => ({ ...p, [key]: !on }))}
                              className={`relative aspect-square bg-white border rounded overflow-hidden ${on ? 'border-brand-500 ring-1 ring-brand-400' : 'border-ivory-dark opacity-50'}`}
                              title={img.filename}>
                        <img src={img.url} alt={img.alt || img.filename} loading="lazy" className="w-full h-full object-contain p-0.5" />
                        {on && <span className="absolute top-0.5 right-0.5 bg-brand-600 text-white text-[9px] px-1 rounded">✓</span>}
                        <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[8px] leading-tight px-0.5 truncate">{img.filename}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
