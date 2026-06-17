// Resolve a Figurine (Range) SKU and price on the fly from the colour-attribute
// model. Crystal colour is NOT stored as a separate variant — it's picked here
// and folded into the code + price at quote / catalogue time.
//
// SKU shape:  {prefix}{design_no}-{format}-{plating}{colour}{running}
//   e.g. D0002-001-GBL,  UA061-231-CC1

export function buildRangeSku({ brand_code = '', design_no = '', format = '', plating_code = '', crystal_code = '', running_no = '' }) {
  const head = `${brand_code || ''}${design_no || ''}`
  const suffix = `${plating_code || ''}${crystal_code || ''}${running_no || ''}`
  return [head, format || '', suffix].filter(Boolean).join('-')
}

// Price for a chosen plating-variant. Colour no longer affects price — a dearer
// colour is modelled as its own variation (plating row) with a different price.
// `color` is kept in the signature for call-site compatibility but is ignored.
export function rangePrice(variant) {
  const base = Number(variant?.ws_price_usd)
  return Number.isFinite(base) ? base : 0
}

// Enumerate the resolvable SKUs for a product: one per (plating-variant × colour).
// Each variant (plating row) carries its own crystal_colors selection. If a
// variant has no colours selected, falls back to a single SKU for that variant.
export function enumerateRangeSkus(product, colorLib = []) {
  const byCode = Object.fromEntries(colorLib.map(c => [c.code, c]))
  const designNo = product.design_no || ''
  const format = product.format_code || ''
  const variants = Array.isArray(product.variants) ? product.variants : []
  const out = []
  for (const v of variants) {
    const colors = Array.isArray(v.crystal_colors) ? v.crystal_colors : []
    const common = {
      brand_code: v.brand_code || '', design_no: designNo, format,
      plating_code: v.plating_code || '', running_no: v.running_no || '',
    }
    if (colors.length) {
      for (const code of colors) {
        const color = byCode[code]
        out.push({
          sku: buildRangeSku({ ...common, crystal_code: code }),
          plating_code: v.plating_code || '', plating_name: v.plating_name || '',
          color_code: code, color_name: color?.name || code,
          price: rangePrice(v, color),
        })
      }
    } else {
      out.push({
        sku: buildRangeSku({ ...common, crystal_code: v.crystal_code || '' }),
        plating_code: v.plating_code || '', plating_name: v.plating_name || '',
        color_code: v.crystal_code || '', color_name: v.crystal_name || '',
        price: rangePrice(v, undefined),
      })
    }
  }
  return out
}
