import { Gem, Cog, Package, TreePine, Cpu, Shirt, Printer, Tag } from 'lucide-react'

export const SUPPLIER_CATEGORIES = [
  { value: 'Crystal / Glass',        Icon: Gem },
  { value: 'Metal Parts',            Icon: Cog },
  { value: 'Packaging',              Icon: Package },
  { value: 'Wood / Acrylic / Plastics', Icon: TreePine },
  { value: 'Electronics',            Icon: Cpu },
  { value: 'Fabric & Textile',       Icon: Shirt },
  { value: 'Printing & Engraving',   Icon: Printer },
  { value: 'Others',                 Icon: Tag },
]

export const PRODUCT_STATUSES = [
  { value: 'concept',  label: 'Concept' },
  { value: 'sampled',  label: 'Sampled' },
  { value: 'active',   label: 'Active' },
  { value: 'retired',  label: 'Retired' },
]

// Legacy value -> canonical value. `discontinued` was renamed to `retired`;
// old docs keep the stored value, but every read goes through productStatusOf
// so they display/behave identically. Never write the legacy value back.
const PRODUCT_STATUS_ALIASES = { discontinued: 'retired' }
export const productStatusOf = v =>
  PRODUCT_STATUSES.find(s => s.value === (PRODUCT_STATUS_ALIASES[v] || v)) || PRODUCT_STATUSES[0]

export const CATEGORIES = [
  'ESG & Sustainable Gifts',
  'Dining & Kitchen',
  'Tech Accessories',
  'Travel Accessories',
  'Apparel & Wearables',
  'Accessories',
  'Games & Leisure',
  'Stationery',
  'Decor Objects',
  'Trophy & Award',
]

export const CURRENCIES = ['RMB', 'HKD', 'USD', 'EUR']

// ── Purchase Order module ────────────────────────────────────────────────────
// Payment terms seen on the real ERP POs (月結30天 net-30, cash, deposit splits).
// Free-text is still allowed on the PO, these are just the quick-pick defaults.
export const PO_PAYMENT_TERMS = [
  { value: 'net30',   label: 'Net 30 (月結30天)' },
  { value: 'net60',   label: 'Net 60 (月結60天)' },
  { value: 'cash',    label: 'Cash (現金)' },
  { value: 'deposit', label: 'Deposit + balance (訂金+尾數)' },
  { value: 'prepaid', label: 'Prepaid (預付)' },
]
export const PO_PAYMENT_TERM_LABEL = Object.fromEntries(PO_PAYMENT_TERMS.map(t => [t.value, t.label]))

// Purchase units — most parts are pcs; a few ERP items buy by length/weight.
export const PO_UNITS = ['pcs', 'set', 'm', 'kg', 'roll', 'sheet', 'pair']

export const PO_STATUSES = [
  { value: 'draft',  label: 'Draft',  badge: 'bg-gray-100 text-gray-600' },
  { value: 'issued', label: 'Issued', badge: 'bg-emerald-100 text-emerald-700' },
]

// Spell a money amount into English words for the PO footer (e.g. "SAY HONG
// KONG DOLLARS SIX THOUSAND SEVEN HUNDRED NINETY ONLY"). Cents rendered as
// "AND xx CENTS". Whole-number ERP POs are the norm, but we handle decimals.
const CURRENCY_WORDS = {
  HKD: 'HONG KONG DOLLARS', USD: 'US DOLLARS', RMB: 'REN MIN BI', EUR: 'EURO',
}
export function amountInWords(amount, currency) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return ''
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
  const under1000 = num => {
    let w = ''
    if (num >= 100) { w += ones[Math.floor(num / 100)] + ' HUNDRED'; num %= 100; if (num) w += ' ' }
    if (num >= 20) { w += tens[Math.floor(num / 10)]; num %= 10; if (num) w += ' ' }
    if (num > 0) w += ones[num]
    return w
  }
  const whole = Math.floor(Math.abs(n))
  const cents = Math.round((Math.abs(n) - whole) * 100)
  let words = ''
  if (whole === 0) words = 'ZERO'
  else {
    const scales = [[1e9, 'BILLION'], [1e6, 'MILLION'], [1e3, 'THOUSAND'], [1, '']]
    let rem = whole
    for (const [value, name] of scales) {
      if (rem >= value) {
        const chunk = Math.floor(rem / value)
        words += (words ? ' ' : '') + under1000(chunk) + (name ? ' ' + name : '')
        rem %= value
      }
    }
  }
  const cur = CURRENCY_WORDS[currency] || (currency || '')
  const centsPart = cents > 0 ? ` AND ${under1000(cents)} CENTS` : ''
  return `SAY ${cur} ${words}${centsPart} ONLY`.replace(/\s+/g, ' ').trim()
}

export const IMAGE_TYPES = [
  { value: 'hero',           label: 'Hero' },
  { value: 'product_detail', label: 'Product Detail' },
  { value: 'packaging',      label: 'Packaging' },
  { value: 'lifestyle',      label: 'Lifestyle' },
  { value: 'customisation',  label: 'Customisation' },
  { value: 'client_ref',     label: 'Client Ref' },
]

