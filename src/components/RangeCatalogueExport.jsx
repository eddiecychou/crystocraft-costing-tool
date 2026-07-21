import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { pdf } from '@react-pdf/renderer'
import { db } from '../firebase'
import { galleryUrl, designNumber, brandLetter, brandSortRank, RANGE_CRYSTAL_BRANDS } from '../constants'
import { useRates, wsPriceFactor, convertFromUSD, fmtMoney } from '../currency'
import { useCrystalColors } from '../crystalColors'
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
//
// v.description IS the label. The variant editor generates it from plating +
// crystal and lets it be edited, so it is the field the team curates and the
// one place a premium crystal gets spelled out.
//
// Earlier versions of this rebuilt the same sentence from brand_code and
// plating_name. That was the mistake behind every row problem in this
// catalogue: a reconstruction cannot see an edit, so a variant whose
// description had been corrected still printed the generated words, and two
// variants that differ only in an edited description printed identically.
// Falling back to the construction only when description is blank.
function variantLabel(v) {
  const desc = (v.description || '').trim()
  if (desc) return desc
  const brand = BRAND_NAME[v.brand_code] || v.brand_code || ''
  const plating = v.plating_name || v.plating_code || ''
  return [brand && `${brand} Crystals`, plating && `${plating} Plated`].filter(Boolean).join(', ') || '—'
}

// Products whose priced rows still collide after labelling — same code, same
// label, different price. These are the ones whose variant descriptions were
// never filled in, and no amount of formatting can tell them apart.
function ambiguousProducts(list) {
  const out = []
  for (const p of list) {
    const rows = (Array.isArray(p.variants) ? p.variants : [])
      .filter(v => Number(v.ws_price_usd) > 0)
      // Keyed on the printed label, because that is what a reader compares.
      // A blank description falls back to the generated words, which is exactly
      // when two variants collide.
      .map(v => `${v.brand_code || ''}|${v.plating_code || ''}|${variantLabel(v)}`)
    const seen = new Set()
    const clash = rows.some(k => (seen.has(k) ? true : (seen.add(k), false)))
    if (clash) out.push(p)
  }
  return out
}

function brandsOf(p) {
  const variants = Array.isArray(p.variants) ? p.variants : []
  const fallback = brandLetter(p.design_code) || 'D'
  return [...new Set(variants.map(v => v.brand_code || fallback).filter(Boolean))]
}

// The heading code. The Range page leaves the prefix off a multi-brand design
// because D0344-001 and A0344-001 are genuinely different codes — fine on a
// screen where the brand chips sit beside it, wrong in a catalogue, where a
// bare "0344-001" is not orderable. Multi-brand headings therefore show every
// letter the design comes in ("D/A0344-001") and each price row carries its own
// full code. brand_code already contains the whole prefix ("UA"), so nothing is
// appended to it.
function codeOf(p) {
  const designNo = p.design_no || designNumber(p.design_code)
  const brands = brandsOf(p)
  const prefix = brands.length ? brands.join('/') : ''
  return [`${prefix}${designNo}`, p.format_code].filter(Boolean).join('-')
}

// Sort key for a product within its theme. Two parts, in this order:
//
//  1. brandSortRank — the ordering the Range page and the customer shop already
//     share, so the catalogue does not invent a third. It keeps the classic
//     D/A/U/H/M figurines together (all rank 0), then the UA series, UB, then
//     B-series accessories last.
//  2. The code itself, alphabetically. Within rank 0 this is what puts M0014
//     before U0017. Design numbers are zero-padded to four digits, so a plain
//     string compare is also numeric order — D0019 sorts before D0107.
//
// A multi-brand heading reads "D/A0023-001", and the "/" would sort it ahead of
// every plain D code. The key therefore uses the FIRST brand only, so it sorts
// where a reader expects: with the other D0023 items.
function sortKeyOf(p) {
  const brands = brandsOf(p)
  const first = brands[0] || ''
  const designNo = p.design_no || designNumber(p.design_code)
  return {
    rank: brands.length ? Math.min(...brands.map(brandSortRank)) : brandSortRank(first),
    code: [`${first}${designNo}`, p.format_code].filter(Boolean).join('-'),
  }
}

// The orderable code for one variant: brand prefix + design + format + plating.
function variantCode(p, v) {
  const designNo = p.design_no || designNumber(p.design_code)
  const brand = v.brand_code || brandLetter(p.design_code) || 'D'
  return [`${brand}${designNo}`, p.format_code, v.plating_code].filter(Boolean).join('-')
}

// Build the price rows, appending crystal colours only to rows that would
// otherwise read identically. A premium-crystal variant sits beside the plain
// one at the same brand and plating, so without this the pair looks like a
// mistake; with colours on every row, the block becomes the wall of text the
// first draft was cut down from.
function withColourDisambiguation(variants, toRow, coloursOf) {
  const rows = variants.map(v => ({ ...toRow(v), _colours: coloursOf(v) }))
  const seen = new Map()
  for (const r of rows) {
    const k = `${r.code}|${r.plating}`
    seen.set(k, (seen.get(k) || 0) + 1)
  }
  const out = rows.map(r => {
    const ambiguous = seen.get(`${r.code}|${r.plating}`) > 1
    // Truncated: a variant can cover a dozen colours and the point is only to
    // say which option this is, not to enumerate the range.
    const list = r._colours.slice(0, 3).join(', ')
    const more = r._colours.length > 3 ? ` +${r._colours.length - 3}` : ''
    return {
      code: r.code,
      plating: ambiguous && list ? `${r.plating} — ${list}${more}` : r.plating,
      price: r.price,
    }
  })
  return dedupe(out)
}

