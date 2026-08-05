import { useState, useEffect } from 'react'
import { loadCustomerVisibleAssets, TYPE_LABEL } from '../customerAssets'
import { Images, Download } from 'lucide-react'

// Portal "My Brand Gallery" (Customer_Brand_Gallery_Spec.md §5.4). Read-only:
// a logged-in customer sees only their own linked customer's non-internal
// assets (the loader constrains the query to match the Firestore rule). No
// edit / delete / upload — curation stays admin-side in Phase 1.
export default function BrandGalleryPage({ profile }) {
  const customerId = profile?.customer_id || null
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadCustomerVisibleAssets(customerId)
      .then(a => { if (alive) setAssets(a) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [customerId])

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
      ) : assets.length === 0 ? (
        <div className="bg-white rounded-xl border border-ivory-dark p-8 text-center text-sm text-ink-60">
          Nothing here yet — we haven't added any of your brand assets to the portal.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {assets.map(a => (
            <div key={a.id} className="bg-white rounded-xl border border-ivory-dark overflow-hidden flex flex-col">
              <div className="aspect-square bg-ivory flex items-center justify-center overflow-hidden">
                <img src={a.file_url} alt={a.title || a.filename} className="w-full h-full object-contain" />
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
      )}
    </div>
  )
}