export const IMAGE_ORIENTATIONS = [
  { value: 'landscape', label: 'Landscape', short: 'L' },
  { value: 'square',    label: 'Square',    short: 'S' },
  { value: 'portrait',  label: 'Portrait',  short: 'P' },
]

// Where a corporate product image is allowed to appear. Gates the storefront
// (customer-visible) and the blog/WordPress (public) surfaces.
//   internal — admin library only; never shown to customers or published.
//   private  — shown to logged-in customers in the storefront catalogue.
//   public   — also allowed in public blog posts / website content.
export const IMAGE_VISIBILITY = [
  { value: 'internal', label: 'Internal', short: 'Internal', cls: 'bg-gray-200 text-gray-600' },
  { value: 'private',  label: 'Storefront', short: 'Storefront', cls: 'bg-amber-100 text-amber-700' },
  { value: 'public',   label: 'Public', short: 'Public', cls: 'bg-green-100 text-green-700' },
]

// Legacy images (uploaded before this field existed) have no `visibility`.
// Treat them as fully visible so nothing disappears when this ships; the admin
// tightens them over time. New uploads default to 'internal' (see ImageGallery).
export const imageVisibility = img => img?.visibility || 'public'
export const isStorefrontVisible = img => imageVisibility(img) !== 'internal'
export const isPublicVisible     = img => imageVisibility(img) === 'public'

export const COMPONENT_IMAGE_TYPES = [
  { value: 'spec',      label: 'Spec' },
  { value: 'sample',    label: 'Sample' },
  { value: 'drawing',   label: 'Drawing' },
  { value: 'reference', label: 'Reference' },
]

// Figurine Gifts (Crystocraft Range) taxonomy
export const RANGE_DESIGN_TYPES = [
  'Angel', 'Bird & Animal', 'Butterfly', 'Fairy', 'Garden', 'Heart',
  'Hobby & Sport', 'Religious', 'Seasonal',
]

export const RANGE_PRODUCT_TYPES = [
  'Figurine', 'Music Box', 'Mobile / Freestand', 'Photo Frame',
  'Trinket Box', 'Clock', 'Pen Holder', 'Other',
]

// Item-code anatomy: {design}-{format}-{plating}{crystal}{running}
//   e.g. D0002-001-GC1  ->  design D0002, format 001 (freestand figurine),
//   plating G (Gold), crystal colour C1, optional running-no for variations.

// Item-code helpers. Leading letters = brand (1st letter) + optional body
// letter (2nd). The numeric part is the design number (3 or 4 digits).
export const designNumber = code => (code || '').replace(/^[A-Za-z]+/, '')
export const brandLetter = code => ((code || '').match(/^[A-Za-z]/) || [''])[0]
export const bodyLetter  = code => (((code || '').match(/^[A-Za-z]+/) || [''])[0]).slice(1)

// Catalogue ordering by brand prefix. The classic figurine series (D/A/U/H/M)
// are all the same product type and rank together first; then the UA series,
// then UB, then B-series accessories last. Unknown prefixes fall just before the
// accessories (default 3). Shared by the customer shop and the admin product
// manager so both order identically.
export const BRAND_SORT_ORDER = { D: 0, A: 0, U: 0, H: 0, M: 0, UA: 1, UB: 2, B: 4 }
export const brandSortRank = prefix => BRAND_SORT_ORDER[prefix] ?? 3

// Max length for customer-facing marketing copy so it stays short and fits the
// catalogue cards / storefront layout (≈45–50 words). Enforced in the editors.
export const MARKETING_DESC_MAXLEN = 300

// Optional 2nd prefix letter = the design's body / type. Blank = normal metal.
export const RANGE_BODY_TYPES = [
  { code: '',  name: 'Metal' },
  { code: 'A', name: 'Crystal body' },
  { code: 'C', name: 'Glassware' },
  { code: 'D', name: 'Display unit' },
]

// Lifecycle status (drives the customer promise together with live stock):
//  • 'active'   = Made to Order — tooling exists, stock may or may not be on hand,
//                 MOQ may apply. The current, orderable range.
//  • 'stock'    = Retired Stock — no re-runs; sells the remaining inventory.
//  • 'concept'  = Concept       — not yet tooled, no stock; shown like any product
//                 (price/size/images/description) but enquiry-only, no MOQ/lead.
//  • 'retired'  = Retired, Sold Out — the same lifecycle state as 'stock' with
//                 the stock gone. Greyed out in the admin list; kept for
//                 history/reference and hidden from customers.
//
// 'stock' and 'retired' are ONE state, not two (owner, 2026-07-21): a retired
// design that still has units, and the same design once they run out. The
// labels used to read "Last Stock" and "Retired", which hid that relationship
// and made them look like unrelated options sitting in the same filter bar.
// Stored keys are kept as 'active' / 'stock' for back-compat; only labels changed.
export const RANGE_STATUSES = [
  { value: 'active',  label: 'Made to Order', badge: 'bg-emerald-100 text-emerald-700' },
  { value: 'stock',   label: 'Retired Stock', badge: 'bg-amber-100 text-amber-700' },
  { value: 'concept', label: 'Concept',       badge: 'bg-purple-100 text-purple-700' },
  { value: 'retired', label: 'Retired — Sold Out', badge: 'bg-gray-200 text-gray-600' },
]

