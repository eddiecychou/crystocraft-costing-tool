export const SUPPLIER_CATEGORIES = [
  { value: 'Crystal / Glass',        emoji: '🔮' },
  { value: 'Metal Parts',            emoji: '⚙️' },
  { value: 'Packaging',              emoji: '📦' },
  { value: 'Wood / Acrylic / Plastics', emoji: '🪵' },
  { value: 'Electronics',            emoji: '📡' },
  { value: 'Fabric & Textile',       emoji: '🧵' },
  { value: 'Printing & Engraving',   emoji: '🖨️' },
  { value: 'Others',                 emoji: '🏷️' },
]

export const PRODUCT_STATUSES = [
  { value: 'concept',      label: 'Concept' },
  { value: 'sampled',      label: 'Sampled' },
  { value: 'active',       label: 'Active' },
  { value: 'discontinued', label: 'Discontinued' },
]

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

// Optional 2nd prefix letter = the design's body / type. Blank = normal metal.
export const RANGE_BODY_TYPES = [
  { code: '',  name: 'Metal' },
  { code: 'A', name: 'Crystal body' },
  { code: 'C', name: 'Glassware' },
  { code: 'D', name: 'Display unit' },
]

// Lifecycle status (drives the customer promise together with live stock):
//  • 'active' = Made to Order — tooling exists, stock may or may not be on hand,
//               MOQ may apply. The current, orderable range.
//  • 'stock'  = Last Stock    — retired design, only remaining inventory; no re-runs.
// Stored keys are kept as 'active' / 'stock' for back-compat; only labels changed.
export const RANGE_STATUSES = [
  { value: 'active', label: 'Made to Order', badge: 'bg-emerald-100 text-emerald-700' },
  { value: 'stock',  label: 'Last Stock',    badge: 'bg-amber-100 text-amber-700' },
]

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

// Crystal colour codes (suffix after plating). Free-text — add a name map here
// once the real code→colour mapping is known.
export const RANGE_CRYSTAL_COLORS = []