// Identical brand+plating+price rows can occur when a design carries duplicate
// variant rows; the buyer should see one.
const dedupe = rows => {
  const seen = new Set()
  return rows.filter(r => {
    const k = `${r.code}|${r.plating}|${r.price}`
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
  const { colors } = useCrystalColors()

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

      const colourName = Object.fromEntries((colors || []).map(c => [c.code, c.name]))
      // Which crystal colours a variant covers, as names. Used only to tell two
      // otherwise-identical rows apart.
      const coloursOf = v => (v.crystal_colors || []).map(c => colourName[c] || c)

      const cards = sellable.map((p, i) => {
        const variants = Array.isArray(p.variants) ? p.variants : []
        return {
          key: p.id,
          type: p.design_type || 'Other',
          _sort: sortKeyOf(p),
          // Same rule the Range page uses: a single-brand design carries its
          // prefix (D0002-001), a multi-brand one shows the shared base because
          // the prefix differs per row — and each row names its brand anyway.
          code: codeOf(p),
          name: p.description || '',
          image: dataUrls[i],
          // Made to Order is the norm and is left unmarked; the two
          // exceptions are labelled, because both change what a buyer can
          // actually order and neither is visible from a photograph.
          //   Retired Stock — will not be produced again.
          //   Concept       — not tooled yet, so it cannot be produced AT ALL
          //                   until tooling is made. Quite different from Made
          //                   to Order, and the more expensive one to get wrong.
          note: p.status === 'stock'
            ? 'Retired Stock — no further production, while supplies last'
            : p.status === 'concept'
              ? 'Concept — not yet tooled, enquiry only'
              : '',
          noteKind: p.status === 'stock' ? 'retired' : p.status === 'concept' ? 'concept' : '',
          // One row per BRAND x PLATING, which is what a variant actually is.
          // Unlabelled, these read as a meaningless repeat ("Chrome, Chrome,
          // Gold, Gold…") because the thing that differs — the crystal brand —
          // was not shown. Colour never appears: rangePrice ignores it, so
          // enumerating colours produced dozens of identical prices.
          // Only shown when the heading cannot carry one prefix — otherwise it
          // repeats the heading on every row for no gain.
          // CORRECTION (owner, 2026-07-21): colour DOES affect price. The app's
          // model puts price on the variant, so rangePrice ignores colour — but
          // the team expresses a premium crystal (Golden Teak, Crystal AB, the
          // GX/AX mixes) by splitting it into its own variant at its own price.
          //
          // Dropping colour therefore turned two real options into what looked
          // like a duplicated row: "Bohemia Crystals, Chrome Plated" twice at
          // 5.25 and 5.28. The colours are added back, but ONLY where two rows
          // share a brand and plating — listing them everywhere is what made the
          // first draft unreadable.
          prices: withColourDisambiguation(
            variants.filter(v => Number(v.ws_price_usd) > 0),
            v => ({
              plating: variantLabel(v),
              code: brandsOf(p).length > 1 ? variantCode(p, v) : '',
              price: priceOf(rangePrice(v)),
            }),
            coloursOf,
          ),
        }
      })

      // Themes alphabetically; products within a theme by code. Firestore
      // returns documents in no useful order, so without this the blocks sat in
      // whatever sequence they happened to arrive in.
      const groups = [...new Map(cards.map(c => [c.type, null])).keys()]
        .sort((a, b) => a.localeCompare(b))
        .map(title => ({
          title,
          products: cards
            .filter(c => c.type === title)
            .sort((a, b) => a._sort.rank - b._sort.rank
              || a._sort.code.localeCompare(b._sort.code)),
        }))

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

  // Variant descriptions are hand-entered and, per the owner, often not kept
  // up to date. Where two priced variants are indistinguishable the catalogue
  // has nothing to print but the same row twice — so say which products those
  // are BEFORE the PDF goes to a customer, rather than after they ask.
  const needsAttention = useMemo(() => ambiguousProducts(sellable), [sellable])

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

          {needsAttention.length > 0 && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              <div className="font-medium inline-flex items-center gap-1.5">
                <AlertTriangle size={13} /> {needsAttention.length} product{needsAttention.length === 1 ? '' : 's'} will show rows that look identical
              </div>
              <p className="mt-0.5 text-amber-700/90">
                Two priced variants share a brand, plating and description, so the catalogue cannot tell them apart.
                Fill in the crystal description on those variants to fix it.
              </p>
              <p className="mt-1 font-mono text-[11px] text-amber-900">
                {needsAttention.slice(0, 12).map(p => codeOf(p)).join('  ')}
                {needsAttention.length > 12 ? `  +${needsAttention.length - 12} more` : ''}
              </p>
            </div>
          )}

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