// Customer-facing availability labels + explanatory tooltips for range figurines.
export const RANGE_STATUS_CUSTOMER = {
  active: {
    label: 'Made to Order',
    cls: 'bg-emerald-100 text-emerald-700',
    tip: 'Produced to order — standard production lead time applies.',
  },
  stock: {
    label: 'Retired Stock',
    cls: 'bg-amber-100 text-amber-700',
    // Says "no further production" explicitly, not just "limited stock". The
    // risk being guarded against (owner, 2026-07-21) is a customer assuming the
    // tooling still exists and planning a repeat order around it — scarcity
    // wording alone implies "order soon", which is the wrong inference.
    tip: 'Retired design — the tooling is retired and there will be no further production runs. Available while remaining stock lasts.',
  },
  concept: {
    label: 'Concept',
    cls: 'bg-purple-100 text-purple-700',
    tip: 'Concept design — not yet in production. Enquire to register your interest.',
  },
  retired: {
    label: 'Retired — Sold Out',
    cls: 'bg-gray-200 text-gray-600',
    tip: 'Retired — no stock remaining. This design will not be produced again.',
  },
}

// First letter of the item code = crystal brand. The numeric part is the
// actual design — U0002 / D0002 / A0002 / M0002 are the SAME design in
// different crystal brands, so brand is a per-variant axis.
export const RANGE_CRYSTAL_BRANDS = [
  { code: 'D', name: 'Bohemia' },
  { code: 'U', name: 'Swarovski' },
  { code: 'A', name: 'Asfour / Chinese' },
  { code: 'M', name: 'Mixed' },
]

// Middle segment = format code (what the design is built into)
export const RANGE_FORMAT_CODES = [
  { code: '001', label: 'Freestand Figurine' },
  { code: '033', label: 'Music Box' },
  { code: '231', label: 'Mobile Freestand' },
  { code: '232', label: 'Mobile Freestand (Pad Print)' },
  { code: '163', label: 'Metal Bookmark' },
]

// Plating colour (first letter of the 3rd segment). Field is free-text —
// these are the known codes; e.g. M = mixed plating can be typed in directly.
export const RANGE_PLATINGS = [
  { code: 'G', name: 'Gold',      dot: '#C6A664' },
  { code: 'C', name: 'Chrome',    dot: '#9AA0A6' },
  { code: 'R', name: 'Rose Gold', dot: '#B76E79' },
  { code: 'A', name: 'Gun Metal', dot: '#4A4A47' },
  { code: 'M', name: 'Mixed',     dot: '#B7935A' },
]

// Critical-component categories — used to group/filter the components library.
export const RANGE_COMPONENT_CATEGORIES = [
  'Figurine Body',
  'Metal Part',
  'Music Box',
  'Base / Stand',
  'Display Unit',
  'Electronics',
  'Packaging',
  'Other',
]

// Crystal colour codes (suffix after plating). Free-text — add a name map here
// once the real code→colour mapping is known.
export const RANGE_CRYSTAL_COLORS = []

// ---- Product gallery -------------------------------------------------------
// Gallery items are { url, caption }. Older products stored plain URL strings,
// so normalise on read and pull the URL safely wherever a string is expected.
export const galleryUrl = g => (typeof g === 'string' ? g : (g?.url || ''))
export const galleryCaption = g => (typeof g === 'string' ? '' : (g?.caption || ''))
export const normGallery = arr =>
  (Array.isArray(arr) ? arr : [])
    .map(g => ({ url: galleryUrl(g), caption: galleryCaption(g) }))
    .filter(g => g.url)

// ---- Product video ---------------------------------------------------------
// Accept any common YouTube URL form (watch, youtu.be, shorts, embed) and return
// an embeddable URL. Returns '' when the input isn't a recognisable YouTube link.
export const youtubeId = url => {
  if (!url) return ''
  const m = String(url).trim().match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  )
  return m ? m[1] : ''
}

export const youtubeEmbed = url => {
  const id = youtubeId(url)
  return id ? `https://www.youtube.com/embed/${id}` : ''
}

// Products can carry several videos. Normalise the `videos` array (strings) and
// fall back to the legacy single `video_url` field so older products keep their
// video. Returns a de-duped list of trimmed, non-empty URLs.
export const normVideos = (videos, legacyUrl) => {
  const arr = Array.isArray(videos) ? videos : []
  const urls = arr
    .map(v => (typeof v === 'string' ? v : v?.url || ''))
    .map(s => String(s).trim())
    .filter(Boolean)
  if (!urls.length && legacyUrl) {
    const s = String(legacyUrl).trim()
    if (s) urls.push(s)
  }
  return [...new Set(urls)]
}
