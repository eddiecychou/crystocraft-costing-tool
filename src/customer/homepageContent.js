// Front-end-only content for the customer portal homepage (/shop) —
// see PROJECT-PLAN.md "Where V7.22 starts". No new Firestore fields/
// collections; this is the whole "backend."
//
// Pillar/hero images are static, curated photos (src/assets/customer/),
// not pulled from the live catalogue — owner vetted each one directly
// (2026-08-10), including the Corporate Gifts photo despite it showing a
// specific client's branded trophies ("BNI Blossom"): approved for
// portal-wide display. See HomePage.jsx for the image imports.

export const heroContent = {
  heading: 'Explore the Crystocraft Collection',
  supporting: 'Discover collectible figurines, custom corporate gifts and premium crystal embellishment materials for your next project.',
  primaryCta: { label: 'Explore the Collection' }, // scrolls to #pillars, no route
}

export const pillarsSection = {
  heading: 'Choose your area of interest',
  supporting: 'Browse our ready-to-order collection or explore ideas for your next custom project.',
}

export const pillars = [
  {
    key: 'figurine',
    title: 'Figurine Gifts',
    description: 'Collectible designs and wholesale gifts for every occasion.',
    ctaLabel: 'Browse Figurines',
    to: '/shop/figurine',
    metadata: 'Collectible & gift designs',
  },
  {
    key: 'corporate',
    title: 'Corporate Gifts',
    description: 'Customizable products for campaigns, events and client programmes.',
    ctaLabel: 'Browse Corporate Gifts',
    to: '/shop/corporate',
    metadata: 'Custom branding · Made to order',
  },
  {
    key: 'crystal',
    title: 'Crystal Materials',
    description: 'Crystal embellishment materials and visual applications for designers and brands.',
    ctaLabel: 'Explore Crystal Materials',
    to: '/shop/swatches',
    metadata: 'Design materials · Swatches and applications',
  },
]

export const quickAccessSection = {
  heading: 'Quick access',
}

// iconKey maps to a lucide-react component in HomePage.jsx — kept as a key
// (not the component itself) so this file stays a plain content module.
export const quickActions = [
  { key: 'favourites', label: 'My Favourites', to: '/shop/favourites', iconKey: 'Heart' },
  { key: 'enquiry', label: 'My Enquiry', to: '/shop/enquiry', iconKey: 'ClipboardList' },
  { key: 'orders', label: 'My Orders', to: '/shop/orders', iconKey: 'Receipt', requiresCustomer: true },
  { key: 'brand_gallery', label: 'My Brand Gallery', to: '/shop/brand-gallery', iconKey: 'Images', requiresCustomer: true },
]
