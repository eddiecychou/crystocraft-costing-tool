import { useState, useEffect, useRef } from 'react'
import { collection, getDocs, orderBy, query, addDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { resizeToJpeg } from '../imageResize'
import { Check, Search } from 'lucide-react'
import RangeColourImagePicker from './RangeColourImagePicker'

// Picks the image that represents ONE order line on the Proforma / Sales
// Invoice. Deliberately not the same thing as the Quote's ProductImagePicker:
// a quote line always has a product_id behind it, so that picker can jump
// straight to one product's gallery. An ORDER line usually has neither —
// corp-gift line codes on real orders are bespoke per order
// ("UC019-C13-CC1929ENGRCRICE"), not catalogue SKUs, so there is nothing to
// match on and the product has to be found by hand. Ad-hoc lines have no
// catalogue entry at all, which is why direct upload is a first-class option
// here rather than an afterthought.
//
// Returns a plain URL to the caller, stored on the line as `line_image`. No
// product reference is kept: the link is a one-off editorial choice ("show
// this picture on this invoice"), not a claim that the line IS that product.
export default function LineImagePicker({ selectedUrl, orderId, matchedProductRef, itemCode, onSelect, onClear, onClose }) {
  // A figurine/range line — jump straight to that ONE product's usable
  // colour photos (V8.8 Phase 2 §P2.3a). This used to be impossible: range
  // lines had no image at all, deliberately, because there was no way to
  // guarantee the photo matched the ordered plating × crystal colour. See
  // Range_Colour_Preview_Spec.md §P2.0. Skips the generic browse-all-
  // corp-gift-products flow below entirely.
  const isRangeProduct = matchedProductRef?.collection === 'range_products'
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState(null)      // product whose gallery is open
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [imgLoading, setImgLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    getDocs(query(collection(db, 'products'), orderBy('name')))
      // `active !== false`, not `active === true`: products created before the
      // flag existed have no such field and must stay visible (same rule as
      // productSource.js).
      .then(snap => setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.active !== false)))
      .finally(() => setLoading(false))
  }, [])

  function openProduct(p) {
    setChosen(p)
    setImgLoading(true)
    setImages([])
    getDocs(query(collection(db, 'products', p.id, 'images'), orderBy('sort_order')))
      .then(snap => setImages(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .finally(() => setImgLoading(false))
  }

  // A one-off photo for this order line. Stored under the ORDER, not under a
  // product: an ad-hoc line's picture is not catalogue content and must not
  // silently appear in the corp-gift gallery for everyone else.
  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { blob } = await resizeToJpeg(file)
      const path = `orders/${orderId || 'unsaved'}/line-images/${Date.now()}.jpg`
      const sRef = storageRef(storage, path)
      await uploadBytes(sRef, blob, { contentType: 'image/jpeg' })
      onSelect(await getDownloadURL(sRef))
    } catch (err) {
      alert(`Upload failed: ${err.message || err}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const filtered = products.filter(p =>
    !search
    || p.name?.toLowerCase().includes(search.toLowerCase())
    || p.category?.toLowerCase().includes(search.toLowerCase())
  )

  if (isRangeProduct) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
        <div className="bg-white rounded-none shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-warm-grey">
            <h2 className=" text-ink text-sm">Line image — {matchedProductRef.name || 'this product'}</h2>
            <button onClick={onClose} className="text-ink-60 hover:text-ink-70 text-xl leading-none">×</button>
          </div>
          <div className="overflow-y-auto flex-1 p-4">
            <RangeColourImagePicker productId={matchedProductRef.id} itemCode={itemCode} selectedUrl={selectedUrl} onSelect={onSelect} />
          </div>
          {selectedUrl && (
            <div className="px-4 py-3 border-t border-warm-grey flex items-center justify-end">
              <button type="button" onClick={onClear} className="text-xs text-ink-60 hover:text-red-500 py-1.5 px-2">
                Remove image
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-none shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-warm-grey">
          <h2 className=" text-ink text-sm">
            {chosen ? `Choose image — ${chosen.name}` : 'Line image'}
          </h2>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70 text-xl leading-none">×</button>
        </div>

        {!chosen && (
          <div className="px-4 pt-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-platinum" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search corp gift products…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-warm-grey rounded-none focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1 p-4">
          {chosen ? (
            imgLoading ? <p className="text-sm text-ink-60 text-center py-8">Loading images…</p>
            : images.length === 0 ? <p className="text-sm text-ink-60 text-center py-6">This product has no images yet.</p>
            : (
              <div className="grid grid-cols-3 gap-2">
                {images.map(img => {
                  const isSelected = img.file_url === selectedUrl
                  return (
                    <div key={img.id} onClick={() => onSelect(img.file_url)}
                      className={`relative cursor-pointer rounded-none overflow-hidden aspect-square border-2 transition-all ${isSelected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-transparent hover:border-brand-300'}`}>
                      <img src={img.file_url} alt="" className="w-full h-full object-cover" />
                      {isSelected && (
                        <div className="absolute inset-0 bg-brand-500/20 flex items-center justify-center">
                          <span className="bg-brand-500 text-white rounded-full w-5 h-5 flex items-center justify-center"><Check size={12} /></span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          ) : loading ? (
            <p className="text-sm text-ink-60 text-center py-8">Loading products…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-ink-60 text-center py-6">
              No matching products. Use “Upload a photo” below for a one-off image.
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map(p => (
                <button key={p.id} type="button" onClick={() => openProduct(p)}
                  className="w-full flex items-center gap-3 p-2 rounded-none hover:bg-ivory text-left">
                  <div className="w-10 h-10 rounded-none bg-ivory-dark shrink-0 overflow-hidden">
                    {p.heroImage && <img src={p.heroImage} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-ink truncate">{p.name}</p>
                    <p className="text-xs text-ink-60 truncate">{p.category}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-warm-grey flex items-center justify-between gap-2">
          <div className="flex gap-2">
            {chosen && (
              <button type="button" onClick={() => { setChosen(null); setImages([]) }}
                className="btn-secondary text-xs py-1.5 px-3">← Back</button>
            )}
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="btn-secondary text-xs py-1.5 px-3">
              {uploading ? 'Uploading…' : 'Upload a photo'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          </div>
          {selectedUrl && (
            <button type="button" onClick={onClear} className="text-xs text-ink-60 hover:text-red-500 py-1.5 px-2">
              Remove image
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
