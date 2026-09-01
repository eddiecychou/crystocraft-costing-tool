import { useState, useEffect } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db, auth } from '../firebase'
import { useCrystalColors } from '../crystalColors'
import { parseRangeVariantSuffix } from '../rangeSku'
import { generateColourPreview, uploadColourPreview, pickGalleryColourPreview, promoteColourImage, markUsable } from '../colourPreviewApi'
import { Sparkles, Plus, ZoomIn, Download, X } from 'lucide-react'

// Same download-through-proxy pattern as RangeForm.jsx's downloadRangeImage
// — a plain <a download> is silently ignored for a cross-origin Storage URL.
function downloadColourImage(url, baseName) {
  if (!url) return
  const safe = (baseName || 'image').replace(/[/\\?%*:|"<>]/g, '-').trim() || 'image'
  const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || 'jpg').toLowerCase()
  const filename = `${safe}.${ext}`
  const a = document.createElement('a')
  a.href = `/api/download-image?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// The range-product half of the line-image picker (V8.8 Phase 2, §P2.3a) —
// used from both LineImagePicker.jsx (Shipment/Proforma/Sales Invoice) and
// QuoteDetail.jsx's ProductImagePicker. Deliberately reads only
// variant.colour_images ("usable" tier), never gallery[] — see
// Range_Colour_Preview_Spec.md §P2.1 for why the two must stay separate.
//
// itemCode (the line's own raw SKU, e.g. "D0002-001-GPI") is parsed
// best-effort to pre-select which variant/colour this line is actually for.
// A parse miss just means no plating is pre-selected — it never blocks
// picking or generating manually.
export default function RangeColourImagePicker({ productId, itemCode, selectedUrl, onSelect }) {
  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [variantIndex, setVariantIndex] = useState(null)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [zoomUrl, setZoomUrl] = useState(null)
  const [galleryPickerOpen, setGalleryPickerOpen] = useState(false)
  const { colors: libColors } = useCrystalColors()

  useEffect(() => {
    let alive = true
    getDoc(doc(db, 'range_products', productId)).then(snap => {
      if (!alive) return
      const data = snap.exists() ? { id: snap.id, ...snap.data() } : null
      setProduct(data)
      const parsed = parseRangeVariantSuffix(itemCode)
      const variants = data?.variants || []
      const vi = parsed ? variants.findIndex(v => (v.plating_code || '').toUpperCase() === parsed.plating_code) : -1
      setVariantIndex(vi >= 0 ? vi : (variants.length === 1 ? 0 : null))
      if (parsed?.crystal_code) setTarget(parsed.crystal_code)
      setLoading(false)
    })
    return () => { alive = false }
  }, [productId, itemCode])

  const variant = variantIndex != null ? product?.variants?.[variantIndex] : null
  const colourImages = variant?.colour_images || {}
  const parsed = parseRangeVariantSuffix(itemCode)
  const targetInfo = libColors.find(c => c.code === target)

  async function runGenerate() {
    if (!variant?.image || !target || busy) return
    setBusy(true); setError('')
    try {
      const { id, generatedImageUrl } = await generateColourPreview({
        docId: productId, variantIndex, sourceImageUrl: variant.image,
        sourcePlatingCode: variant.plating_code, sourceCrystalCode: variant.crystal_code,
        sourceCrystalName: variant.crystal_name,
        targetCrystalCode: target, targetCrystalName: targetInfo?.name || target,
        targetSwatchHex: targetInfo?.swatch, createdBy: auth.currentUser?.email || '',
      })
      // Seeing the single result and choosing to use it right here on the
      // invoice/PI/quote line IS the review — no separate approve step, and
      // markUsable keeps the source range_colour_previews doc's own status
      // in sync so it doesn't sit there looking like an unreviewed draft if
      // someone later opens the product page (bug found 2026-08-23).
      await markUsable({ id, docId: productId, variantIndex, targetCrystalCode: target, generatedImageUrl })
      await promoteColourImage(productId, variantIndex, target, generatedImageUrl)
      setProduct(p => {
        const variants = [...p.variants]
        variants[variantIndex] = { ...variants[variantIndex], colour_images: { ...(variants[variantIndex].colour_images || {}), [target]: generatedImageUrl } }
        return { ...p, variants }
      })
      onSelect(generatedImageUrl)
    } catch (err) {
      setError(err.message || 'Generation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !target || busy) return
    setBusy(true); setError('')
    try {
      const { id, generatedImageUrl } = await uploadColourPreview({
        docId: productId, variantIndex, sourcePlatingCode: variant?.plating_code,
        targetCrystalCode: target, file, createdBy: auth.currentUser?.email || '',
      })
      await markUsable({ id, docId: productId, variantIndex, targetCrystalCode: target, generatedImageUrl })
      await promoteColourImage(productId, variantIndex, target, generatedImageUrl)
      setProduct(p => {
        const variants = [...p.variants]
        variants[variantIndex] = { ...variants[variantIndex], colour_images: { ...(variants[variantIndex].colour_images || {}), [target]: generatedImageUrl } }
        return { ...p, variants }
      })
      onSelect(generatedImageUrl)
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onPickGallery(url) {
    setGalleryPickerOpen(false)
    if (!url || !target || busy) return
    setBusy(true); setError('')
    try {
      const { id, generatedImageUrl } = await pickGalleryColourPreview({
        docId: productId, variantIndex, sourcePlatingCode: variant?.plating_code,
        targetCrystalCode: target, galleryUrl: url, createdBy: auth.currentUser?.email || '',
      })
      await markUsable({ id, docId: productId, variantIndex, targetCrystalCode: target, generatedImageUrl })
      await promoteColourImage(productId, variantIndex, target, generatedImageUrl)
      setProduct(p => {
        const variants = [...p.variants]
        variants[variantIndex] = { ...variants[variantIndex], colour_images: { ...(variants[variantIndex].colour_images || {}), [target]: generatedImageUrl } }
        return { ...p, variants }
      })
      onSelect(generatedImageUrl)
    } catch (err) {
      setError(err.message || 'Could not use that gallery photo.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-sm text-ink-60 text-center py-8">Loading…</p>
  if (!product) return <p className="text-sm text-ink-60 text-center py-8">Product not found.</p>

  return (
    <div className="space-y-3">
      {variantIndex == null && (
        <div>
          <p className="text-xs text-ink-60 mb-1.5">
            {parsed ? `Couldn't tell which plating "${itemCode}" is from — pick one:` : 'Pick a plating:'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(product.variants || []).map((v, i) => (
              <button key={i} type="button" onClick={() => setVariantIndex(i)}
                className="text-xs px-2.5 py-1 rounded-full border border-warm-grey hover:border-brand-400 bg-white">
                {v.plating_name || v.plating_code || `Variation ${i + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {variant && (
        <>
          {Object.keys(colourImages).length === 0 ? (
            <p className="text-sm text-ink-60 text-center py-2">No usable colour photos yet for this plating.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(colourImages).map(([code, url]) => {
                const isSelected = url === selectedUrl
                const isMatch = parsed?.crystal_code === code
                return (
                  <div key={code} onClick={() => onSelect(url)}
                    className={`group relative cursor-pointer rounded-none overflow-hidden aspect-square border-2 transition-all ${isSelected ? 'border-brand-500 ring-2 ring-brand-200' : isMatch ? 'border-brand-300' : 'border-transparent hover:border-brand-300'}`}
                    title={code}>
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={e => { e.stopPropagation(); setZoomUrl(url) }}
                        title="Enlarge"
                        className="bg-black/50 hover:bg-black/70 text-white rounded-none p-1">
                        <ZoomIn size={12} />
                      </button>
                      <button type="button" onClick={e => { e.stopPropagation(); downloadColourImage(url, `${variant?.plating_code || ''}${code}-retouch`) }}
                        title="Download to retouch, then Upload the corrected version for this colour"
                        className="bg-black/50 hover:bg-black/70 text-white rounded-none p-1">
                        <Download size={12} />
                      </button>
                    </div>
                    <span className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] text-center py-0.5">{code}</span>
                  </div>
                )
              })}
            </div>
          )}

          <div className="border-t border-warm-grey pt-2.5">
            <p className="text-[11px] text-ink-60 mb-1.5">Generate a colour photo now, if one's missing:</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <select className="input text-xs py-1 flex-1 min-w-[8rem]" value={target} onChange={e => setTarget(e.target.value)}>
                <option value="">Target colour…</option>
                {libColors.map(c => <option key={c.code} value={c.code}>{c.name || c.code} ({c.code})</option>)}
              </select>
              <button type="button" onClick={runGenerate} disabled={!variant.image || !target || busy}
                className="btn-secondary text-xs py-1 px-2 shrink-0 disabled:opacity-40 inline-flex items-center gap-1">
                <Sparkles size={12} /> {busy ? 'Working…' : 'Generate (AI)'}
              </button>
              <label className={`btn-secondary text-xs py-1 px-2 shrink-0 inline-flex items-center gap-1 cursor-pointer ${!target || busy ? 'opacity-40 pointer-events-none' : ''}`}>
                <Plus size={12} /> Upload
                <input type="file" accept="image/*" className="hidden" disabled={!target || busy} onChange={onUpload} />
              </label>
              <div className="relative">
                <button type="button" onClick={() => setGalleryPickerOpen(o => !o)} disabled={!target || busy || !product.gallery?.length}
                  className="btn-secondary text-xs py-1 px-2 shrink-0 disabled:opacity-40">
                  From gallery…
                </button>
                {galleryPickerOpen && (
                  <>
                    <div className="fixed inset-0 z-[70]" onClick={() => setGalleryPickerOpen(false)} />
                    <div className="absolute z-[80] top-8 left-0 w-56 bg-white border border-warm-grey rounded-none shadow-lg p-2 space-y-1">
                      <p className="text-[11px] text-ink-60 mb-1">Use an existing gallery photo</p>
                      <div className="grid grid-cols-4 gap-1">
                        {(product.gallery || []).map((g, gi) => g.url && (
                          <button key={gi} type="button" onClick={() => onPickGallery(g.url)}
                            className="relative aspect-square bg-white border border-warm-grey rounded-none overflow-hidden hover:border-brand-400"
                            title={g.caption || 'Use this image'}>
                            <img src={g.url} alt="" className="w-full h-full object-contain p-0.5" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            {!variant.image && <p className="text-[10px] text-amber-600 mt-1">This plating has no source photo, so AI generation isn't available — upload works regardless.</p>}
            {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
          </div>
        </>
      )}

      {zoomUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/80" onClick={() => setZoomUrl(null)}>
          {/* These photos are often modest resolution (Gemini output, or a
              quick phone upload) — max-w/max-h alone only ever shrinks an
              image, never grows one, so a small source rendered that way
              looked like barely more than the thumbnail (reported live,
              2026-08-23). Force a real target size instead. */}
          <img src={zoomUrl} alt=""
               className="rounded-none object-contain"
               style={{ width: 'min(85vw, 720px)', height: 'min(85vh, 720px)' }}
               onClick={e => e.stopPropagation()} />
          <button type="button" onClick={() => setZoomUrl(null)}
            className="absolute top-4 right-4 text-white bg-white/15 hover:bg-white/25 rounded-none p-2" aria-label="Close">
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  )
}
