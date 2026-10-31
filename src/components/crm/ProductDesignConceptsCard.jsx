import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { listApprovedConcepts } from '../../lib/pdConcepts'
import { imageDownloadUrl } from '../../imageDownloadUrl'
// Product Design "concepts" approved for this customer (V8.16). Deliberately
// separate from the customer's real Quotes/Sales History above: a concept is
// a Product Design pd_prompt_templates doc — a picked-but-not-yet-costed
// idea, with no SKU, supplier quote, or specification of its own. It only
// becomes an actual product (with real costing) once someone builds that in
// the ordinary Products/Components flow — this card never links to or
// implies that step, only to the concept's own page in /design/*, so the two
// stay visibly distinct (Eddie, 2026-09-19: "do not mix this product design
// concept with actual product").
function ProductDesignConceptCard({ item }) {
  const { template, product, thumbUrl } = item
  return (
    <div className="card overflow-hidden">
      <Link to={`/design/templates/${template.id}`} className="block hover:border-brand-300 transition-colors">
        {/* Square + object-contain (was h-24 object-cover, a short crop that
            chopped photos — reported live 2026-09-20). Same treatment as
            every other Product Design image grid. */}
        <div className="aspect-square bg-ivory-dark flex items-center justify-center overflow-hidden">
          {thumbUrl
            ? <img src={thumbUrl} alt="" className="max-w-full max-h-full object-contain" />
            : <span className="text-2xs text-ink-60">No image</span>}
        </div>
      </Link>
      <div className="p-2">
        <p className="text-xs font-medium truncate">{template.name}</p>
        <p className="text-2xs text-ink-60 truncate mb-1">{product?.name || '—'}</p>
        {thumbUrl && (
          <a
            href={imageDownloadUrl(thumbUrl, `${template.name}.jpg`, true)}
            download={`${template.name}.jpg`}
            className="text-2xs text-brand-600 uppercase tracking-wide hover:underline"
          >
            Download
          </a>
        )}
      </div>
    </div>
  )
}

export default function ProductDesignConceptsCard({ customerId }) {
  const [items, setItems] = useState(undefined) // undefined = loading

  useEffect(() => {
    let alive = true
    listApprovedConcepts(customerId).then(withDetails => { if (alive) setItems(withDetails) })
    return () => { alive = false }
  }, [customerId])

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm text-ink-80">Product Design Concepts</h2>
        {items && items.length > 0 && <span className="text-xs text-ink-60">{items.length} approved</span>}
      </div>
      <p className="text-xs text-ink-60 mb-3">
        Design concepts approved for this customer — not yet real products.
        A concept only becomes an actual costed product once it&rsquo;s
        picked for a quotation.
      </p>
      {items === undefined ? (
        <p className="text-xs text-ink-60">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-ink-60">
          No approved concepts yet. Mark a template &ldquo;Approved&rdquo;
          in <Link to="/design/products" className="text-brand-600 hover:underline">Product Design</Link> to
          have it show up here.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {items.map(item => <ProductDesignConceptCard key={item.template.id} item={item} />)}
        </div>
      )}
    </div>
  )
}

// SU-07A auto-approve follow-up (2026-09-24, owner request): admin-created
// invitations now auto-approve at claim time (see portal-invite.js's
// runApproval), so there's no longer a manual "Approve" click where an
// admin was naturally in the admin UI and could set pricing before telling
// the customer. Without this dialog, a newly-approved account would sit at
// AccountEdit.jsx's own defaults (ws_discount_pct 0 → displayed/treated as
// 100 = full list price, no fx override, no markup override) until an
// admin remembered to visit AccountEdit.jsx separately — the customer could
// see full list price immediately. So pricing is now collected HERE, before
// the invite is even sent, using the exact same fields/semantics/defaults
// as AccountEdit.jsx's own "Pricing" card (kept deliberately in sync — see
// that file if these ever need to change together).
