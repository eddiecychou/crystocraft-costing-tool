import { useState, useEffect, useMemo } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { useParams, Link } from 'react-router-dom'
import { db } from '../firebase'
import { Gem, ArrowLeft, Check, Plus, Minus } from 'lucide-react'
import { designNumber, brandLetter, RANGE_CRYSTAL_BRANDS, normGallery, RANGE_STATUS_CUSTOMER, normVideos, youtubeEmbed } from '../constants'

const BRAND_NAME = Object.fromEntries(RANGE_CRYSTAL_BRANDS.map(b => [b.code, b.name]))
import { useRates, convertFromUSD, fmtMoney, wsPriceFactor } from '../currency'
import { useCrystalColors, colorMap } from '../crystalColors'
import FavHeart from './FavHeart'
import { useCart, designGroupKey, formatGroupKey } from './store'
import { useFormatMoq } from '../formatMoq'
import { RANGE_FORMAT_CODES } from '../constants'

const FORMAT_LABEL = Object.fromEntries(RANGE_FORMAT_CODES.map(f => [f.code, f.label]))
import LoadingBar from '../components/LoadingBar'
import VideoEmbed from '../components/VideoEmbed'
import { useComponents, productAvailability } from '../criticalComponents'
import { useProductDefaults } from '../useProductDefaults'

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
  const [stockPcs, setStockPcs] = useState(1)
  const [orderMode, setOrderMode] = useState('stock')  // 'stock' | 'mto' — for MTO products with available parts
  const [showMoqInfo, setShowMoqInfo] = useState(false)  // expandable "how minimums work"
  const rates = useRates()
  const { colors: libColors } = useCrystalColors()
  const lookup = useMemo(() => colorMap(libColors), [libColors])
  const cart = useCart()
  const { moq: formatMoqMap, labels: formatLabels } = useFormatMoq()
  const { components: compLib } = useComponents()
  const prodDefaults = useProductDefaults()
  const cur = profile?.base_currency || 'USD'
  const factor = wsPriceFactor(profile)

  useEffect(() => onSnapshot(doc(db, 'range_products', id),
    s => setP(s.exists() ? { id: s.id, ...s.data() } : null), () => setP(null)), [id])

  // If the currently selected variant is sold out (last-stock, buildable=0), auto-advance.
  useEffect(() => {
    if (!p || p.status !== 'stock') return
    const vars = docVariants(p)
    const av = productAvailability(p, compLib, prodDefaults)
    if (!av?.byPlating || !Object.keys(av.byPlating).length) return
    const isOut = v => {
      const pc = (v?.plating_code || '').trim().toUpperCase()
      return pc && (av.byPlating[pc] ?? 1) <= 0
    }
    if (isOut(vars[finishIdx])) {
      const next = vars.findIndex(v => !isOut(v))
      if (next >= 0) setFinishIdx(next)
    }
  }, [p, compLib, finishIdx])

  if (p === undefined) return <LoadingBar />
  if (p === null) return <NotFound />

  const net = usd => usd == null ? null : convertFromUSD(usd * factor, profile, rates)
  const variants = docVariants(p)
  const fallbackBrand = brandLetter(p.design_code) || 'D'
  const designNo = p.design_no || designNumber(p.design_code)
  const brands = [...new Set(variants.map(v => v.brand_code || fallbackBrand).filter(Boolean))]
  const multiBrand = brands.length > 1
  // Product-level base code (brand prefix only when the design is single-brand).
  // brand_code already carries the full prefix (e.g. "UA"); never append a body
  // letter or it doubles up (UA + A + 062 = UAA062).
  const baseCode = [`${multiBrand ? '' : brands[0] || ''}${designNo}`, p.format_code].filter(Boolean).join('-')
  const name = p.description || p.design_name || baseCode
  const gallery = normGallery(p.gallery)
  // First gallery image is the chosen hero; variant image is only a fallback.
  const image = gallery[0]?.url || variants.find(v => v.image)?.image || ''
  const mixes = p.crystal_mixes && typeof p.crystal_mixes === 'object' ? p.crystal_mixes : {}
  const colorCodes = [...new Set(variants.flatMap(v => Array.isArray(v.crystal_colors) ? v.crystal_colors : []))]

  const selVariant = variants[finishIdx] || variants[0] || {}
  // Selected-finish SKU code carries the chosen brand prefix (e.g. D0002-001).
  const selBrand = selVariant.brand_code || fallbackBrand
  const code = [`${selBrand}${designNo}`, p.format_code].filter(Boolean).join('-')
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
  const isLastStock = p.status === 'stock'
  // Last-stock: no MOQ (sell whatever is buildable); active: use product moq field.
  const moq = isLastStock ? 0 : (Number(p.moq) || 0)
  // Always compute availability — drives both the promise text and last-stock caps.
  const avail = productAvailability(p, compLib, prodDefaults)
  const selPlating = (selVariant.plating_code || '').trim().toUpperCase()
  // Per-plating buildable: used for last-stock caps and variant availability chips.
  const platBuildable = p2 => {
    if (!avail?.byPlating || !Object.keys(avail.byPlating).length) return null
    const pc = (p2 || '').trim().toUpperCase()
    return pc ? (avail.byPlating[pc] ?? null) : null
  }
  // When per-plating data exists, a plating NOT in byPlating has 0 stock (not total fallback).
  // Only fall back to avail.buildable when there is NO per-plating breakdown at all.
  const hasByPlating = avail?.byPlating && Object.keys(avail.byPlating).length > 0
  const selBuildable = hasByPlating
    ? (avail.byPlating[selPlating] ?? 0)
    : (avail?.buildable ?? 0)
  const hasSelStock = !isLastStock && selBuildable > 0   // MTO product with parts on hand for this plating
  // Effective order mode: last-stock always uses stock (pcs); MTO uses the toggle
  const effectiveMode = isLastStock ? 'stock' : (hasSelStock ? orderMode : 'mto')
  const maxPcs = (isLastStock || effectiveMode === 'stock') ? selBuildable : Infinity
  const maxCartons = ppc > 0 ? Math.floor(maxPcs / ppc) : maxPcs
  const pcs = effectiveMode === 'stock' ? stockPcs : (ppc > 0 ? cartons * ppc : cartons)
  // MOQ applies across every variation AND format of this design (same body /
  // design number — freestand, music box, bible, …), so include any pieces of
  // the same design already sitting in the enquiry cart.
  const lineLike = { type: 'figurine', id: p.id, design_no: designNo, code, format_code: p.format_code || '' }
  const thisGroup = designGroupKey(lineLike)
  const cartDesignPcs = (cart?.items || [])
    .filter(it => designGroupKey(it) === thisGroup)
    .reduce((s, it) => s + Math.max(1, Number(it.qty) || 1), 0)
  const designPcs = cartDesignPcs + (inCart ? 0 : pcs)
  const belowMoq = moq > 0 && designPcs < moq

  // Format base component MOQ (e.g. music box), pooled across all designs that
  // share this format. Configured in admin Settings (settings/format_moq).
  const fmtCode = p.format_code || ''
  const fmtMoq = Number(formatMoqMap[fmtCode]) || 0
  const fmtGroup = formatGroupKey(lineLike)
  const cartFormatPcs = (cart?.items || [])
    .filter(it => formatGroupKey(it) === fmtGroup)
    .reduce((s, it) => s + Math.max(1, Number(it.qty) || 1), 0)
  const formatPcs = cartFormatPcs + (inCart ? 0 : pcs)
  const belowFormatMoq = fmtMoq > 0 && formatPcs < fmtMoq
  const fmtLabel = formatLabels[fmtCode] || FORMAT_LABEL[fmtCode] || `format ${fmtCode}`

  const pickFinish = i => {
    setFinishIdx(i)
    const v = variants[i] || {}
    const fc = (Array.isArray(v.crystal_colors) && v.crystal_colors.length) ? v.crystal_colors : colorCodes
    setColor(c => (c && fc.includes(c)) ? c : null)
    setStockPcs(1)
    setOrderMode('stock')   // default to from-stock mode when switching plating
  }

  const addToEnquiry = () => {
    if (!canAdd) return
    cart?.add({
      type: 'figurine', id: p.id, name, code,
      design_no: designNo || '',
      format_code: p.format_code || '',
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
          {(() => {
            const st = RANGE_STATUS_CUSTOMER[p.status === 'stock' ? 'stock' : 'active']
            return (
              <div className="mb-2">
                <span className={`badge ${st.cls}`}>{st.label}</span>
                <p className="text-xs text-ink-50 mt-1">
                  {avail?.customerPromise || avail?.promise || st.tip}
                </p>
              </div>
            )
          })()}
          <h1 className="text-xl md:text-2xl text-ink">{name}</h1>
          <p className="text-sm text-ink-60 font-mono mt-1">{code}</p>
          {p.size && <p className="text-sm text-ink-60 mt-1">{p.size}</p>}
          {p.design_type && <p className="text-xs text-ink-50 mt-1">{p.design_type}</p>}
          {p.marketing_description && (
            <p className="text-sm text-ink-70 leading-relaxed mt-3">{p.marketing_description}</p>
          )}

          {/* Plating finish — select one (doubles as price list) */}
          <div className="mt-5">
            <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-2">
              Plating finish {!inCart && <span className="text-red-500">*</span>}
              <span className="normal-case text-ink-40"> · Ex-factory price ({cur})</span>
            </p>
            <div className="card divide-y divide-ivory-dark">
              {variants.map((v, i) => {
                const sel = i === finishIdx
                const vPlat = (v.plating_code || '').trim().toUpperCase()
                const vStock = isLastStock ? platBuildable(vPlat) : null
                const soldOut = isLastStock && vStock != null && vStock <= 0
                if (soldOut) return null   // hide sold-out platings for last-stock
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
                      {vStock != null && vStock > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${isLastStock ? (vStock < 50 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700') : 'bg-sky-100 text-sky-700'}`}>
                          {isLastStock ? `${vStock} left` : `${vStock} in stock`}
                        </span>
                      )}
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
              {colorValid && mixes[color] && Array.isArray(mixes[color]) && mixes[color].length > 0 && (
                <p className="text-xs text-ink-50 mt-1.5">
                  Mix: {mixes[color].map(c => lookup[c]?.name || c).join(' + ')}
                </p>
              )}
            </div>
          )}

          {/* Quantity */}
          {!inCart && (
            <div className="mt-4">
              {/* Mode toggle — only for MTO products that have stock on hand for this plating */}
              {hasSelStock && (
                <div className="flex rounded-md border border-ivory-dark overflow-hidden mb-3 text-xs">
                  <button type="button" onClick={() => { setOrderMode('stock'); setStockPcs(1) }}
                    className={`flex-1 px-3 py-1.5 text-left transition-colors ${effectiveMode === 'stock' ? 'bg-brand-50 text-brand-700 font-medium' : 'hover:bg-ivory text-ink-60'}`}>
                    From stock · <span className="font-medium">{selBuildable} pcs available</span> · any qty · fast
                  </button>
                  <button type="button" onClick={() => { setOrderMode('mto'); setCartons(1) }}
                    className={`flex-1 px-3 py-1.5 text-left border-l border-ivory-dark transition-colors ${effectiveMode === 'mto' ? 'bg-brand-50 text-brand-700 font-medium' : 'hover:bg-ivory text-ink-60'}`}>
                    Make to order · cartons · MOQ applies
                  </button>
                </div>
              )}
              <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-1.5">
                {effectiveMode === 'stock'
                  ? <>Quantity <span className="normal-case text-ink-40">· pcs{isLastStock ? ` (max ${maxPcs})` : ''}</span></>
                  : <>Quantity {ppc > 0 && <span className="normal-case text-ink-40">· {ppc} pcs/carton</span>}</>}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="inline-flex items-center border border-ivory-dark rounded-md overflow-hidden">
                  {effectiveMode === 'stock' ? (
                    <>
                      <button type="button" onClick={() => setStockPcs(n => Math.max(1, n - 1))}
                        className="px-2.5 py-2 hover:bg-ivory text-ink-70" aria-label="Decrease"><Minus size={14} /></button>
                      <input type="number" min="1" max={maxPcs > 0 ? maxPcs : undefined} value={stockPcs}
                        onChange={e => setStockPcs(Math.min(maxPcs, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
                        className="w-16 text-center text-sm py-1.5 outline-none border-x border-ivory-dark" />
                      <button type="button" onClick={() => setStockPcs(n => Math.min(maxPcs, n + 1))}
                        className="px-2.5 py-2 hover:bg-ivory text-ink-70" aria-label="Increase"><Plus size={14} /></button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setCartons(c => Math.max(1, c - 1))}
                        className="px-2.5 py-2 hover:bg-ivory text-ink-70" aria-label="Decrease"><Minus size={14} /></button>
                      <input type="number" min="1" value={cartons}
                        onChange={e => setCartons(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                        className="w-14 text-center text-sm py-1.5 outline-none border-x border-ivory-dark" />
                      <button type="button" onClick={() => setCartons(c => c + 1)}
                        className="px-2.5 py-2 hover:bg-ivory text-ink-70" aria-label="Increase"><Plus size={14} /></button>
                    </>
                  )}
                </div>
                <span className="text-sm text-ink-60">
                  {effectiveMode === 'stock'
                    ? `${stockPcs.toLocaleString()} pcs`
                    : ppc > 0 ? `${cartons} carton${cartons > 1 ? 's' : ''} = ${pcs.toLocaleString()} pcs` : `${pcs.toLocaleString()} pcs`}
                </span>
              </div>
              {selVariant.ws_price_usd != null && colorValid && (
                <p className="text-sm text-ink mt-2">Subtotal: <span className="font-medium">{fmtMoney(net(selVariant.ws_price_usd) * pcs, cur)}</span></p>
              )}
              {effectiveMode === 'stock' && !isLastStock && (
                <p className="text-[11px] mt-1.5 text-sky-700">
                  Fulfilling from available stock — no minimum quantity applies.
                </p>
              )}
              {effectiveMode === 'mto' && (moq > 0 || fmtMoq > 0) && (
                <div className="text-[11px] mt-1.5">
                  {/* Concise headline — the numbers customers scan for */}
                  <p className={belowMoq || belowFormatMoq ? 'text-amber-700' : 'text-ink-50'}>
                    Made to order
                    {moq > 0 && <> · min <span className="font-medium">{moq.toLocaleString()}</span>/design</>}
                    {fmtMoq > 0 && <> · {fmtLabel} min <span className="font-medium">{fmtMoq.toLocaleString()}</span> (shared)</>}
                    {(belowMoq || belowFormatMoq) && <span> — below minimum</span>}
                    <button type="button" onClick={() => setShowMoqInfo(v => !v)}
                      className="ml-1.5 underline text-ink-40 hover:text-ink-60">
                      {showMoqInfo ? 'less' : 'how minimums work'}
                    </button>
                  </p>
                  {/* The nuance, tucked away */}
                  {showMoqInfo && (
                    <ul className="mt-1 space-y-0.5 text-ink-50 list-disc list-inside">
                      {moq > 0 && <li>Minimum {moq.toLocaleString()} pcs per design. Below this we confirm feasibility on your quotation.</li>}
                      {fmtMoq > 0 && <li>{fmtLabel} base needs {fmtMoq.toLocaleString()} pcs total — combine with other {fmtLabel.toLowerCase()} designs to reach it.</li>}
                    </ul>
                  )}
                </div>
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
            Ex-factory prices — freight not included. Final pricing and availability confirmed on enquiry.
          </p>
        </div>
      </div>

      {(() => {
        const videos = normVideos(p.videos, p.video_url).filter(youtubeEmbed)
        if (!videos.length) return null
        return (
          <div className="mt-8 max-w-2xl">
            <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-3">
              {videos.length > 1 ? 'Product videos' : 'Product video'}
            </p>
            <div className="space-y-4">
              {videos.map((v, i) => <VideoEmbed key={i} url={v} title={`${name} video ${i + 1}`} />)}
            </div>
          </div>
        )
      })()}

      {gallery.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-label uppercase tracking-wide text-ink-50 mb-3">Reference photos</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {gallery.map((g, i) => (
              <figure key={i} className="card overflow-hidden">
                <div className="aspect-square bg-white flex items-center justify-center overflow-hidden">
                  <img src={g.url} alt={g.caption || name} className="w-full h-full object-contain p-2" />
                </div>
                {g.caption && (
                  <figcaption className="px-2 py-1.5 text-[11px] text-ink-60 border-t border-ivory-dark truncate" title={g.caption}>
                    {g.caption}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </div>
      )}
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
  // Faceted-gem swatch: octagon clip + a diagonal gloss overlay so it reads as
  // cut crystal. The outer frame (padding + clip) doubles as the border/selected
  // ring, since a clip-path would otherwise clip a normal box-shadow ring.
  const OCT = 'polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%)'
  const GLOSS = 'linear-gradient(135deg, rgba(255,255,255,.55) 0 38%, rgba(255,255,255,0) 39% 60%, rgba(0,0,0,.10) 61% 100%)'
  // Read-only swatch (no onClick): small inline gem.
  if (!onClick) {
    return (
      <span className="inline-block" title={title}
        style={{ width: 16, height: 16, clipPath: OCT, background: bg }} />
    )
  }
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      className="transition-transform hover:scale-110"
      style={{ width: 30, height: 30, padding: 2, clipPath: OCT,
               background: selected ? '#c8a951' : 'rgba(0,0,0,0.14)' }}>
      <span style={{ display: 'block', width: '100%', height: '100%', clipPath: OCT, background: bg, position: 'relative' }}>
        <span style={{ position: 'absolute', inset: 0, clipPath: OCT, background: GLOSS }} />
      </span>
    </button>
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
