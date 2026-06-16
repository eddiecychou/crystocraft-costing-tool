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

// Middle segment = format code (what the design is built into)
export const RANGE_FORMAT_CODES = [
  { code: '001', label: 'Freestand Figurine' },
  { code: '033', label: 'Music Box' },
]

// Plating colour (first letter of the 3rd segment)
export const RANGE_PLATINGS = [
  { code: 'G', name: 'Gold',     dot: '#C6A664' },
  { code: 'C', name: 'Chrome',   dot: '#9AA0A6' },
  { code: 'A', name: 'Gunmetal', dot: '#4A4A47' },
  { code: 'T', name: 'Two-tone', dot: '#B7935A' },
  { code: 'W', name: 'White',    dot: '#E8E6E1' },
]

// Crystal colour codes (suffix after plating). Editable — add as discovered.
export const RANGE_CRYSTAL_COLORS = [
  { code: '',   name: 'Clear / Default' },
  { code: 'C1', name: 'Crystal AB' },
  { code: 'C2', name: 'Aurora' },
]
