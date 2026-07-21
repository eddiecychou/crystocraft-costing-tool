import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { pdf } from '@react-pdf/renderer'
import { db } from '../firebase'
import { galleryUrl, designNumber, brandLetter, RANGE_CRYSTAL_BRANDS } from '../constants'
import { useRates, wsPriceFactor, convertFromUSD, fmtMoney } from '../currency'
import { rangePrice } from '../rangeSku'
import RangeCataloguePDF from './RangeCataloguePDF'
import { X, BookOpen, Loader2, AlertTriangle } from 'lucide-react'

// Fetch an image and inline it. react-pdf cannot follow a Firebase Storage URL
// reliably from a blob context, so bytes are pulled through the same proxy the
// quote export uses and embedded as a data URI.
async function imageToDataURL(url) {
  if (!url) return null
  try {
    let buf
    try {
      const res = await fetch(`/api/download-image?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error('proxy failed')
      buf = await res.arrayBuffer()
    } catch {
      const res = await fetch(url)
      buf = await res.arrayBuffer()
    }
    const mime = url.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg'
    let binary = ''
    const bytes = new Uint8Array(buf)
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    return `data:${mime};base64,${btoa(binary)}`
  } catch {
    return null      // a missing image is a blank box, never a failed catalogue
  }
}

// Bounded concurrency. The whole range is hundreds of images; firing them all
// at once buries the proxy and the browser, and doing them one at a time is
// unbearably slow. Six is enough to saturate without either.
async function mapLimit(items, limit, fn, onProgress) {
  const out = new Array(items.length)
  let next = 0, done = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
      onProgress?.(++done, items.length)
    }
  }))
  return out
}

const BRAND_NAME = Object.fromEntries(RANGE_CRYSTAL_BRANDS.map(b => [b.code, b.name]))

// "Bohemia Crystals, Gold Plated" — the row label a buyer can actually order
// from. A variant is a brand x plating pair, and showing only the plating made
// several rows look identical.
function variantLabel(v) {
  const brand = BRAND_NAME[v.brand_code] || v.brand_code || ''
  const plating = v.plating_name || v.plating_code || ''
  return [brand && `${brand} Crystals`, plating && `${plating} Plated`].filter(Boolean).join(', ') || '—'
}

// Same code rule as the Range page: prefix when the design has one brand,
// shared base when it spans several. brand_code already carries the full
// prefix ("UA"), so nothing is appended to it.
function codeOf(p) {
  const variants = Array.isArray(p.variants) ? p.variants : []
  const fallback = brandLetter(p.design_code) || 'D'
  const designNo = p.design_no || designNumber(p.design_code)
  const brands = [...new Set(variants.map(v => v.brand_code || fallback).filter(Boolean))]
  const prefix = brands.length === 1 ? brands[0] : ''
  return [`${prefix}${designNo}`, p.format_code].filter(Boolean).join('-')
}

// Identical brand+plating+price rows can occur when a design carries duplicate
// variant rows; the buyer should see one.
const dedupe = rows => {
  const seen = new Set()
  return rows.filter(r => {
    const k = `${r.plating}|${r.price}`
    if (seen.has(k)) return false
    seen.add(k); return true
  })
}

export default function RangeCatalogueExport({ onClose }) {
  const [accounts, setAccounts] = useState([])
  const [products, setProducts] = useState([])
  const [accountId, setAccountId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)   // { done, total }
  const [error, setError] = useState('')
  const rates = useRates()

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'range_products')),
    ]).then(([u, p]) => {
      setAccounts(
        u.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(x => x.role === 'customer' && x.status === 'approved')
          .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '')),
      )
      setProducts(p.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }).catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const profile = useMemo(
    () => accounts.find(a => a.id === accountId) || null,
    [accounts, accountId],
  )

  // Only what a customer may see: visible, not retired. Same test the
  // storefront uses, so the catalogue can never show more than the shop.
  const sellable = useMemo(
    () => products.filter(p => p.active !== false && p.status !== 'retired'),
    [products],
  )

  async function build() {
    setBusy(true); setError(''); setProgress(null)
    try {
      const factor = wsPriceFactor(profile)
      const cur = profile?.base_currency || 'USD'

      const priceOf = (usd) => {
        const net = Number(usd) > 0 ? Number(usd) * factor : null
        const conv = net == null ? null : convertFromUSD(net, profile, rates)
        return conv == null ? '—' : fmtMoney(conv, cur)
      }

      // Hero images, fetched once per product with a progress readout.
      const heroes = sellable.map(p => galleryUrl(p.gallery?.[0])
        || (Array.isArray(p.variants) ? p.variants.find(v => v.image)?.image : '') || '')
      const dataUrls = await mapLimit(heroes, 6, imageToDataURL,
        (done, total) => setProgress({ done, total }))

      const cards = sellable.map((p, i) => {
        const variants = Array.isArray(p.variants) ? p.variants : []
        return {
          key: p.id,
          type: p.design_type || 'Other',
          // Same rule the Range page uses: a single-brand design carries its
          // prefix (D0002-001), a multi-brand one shows the shared base because
          // the prefix differs per row — and each row names its brand anyway.
          code: codeOf(p),
          name: p.description || '',
          image: dataUrls[i],
          // One row per BRAND x PLATING, which is what a variant actually is.
          // Unlabelled, these read as a meaningless repeat ("Chrome, Chrome,
          // Gold, Gold…") because the thing that differs — the crystal brand —
          // was not shown. Colour never appears: rangePrice ignores it, so
          // enumerating colours produced dozens of identical prices.
          prices: dedupe(variants
            .filter(v => Number(v.ws_price_usd) > 0)
            .map(v => ({ plating: variantLabel(v), price: priceOf(rangePrice(v)) }))),
        }
      })

      const groups = [...new Map(cards.map(c => [c.type, null])).keys()]
        .sort((a, b) => a.localeCompare(b))
        .map(title => ({ title, products: cards.filter(c => c.type === title) }))

      const validity = `Prices valid 30 days from issue · ${cur}`
      const blob = await pdf(
        <RangeCataloguePDF
          account={profile ? (profile.name || profile.email || '') : ''}
          currency={cur}
          validity={validity}
          groups={groups}
          generatedAt={new Date()}
        />,
      ).toBlob()

      const stem = ['Crystocraft Catalogue', profile?.name || profile?.email, new Date().toISOString().slice(0, 10)]
        .filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]/g, '-')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${stem}.pdf`; a.click()
      URL.revokeObjectURL(url)
      onClose?.()
    } catch (e) {
      setError(e.message || 'Could not build the catalogue.')
    } finally {
      setBusy(false); setProgress(null)
    }
  }

  // Priced brand x plating rows — what the catalogue actually lists. Counting
  // colour permutations here would advertise a number the document no longer
  // contains.
  const lineCount = useMemo(
    () => sellable.reduce((n, p) => n + (Array.isArray(p.variants)
      ? p.variants.filter(v => Number(v.ws_price_usd) > 0).length : 0), 0),
    [sellable],
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900 inline-flex items-center gap-2">
            <BookOpen size={16} className="text-brand-600" /> Full range catalogue
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5">
          <label className="block mb-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Trade account</span>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} disabled={loading || busy}
              className="mt-1 w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg">
              <option value="">— list price, USD (no account) —</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name || a.email}</option>
              ))}
            </select>
          </label>

          {/* The pricing basis, stated plainly. ws_discount_pct is the % of list
              the account PAYS — 90 is a discount, 130 a markup — so calling it a
              discount anywhere would be wrong. */}
          <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3 space-y-0.5">
            <div>{sellable.length} products · {lineCount.toLocaleString()} priced options · visible, non-retired only</div>
            <div>
              Prices: <strong>{profile ? `${Number(profile.ws_discount_pct) || 100}% of list` : '100% of list'}</strong>
              {' · '}<strong>{profile?.base_currency || 'USD'}</strong>
              {Number(profile?.fx_rate) > 0 && <> · fixed rate {profile.fx_rate}</>}
            </div>
          </div>

          {progress && (
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Fetching images…</span><span>{progress.done} / {progress.total}</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-brand-500 transition-all"
                     style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={build} disabled={loading || busy || !sellable.length}
            className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-40">
            {busy ? <><Loader2 size={14} className="animate-spin" /> Building…</> : <>Build PDF</>}
          </button>
        </div>
      </div>
    </div>
  )
}
