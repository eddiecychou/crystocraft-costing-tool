import { useState, useEffect, useMemo } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { useParams, Link } from 'react-router-dom'
import { db } from '../firebase'
import { Gem, ArrowLeft, Check, Plus, Minus } from 'lucide-react'
import { designNumber, brandLetter, bodyLetter, RANGE_CRYSTAL_BRANDS } from '../constants'

const BRAND_NAME = Object.fromEntries(RANGE_CRYSTAL_BRANDS.map(b => [b.code, b.name]))
import { useRates, fromUSD, fmtMoney } from '../currency'
import { useCrystalColors, colorMap } from '../crystalColors'
import FavHeart from './FavHeart'
import { useCart, designGroupKey } from './store'
import LoadingBar from '../components/LoadingBar'

function docVariants(p) {
  if (Array.isArray(p.variants) && p.variants.length) return p.variants
  return (p.finishes || []).map(f => ({
    plating_name: f.finish_name, sku: f.sku,
    ws_price_usd: f.ws_price_usd, stock_finished: f.stock_finished, image: f.image,
  }))
}

export default function FigurineDetail({ profile }) {
  const { id } = useParams()
  const [p, setP] = useState(undefined)
  const [finishIdx, setFinishIdx] = useState(0)
  const [color, setColor] = useState(null)
  const [cartons, setCartons] = useState(1)
  const rates = useRates()
  const { colors: libColors } = useCrystalColors()
  const lookup = useMemo(() => colorMap(libColors), [libColors])
  const cart = useCart()
  const cur = profile?.base_currency || 'USD'
  const disc = Math.max(0, Math.min(100, Number(profile?.ws_discount_pct) || 0)) / 100

  useEffect(() => onSnapshot(doc(db, 'range_products', id),
    s => setP(s.exists() ? { id: s.id, ...s.data() } : null), () => setP(null)), [id])

  if (p === undefined) return <LoadingBar />
  if (p === null) return <NotFound />

  const net = usd => usd == null ? null : fromUSD(usd * (1 - disc), cur, rates)
  const variants = docVariants(p)
  const fallbackBrand = brandLetter(p.design_code) || 'D'
  const designNo = p.design_no || designNumber(p.design_code)
  const body = p.body_code || bodyLetter(p.design_code)
  const brands = [...new Set(variants.map(v => v.brand_code || fallbackBrand).filter(Boolean))]
  const multiBrand = brands.length > 1
  // Product-level base code (brand prefix only when the design is single-brand).
  const baseCode = [`${multiBrand ? '' : brands[0] || ''}${body}${designNo}`, p.format_code].filter(Boolean).join('-')
  const name = p.description || p.design_name || baseCode
  const image = variants.find(v => v.image)?.image || (Array.isArray(p.gallery) && p.gallery[0]) || ''
  const mixes = p.crystal_mixes && typeof p.crystal_mixes === 'object' ? p.crystal_mixes : {}
  const colorCodes = [...new Set(variants.flatMap(v => Array.isArray(v.crystal_colors) ? v.crystal_colors : []))]

  const selVariant = variants[finishIdx] || variants[0] || {}
  // Selected-finish SKU code carries the chosen brand prefix (e.g. D0002-001).
  const selBrand = selVariant.brand_code || fallbackBrand
  const code = [`${selBrand}${body}${designNo}`, p.format_code].filter(Boolean).join('-')
  const finishColors = (Array.isArray(selVariant.crystal_colors) && selVariant.crystal_colors.length)
    ? selVariant.crystal_colors : colorCodes
  const needsColor = colorCodes.length > 0
  const colorValid = !!color && finishColors.includes(color)
  const canAdd = !needsColor || colorValid
  // In-cart status reflects the specific selected SKU (plating + colour).
  const inCart = cart?.has({
    type: 'figurine', id: p.id,
    finish: selVariant.plating_name || selVariant.plating_code || '',
    color: needsColor ? (color || '') : '',
  })

  const ppc = Number(p.packing?.pcs_per_carton) || 0    // pcs per carton (0 = unknown)
  const moq = Number(p.moq) || 0                          // design-level made-to-order minimum
  const pcs = ppc > 0 ? cartons * ppc : cartons           // total pieces ordered (this selection)
  // MOQ applies across every variation AND format of this design (same body /
  // design number — freestand, music box, bible, …), so include any pieces of
  // the same design already sitting in the enquiry cart.
  const thisGroup = designGroupKey({ type: 'figurine', id: p.id, design_no: designNo, code })
  const cartDesignPcs = (cart?.items || [])
    .filter(it => designGroupKey(it) === thisGroup)
    .reduce((s, it) => s + Math.max(1, Number(it.qty) || 1), 0)
  const designPcs = cartDesignPcs + (inCart ? 0 : pcs)
  const belowMoq = moq > 0 && designPcs < moq

  const pickFinish = i => {
    setFinishIdx(i)
    const v = variants[i] || {}
    const fc = (Array.isArray(v.crystal_colors) && v.crystal_colors.length) ? v.crystal_colors : colorCodes
    setColor(c => (c && fc.includes(c)) ? c : null)
  }

  const addToEnquiry = () => {
    if (!canAdd) return
    cart?.add({
      type: 'figurine', id: p.id, name, code,
      design_no: designNo || '',
      image: selVariant.image || image,
      finish: selVariant.plating_name || selVariant.plating_code || '',
      finish_sku: selVariant.sku || '',
      color: needsColor ? color : '',
      color_name: needsColor ? (lookup[color]?.name || '') : '',
      ws_price_usd: selVariant.ws_price_usd ?? null,
      pcs_per_carton: ppc,
      cartons: ppc > 0 ? cartons : 0,
      qty: pcs,
      moq,
    })
  }

  return (
    <div>
      <Link to="/shop/figurine" className="inline-flex items-center gap-1 text-sm text-ink-60 hover:text-ink mb-4">
        <ArrowLeft size={15} /> Back to Figurine Gifts
      </Link>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="card overflow-hidden bg-white aspect-square flex items-center justify-center relative">
          {(selVariant.image || image) ? <img src={selVariant.image || image} alt={name} className="w-full h-full object-contain p-4" />
            : <Gem size={56} className="text-gray-200" />}
          <FavHeart item={{ type: 'figurine', id: p.id, name, code: baseCode, image }} className="absolute top-3 right-3" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl text-ink">{name}</h1>
          <p className="text-sm text-ink-60 font-mono mt-1">{code}</p>
          {p.size && <p className="text-sm text-ink-60 mt-1">{p.size}</p>}
          {p.design_type && <p className="text-xs text-ink-50 mt-1">{p.design_type}</p>}

          {/* Plating finish — select one (doubles as price list) */}
          <div className="mt-5">
            <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-2">
              Plating finish {!inCart && <span className="text-red-500">*</span>}
              <span className="normal-case text-ink-40"> · {cur}{disc > 0 ? `, your ${(disc * 100).toFixed(disc * 100 % 1 ? 1 : 0)}% discount` : ''}</span>
            </p>
            <div className="card divide-y divide-ivory-dark">
              {variants.map((v, i) => {
                const sel = i === finishIdx
                return (
                  <button key={i} type="button" onClick={() => pickFinish(i)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-left transition-colors ${sel ? 'bg-brand-50' : 'hover:bg-ivory'}`}>
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`w-3.5 h-3.5 rounded-full border shrink-0 ${sel ? 'border-brand-500 bg-brand-500' : 'border-ink-30'}`}>
                        {sel && <Check size={12} className="text-white" strokeWidth={3} />}
                      </span>
                      <span className="text-ink truncate">
                        {v.plating_name || v.plating_code || '—'}
                        {multiBrand && (v.brand_name || BRAND_NAME[v.brand_code || fallbackBrand]) &&
                          <span className="text-ink-50"> · {v.brand_name || BRAND_NAME[v.brand_code || fallbackBrand]}</span>}
                      </span>
                    </span>
                    <span className="text-ink font-medium shrink-0">{fmtMoney(net(v.ws_price_usd), cur)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Crystal colour — required pick */}
          {needsColor && (
            <div className="mt-4">
              <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-1.5">
                Crystal colour {!inCart && <span className="text-red-500">*</span>}
                {colorValid && <span className="normal-case text-ink-60"> · {lookup[color]?.name || color}</span>}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {finishColors.map(c => (
                  <Swatch key={c} code={c} mixes={mixes} lookup={lookup}
                    selected={color === c} onClick={() => setColor(c)} />
                ))}
              </div>
            </div>
          )}

          {/* Quantity — wholesale, ordered by carton */}
          {!inCart && (
            <div className="mt-4">
              <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-1.5">
                Quantity {ppc > 0 && <span className="normal-case text-ink-40">· {ppc} pcs/carton</span>}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="inline-flex items-center border border-ivory-dark rounded-md overflow-hidden">
                  <button type="button" onClick={() => setCartons(c => Math.max(1, c - 1))}
                    className="px-2.5 py-2 hover:bg-ivory text-ink-70" aria-label="Decrease"><Minus size={14} /></button>
                  <input type="number" min="1" value={cartons}
                    onChange={e => setCartons(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                    className="w-14 text-center text-sm py-1.5 outline-none border-x border-ivory-dark" />
                  <button type="button" onClick={() => setCartons(c => c + 1)}
                    className="px-2.5 py-2 hover:bg-ivory text-ink-70" aria-label="Increase"><Plus size={14} /></button>
                </div>
                <span className="text-sm text-ink-60">
                  {ppc > 0 ? `${cartons} carton${cartons > 1 ? 's' : ''} = ${pcs.toLocaleString()} pcs` : `${pcs.toLocaleString()} pcs`}
                </span>
              </div>
              {selVariant.ws_price_usd != null && colorValid && (
                <p className="text-sm text-ink mt-2">Subtotal: <span className="font-medium">{fmtMoney(net(selVariant.ws_price_usd) * pcs, cur)}</span></p>
              )}
              {moq > 0 && (
                <p className={`text-[11px] mt-1.5 ${belowMoq ? 'text-amber-700' : 'text-ink-50'}`}>
                  Made to order · minimum {moq.toLocaleString()} pcs per design
                  {belowMoq && ' — below the minimum, we will confirm feasibility on quotation'}
                </p>
              )}
            </div>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button onClick={addToEnquiry}
              disabled={inCart || !canAdd}
              className={`btn-primary ${(inCart || !canAdd) ? 'opacity-60 pointer-events-none' : ''}`}>
              {inCart ? <><Check size={16} /> In enquiry</> : <><Plus size={16} /> Add to enquiry</>}
            </button>
            {!inCart && needsColor && !colorValid && <span className="text-xs text-ink-50">Select a crystal colour</span>}
            {inCart && <span className="text-xs text-ink-50">Adjust quantity in your enquiry list</span>}
          </div>

          <p className="text-[11px] text-ink-40 mt-3">
            Prices are indicative wholesale rates. Final pricing and availability confirmed on enquiry.
          </p>
        </div>
      </div>
    </div>
  )
}

function Swatch({ code, mixes, lookup, selected, onClick }) {
  const ASSORTED = 'repeating-conic-gradient(#bbb 0% 25%, #eee 0% 50%)'
  const single = lookup[code]
  let bg = ASSORTED
  let title = single?.name ? `${code} — ${single.name}` : code
  if (single?.swatch) bg = single.swatch
  else if (mixes && Array.isArray(mixes[code]) && mixes[code].length) {
    const cols = mixes[code].map(c => lookup[c]?.swatch).filter(Boolean).slice(0, 3)
    if (cols.length >= 2) {
      const seg = 100 / cols.length
      bg = `conic-gradient(${cols.map((c, i) => `${c} ${i * seg}% ${(i + 1) * seg}%`).join(', ')})`
    } else if (cols.length === 1) bg = cols[0]
    title = `${code} (mix): ${mixes[code].join(', ')}`
  }
  // Read-only swatch (no onClick): small inline dot.
  if (!onClick) {
    return <span className="inline-block w-4 h-4 rounded-full border border-black/10" style={{ background: bg }} title={title} />
  }
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${selected ? 'ring-2 ring-brand-500 ring-offset-2' : 'ring-1 ring-black/10'}`}
      style={{ background: bg }} />
  )
}

function NotFound() {
  return (
    <div className="text-center py-20 text-ink-60">
      <p>This product is no longer available.</p>
      <Link to="/shop/figurine" className="text-brand-600 text-sm mt-2 inline-block">Back to catalogue</Link>
    </div>
  )
}
