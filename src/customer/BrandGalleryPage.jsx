import { useState, useEffect } from 'react'
import { loadCustomerVisibleAssets, loadBrandedProductImages, isNonRasterAsset, TYPE_LABEL, CATEGORIES, CATEGORY_LABEL } from '../customerAssets'
import { isStorefrontVisible } from '../constants'
import { Images, Download, FileText } from 'lucide-react'

// Portal "My Brand Gallery" (Customer_Brand_Gallery_Spec.md §5.4). Read-only:
// a logged-in customer sees only their own linked customer's non-internal
// assets (the loader constrains the query to match the Firestore rule). No
// edit / delete / upload — curation stays admin-side in Phase 1.
//
// Split into the same two sections the admin gallery uses (owner, 2026-08-05):
// Brand Assets (their own logo/guidelines) and Product Gallery (photos of
// their branded product we've cleared to show them) — only shown when that
// section actually has something, since most customers won't have both.
//
// Product Gallery combines TWO sources, same as the admin view
// (CustomerBrandGallery.jsx): manually-added customer assets, AND catalogue
// product photos tagged "branded for" this customer (ProductDetail.jsx).
// Tagging a photo is the one action; it doesn't need uploading twice. Filtered
// here to isStorefrontVisible — an "Internal" tagged photo must never reach
// this page, even though the Firestore rule itself would allow the read (the
// rule only screens against OTHER customers, not the image's own internal/
// private/public setting — that's a curation call, enforced client-side here,
// the same way the storefront catalogue already does it in CorporateDetail.jsx).
export default function BrandGalleryPage({ profile }) {
  const customerId = profile?.customer_id || null
  const [assets, setAssets] = useState([])
  const [brandedImages, setBrandedImages] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      loadCustomerVisibleAssets(customerId),
      loadBrandedProductImages(customerId).then(imgs => imgs.filter(isStorefrontVisible)),
    ])
      .then(([a, b]) => { if (alive) { setAssets(a); setBrandedImages(b) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [customerId])

  const total = assets.length + brandedImages.length

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Images size={20} className="text-brand-500" />
        <h1 className="text-lg font-semibold text-ink">My Brand Gallery</h1>
      </div>
      <p className="text-sm text-ink-60 mb-5">
        Your logos and brand assets we hold on file for your proposals. To add or change anything, just let us know.
      </p>

      {loading ? (
        <p className="text-sm text-ink-40 py-10 text-center">Loading…</p>
      ) : !customerId ? (
        <div className="bg-white rounded-xl border border-ivory-dark p-8 text-center text-sm text-ink-60">
          No brand assets are linked to your account yet. Contact us and we'll set them up.
        </div>
      ) : total === 0 ? (
        <div className="bg-white rounded-xl border border-ivory-dark p-8 text-center text-sm text-ink-60">
          Nothing here yet — we haven't added any of your brand assets to the portal.
        </div>
      ) : (
        <div className="space-y-8">
          {CATEGORIES.map(cat => {
            const inCat = assets.filter(a => a.category === cat)
            const brandedHere = cat === 'product_gallery' ? brandedImages : []
            if (inCat.length === 0 && brandedHere.length === 0) return null
            return (
              <div key={cat}>
                <h2 className="text-sm font-semibold text-ink-70 mb-3">{CATEGORY_LABEL[cat]}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {brandedHere.map(img => (
                    <div key={`p-${img.id}`} className="bg-white rounded-xl border border-ivory-dark overflow-hidden flex flex-col">
                      <div className="aspect-square bg-ivory flex items-center justify-center overflow-hidden">
                        <img src={img.file_url} alt={img.caption || img.product_name} className="w-full h-full object-contain" />
                      </div>
                      <div className="p-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-ink truncate">{img.caption || img.product_name || 'Product photo'}</p>
                        </div>
                        <a href={img.file_url} target="_blank" rel="noopener noreferrer" download
                           title="Download" className="shrink-0 text-ink-40 hover:text-brand-600">
                          <Download size={15} />
                        </a>
                      </div>
                    </div>
                  ))}
                  {inCat.map(a => (
                    <div key={a.id} className="bg-white rounded-xl border border-ivory-dark overflow-hidden flex flex-col">
                      <div className="aspect-square bg-ivory flex items-center justify-center overflow-hidden">
                        {isNonRasterAsset(a.filename) ? (
                          <div className="flex flex-col items-center gap-1 text-ink-30">
                            <FileText size={26} strokeWidth={1.5} />
                            <span className="text-[10px] font-medium">{(a.filename.match(/\.[^.]+$/)?.[0] || '').replace('.', '').toUpperCase()}</span>
                          </div>
                        ) : (
                          <img src={a.file_url} alt={a.title || a.filename} className="w-full h-full object-contain" />
                        )}
                      </div>
                      <div className="p-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-ink truncate">{a.title || a.filename}</p>
                          <p className="text-[10px] text-ink-40">{TYPE_LABEL[a.type]}</p>
                        </div>
                        <a href={a.file_url} target="_blank" rel="noopener noreferrer" download
                           title="Download" className="shrink-0 text-ink-40 hover:text-brand-600">
                          <Download size={15} />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
