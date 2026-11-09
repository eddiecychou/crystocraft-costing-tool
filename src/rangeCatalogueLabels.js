import { RANGE_CRYSTAL_BRANDS } from './constants'

const brands = Object.fromEntries(RANGE_CRYSTAL_BRANDS.map(brand => [brand.code, brand.name]))

// The team's edited option description owns the label, including premium crystal.
export function rangeCatalogueVariantLabel(variant) {
  const description = (variant.description || '').trim()
  if (description) return description
  const brand = brands[variant.brand_code] || variant.brand_code || ''
  const plating = variant.plating_name || variant.plating_code || ''
  return [brand && `${brand} Crystals`, plating && `${plating} Plated`].filter(Boolean).join(', ') || '—'
}
