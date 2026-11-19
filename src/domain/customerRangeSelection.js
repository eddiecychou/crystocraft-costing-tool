// Resolve saved references against today's buyer catalogue, including lines
// saved before finish_sku existed. An ambiguous finish needs reselection.
export function resolveRangeSelection(line, products) {
  const product = products.find(p => p.id === line.id)
  if (!product) return null
  const variants = product.variants.length ? product.variants : [{ crystal_colors: [], customer_price_usd: null }]
  const colours = product.variants.flatMap(v => v.crystal_colors)
  const matches = variants.filter(v => {
    if (line.finish_sku && v.sku !== line.finish_sku) return false
    if ((v.plating_name || v.plating_code || '') !== (line.finish || '')) return false
    const availableColours = v.crystal_colors.length ? v.crystal_colors : colours
    return availableColours.length ? availableColours.includes(line.color) : !line.color
  })
  const selected = variants[line.variant_index]
  const variant = matches.length === 1 ? matches[0] : matches.includes(selected) ? selected : null
  if (!variant) return null
  return { ...line, name: product.description || product.design_name || product.design_code,
    image: variant.colour_images?.[line.color] || variant.image || product.gallery[0]?.url || '',
    plating_code: variant.plating_code || '', pcs_per_carton: Number(product.packing?.pcs_per_carton) || 0,
    status: product.status, customer_price_usd: variant.customer_price_usd }
}
