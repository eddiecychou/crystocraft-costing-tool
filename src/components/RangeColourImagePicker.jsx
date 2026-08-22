import { useState, useEffect } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db, auth } from '../firebase'
import { useCrystalColors } from '../crystalColors'
import { parseRangeVariantSuffix } from '../rangeSku'
import { generateColourPreview, uploadColourPreview, promoteColourImage } from '../colourPreviewApi'
import { Sparkles, Plus } from 'lucide-react'

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
      const { generatedImageUrl } = await generateColourPreview({
        docId: productId, variantIndex, sourceImageUrl: variant.image,
        sourcePlatingCode: variant.plating_code, sourceCrystalCode: variant.crystal_code,
        sourceCrystalName: variant.crystal_name,
        targetCrystalCode: target, targetCrystalName: targetInfo?.name || target,
        targetSwatchHex: targetInfo?.swatch, createdBy: auth.currentUser?.email || '',
      })
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
      const { generatedImageUrl } = await uploadColourPreview({
        docId: productId, variantIndex, sourcePlatingCode: variant?.plating_code,
        targetCrystalCode: target, file, createdBy: auth.currentUser?.email || '',
      })
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

  if (loading) return <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
  if (!product) return <p className="text-sm text-gray-400 text-center py-8">Product not found.</p>

  return (
    <div className="space-y-3">
      {variantIndex == null && (
        <div>
          <p className="text-xs text-gray-500 mb-1.5">
            {parsed ? `Couldn't tell which plating "${itemCode}" is from — pick one:` : 'Pick a plating:'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(product.variants || []).map((v, i) => (
              <button key={i} type="button" onClick={() => setVariantIndex(i)}
                className="text-xs px-2.5 py-1 rounded-full border border-gray-200 hover:border-brand-400 bg-white">
                {v.plating_name || v.plating_code || `Variation ${i + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {variant && (
        <>
          {Object.keys(colourImages).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-2">No usable colour photos yet for this plating.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(colourImages).map(([code, url]) => {
                const isSelected = url === selectedUrl
                const isMatch = parsed?.crystal_code === code
                return (
                  <div key={code} onClick={() => onSelect(url)}
                    className={`relative cursor-pointer rounded-lg overflow-hidden aspect-square border-2 transition-all ${isSelected ? 'border-brand-500 ring-2 ring-brand-200' : isMatch ? 'border-brand-300' : 'border-transparent hover:border-brand-300'}`}
                    title={code}>
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] text-center py-0.5">{code}</span>
                  </div>
                )
              })}
            </div>
          )}

          <div className="border-t border-gray-100 pt-2.5">
            <p className="text-[11px] text-gray-500 mb-1.5">Generate a colour photo now, if one's missing:</p>
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
            </div>
            {!variant.image && <p className="text-[10px] text-amber-600 mt-1">This plating has no source photo, so AI generation isn't available — upload works regardless.</p>}
            {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
          </div>
        </>
      )}
    </div>
  )
}
