import { Link2, Loader2, Upload, X } from 'lucide-react'

// Controlled presentation. State, storage, visibility and payload logic stay in DailyDrafts.
export function DailyDraftsProductLinks({
  linkedProduct, setLinkedProduct, linkProductOpen, setLinkProductOpen,
  masterLinks, removeMasterLink, masterLinkFormOpen, setMasterLinkFormOpen,
  linkProductQuery, setLinkProductQuery, filteredLinkProducts,
  masterLinkUrl, setMasterLinkUrl, masterLinkTitle, setMasterLinkTitle, applyMasterLink,
}) {
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {!linkedProduct ? (
          <button type="button" onClick={() => setLinkProductOpen(!linkProductOpen)}
            className="text-xs text-ink-60 hover:text-brand-600">
            + Link a product (optional, unlocks its photos)
          </button>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-sm bg-ivory-light rounded-none px-2 py-1">
            <span className="truncate max-w-xs">{linkedProduct.name}</span>
            <button type="button" onClick={() => setLinkedProduct(null)} className="text-ink-60 hover:text-red-600">
              <X size={12} />
            </button>
          </div>
        )}
        {/* Any URL — crystocraft.com blog post included. Moved up here
            (owner, 2026-08-22) from further down where it only appeared
            after "Draft with AI" — the blog link is chosen at the same
            time as the product link, not after drafting. WordPress search
            was tried and retired in V8.1 (503s from the WP host made it
            unreliable) — paste the URL in by hand instead, same posture
            as send-personal-email.js's own `links` field. */}
        {masterLinks.map(l => (
          <span key={l.url} className="inline-flex items-center gap-1 text-xs text-ink-60 bg-ivory-light rounded-none px-2 py-1">
            <Link2 size={11} /> {l.title}
            <button type="button" onClick={() => removeMasterLink(l.url)} className="text-ink-60 hover:text-red-600">
              <X size={11} />
            </button>
          </span>
        ))}
        <button type="button" onClick={() => setMasterLinkFormOpen(!masterLinkFormOpen)}
          className="text-xs text-ink-60 hover:text-brand-600">
          + Link a blog post or page (optional)
        </button>
      </div>
      {linkProductOpen && !linkedProduct && (
        <div>
          <input value={linkProductQuery} onChange={e => setLinkProductQuery(e.target.value)}
            placeholder="Search Corporate Gifts or Crystocraft Range…" className="input w-full md:w-96 mb-1" />
          <div className="border border-ivory-dark rounded-none max-h-48 overflow-y-auto w-full md:w-96">
            {filteredLinkProducts.map(p => (
              <button key={`${p.source}-${p.id}`} type="button"
                onClick={() => { setLinkedProduct(p); setLinkProductOpen(false); setLinkProductQuery('') }}
                className="w-full flex items-center justify-between gap-2 text-left px-3 py-1.5 text-sm hover:bg-ivory-light">
                <span className="truncate">{p.name}</span>
                <span className={`text-2xs uppercase tracking-wide rounded-none px-1 py-0.5 shrink-0 ${
 p.source === 'range' ? 'bg-brand-50 text-brand-700' : 'bg-blue-50 text-blue-700'
                }`}>
                  {p.source === 'range' ? 'Range' : 'Corporate'}
                </span>
              </button>
            ))}
            {!filteredLinkProducts.length && <div className="px-3 py-1.5 text-sm text-ink-60">No matches.</div>}
          </div>
        </div>
      )}
      {masterLinkFormOpen && (
        <div className="border border-ivory-dark rounded-none p-2 space-y-2 w-full md:w-96">
          <input value={masterLinkUrl} onChange={e => setMasterLinkUrl(e.target.value)}
            placeholder="https://www.crystocraft.com/blog/…" className="input w-full text-sm" />
          <input value={masterLinkTitle} onChange={e => setMasterLinkTitle(e.target.value)}
            placeholder="Link text (optional)" className="input w-full text-sm" />
          <div className="flex gap-2">
            <button type="button" onClick={applyMasterLink} disabled={!masterLinkUrl.trim()} className="btn-secondary text-xs py-1.5 px-3">
              Attach link
            </button>
            <button type="button" onClick={() => setMasterLinkFormOpen(false)} className="text-xs text-ink-60 hover:text-brand-600">
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export function DailyDraftsImages({
  masterImageUrls, setMasterImageUrls, masterUploading, handleMasterUpload,
  linkedProduct, linkedProductImages, toggleMasterImage, maxAttachedImages: MAX_ATTACHED_IMAGES,
}) {
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {masterImageUrls.map(url => (
          <div key={url} className="relative">
            <img src={url} alt="" className="w-10 h-10 rounded-none object-cover border border-ivory-dark" />
            <button type="button" onClick={() => setMasterImageUrls(prev => prev.filter(u => u !== url))}
              className="absolute -top-1.5 -right-1.5 bg-white rounded-full border border-ivory-dark text-ink-60 hover:text-red-600">
              <X size={11} />
            </button>
          </div>
        ))}
        {masterImageUrls.length < MAX_ATTACHED_IMAGES && (
          <label className="text-xs text-ink-60 hover:text-brand-600 border border-dashed border-ivory-dark rounded-none px-2 py-1.5 cursor-pointer inline-flex items-center gap-1">
            {masterUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Upload
            <input type="file" accept="image/*" className="hidden" disabled={masterUploading}
              onChange={e => { handleMasterUpload(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        )}
      </div>

      {linkedProduct && linkedProductImages.length > 0 && masterImageUrls.length < MAX_ATTACHED_IMAGES && (
        <div>
          <label className="block text-xs font-medium text-ink-60 mb-1">…or from {linkedProduct.name}'s gallery</label>
          <div className="flex flex-wrap gap-2">
            {linkedProductImages.map(img => {
              const picked = masterImageUrls.includes(img.file_url)
              return (
                <button key={img.id || img.file_url} type="button" onClick={() => toggleMasterImage(img.file_url)}
                  className={`relative w-12 h-12 rounded-none overflow-hidden border-2 ${picked ? 'border-brand-600' : 'border-transparent'}`}>
                  <img src={img.file_url} alt="" className="w-full h-full object-cover" />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
