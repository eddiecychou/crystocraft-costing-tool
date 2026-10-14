const upper = value => String(value || '').trim().toUpperCase()

// all_variants overrides plating only. An explicit colour always remains a
// restriction: it must never become six panels on every finished piece.
export function bomRefApplies(ref, component, variant) {
  const plating = ref?.all_variants ? '' : upper(ref?.plating_code || component?.plating_code)
  const colour = upper(ref?.crystal_code)
  return (!plating || plating === upper(variant?.plating_code))
    && (!colour || colour === upper(variant?.crystal_code))
}

export const colourScope = ref => upper(ref?.crystal_code)

// Preserve legacy serialized shapes when there is no colour scope.
export const serializedColourScope = ref => colourScope(ref) ? { crystal_code: colourScope(ref) } : {}

export function scopedVariants(product) {
  const found = new Map()
  for (const v of product?.variants || []) {
    const colours = v.crystal_colors?.length ? v.crystal_colors : [v.crystal_code]
    for (const colour of colours) {
      const crystal_code = upper(colour), plating_code = upper(v.plating_code)
      if (crystal_code) found.set(`${plating_code}|${crystal_code}`, { plating_code, crystal_code })
    }
  }
  return [...found.values()]
}
