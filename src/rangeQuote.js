// A Gift Range design can have several differently priced SKUs. A quote must
// select and snapshot one variant, never silently price the whole design from
// whichever variant happens to be first.
// SKU is not unique: imported rows can share a SKU but have different brands/prices.
// Preserve the source variant index already snapshotted on quote lines.
const rangeChoiceKey = (id, sku, index) =>
  `range_products:${id}:${sku || `variant-${index ?? 0}`}${Number.isInteger(index) ? `:index-${index}` : ''}`

const imageUrl = image => typeof image === 'string' ? image : image?.url || ''

export function rangeQuoteChoices(product) {
  const variants = Array.isArray(product.variants) && product.variants.length
    ? product.variants
    : (product.finishes || []).map(f => ({
        sku: f.sku, description: f.finish_name, image: f.image,
        ws_price_usd: f.ws_price_usd, plating_name: f.finish_name,
      }))
  const choices = variants.length ? variants : [null]
  const name = product.description || product.design_name || product.design_code || 'Unnamed design'
  const galleryImage = imageUrl(Array.isArray(product.gallery) ? product.gallery[0] : null)

  return choices.map((variant, index) => {
    const sku = variant?.sku || ''
    const detail = variant?.description || [variant?.brand_name, variant?.plating_name, variant?.crystal_name].filter(Boolean).join(' · ')
    return {
      source: 'range_products',
      key: rangeChoiceKey(product.id, sku, variant ? index : null),
      legacyKey: `range_products:${product.id}:${sku || `variant-${index}`}`,
      design_code: product.design_code || '',
      productId: product.id,
      variantIndex: variant ? index : null,
      sku,
      name,
      detail: detail || (variant ? `Variant ${index + 1}` : 'No variant / SKU'),
      category: product.design_type || product.category || product.product_type || 'Gift Range',
      description: product.description || '',
      image: imageUrl(variant?.image) || galleryImage,
      usdPrice: variant?.ws_price_usd,
      moq: product.moq,
    }
  })
}

export function quoteItemKey(item) {
  if (!item.product_id) return null
  return item.product_collection === 'range_products'
    ? rangeChoiceKey(item.product_id, item.product_variant_sku, item.product_variant_index)
    : `products:${item.product_id}`
}

export function hasIncompleteRangeLine(item) {
  if (item.product_collection !== 'range_products') return false
  const tiers = Array.isArray(item.tiers) ? item.tiers : []
  return !tiers.length || tiers.some(t => !(Number(t.quantity) > 0 && Number(t.price) > 0))
}

export function rangeQuoteItem(choice, quoteCurrency, rates) {
  const usd = Number(choice.usdPrice)
  const usdRate = Number(rates.USD)
  const targetRate = quoteCurrency === 'HKD' ? 1 : Number(rates[quoteCurrency])
  const hasPrice = choice.usdPrice !== '' && choice.usdPrice != null && Number.isFinite(usd) && usd > 0
  const canConvert = Number.isFinite(usdRate) && usdRate > 0 && Number.isFinite(targetRate) && targetRate > 0
  const price = hasPrice && canConvert ? +(usd * usdRate / targetRate).toFixed(2) : ''

  return {
    product_id: choice.productId,
    product_collection: 'range_products',
    product_variant_index: choice.variantIndex,
    product_variant_sku: choice.sku,
    product_name: [choice.name, choice.sku || choice.detail].filter(Boolean).join(' · '),
    product_category: choice.category,
    product_description: choice.sku ? choice.detail : choice.description,
    hero_image: choice.image || null,
    product_unit: 'pcs',
    // A Gift Range wholesale price is not an internal cost. Do not invent a
    // margin by reusing it as one; the costing model is variant-specific.
    unit_cost_hkd: null,
    tooling_cost_hkd: null,
    tiers: [{ quantity: Number(choice.moq) > 0 ? Number(choice.moq) : '', price, currency: quoteCurrency }],
    status: 'active',
  }
}

// Keep the source collection and exact SKU when a client quote becomes a PI.
// Older quote rows lacked product_collection and were corporate gifts.
export function quoteItemToOrderLine(item, index) {
  const tier = (item.tiers || [])[0] || { quantity: '', price: '' }
  const isCatalogue = !item.is_custom && !!item.product_id
  const isRange = isCatalogue && item.product_collection === 'range_products'
  return {
    line_no: index + 1,
    item_code: isRange ? item.product_variant_sku || '' : '',
    description: item.product_name || item.product_description || '',
    qty_ordered: tier.quantity ?? '',
    unit: item.product_unit || 'pcs',
    tier_remarks: tier.remarks || '',
    unit_price: tier.price ?? '',
    line_type: isRange ? 'range' : isCatalogue ? 'corp_gift' : 'ad_hoc',
    packable: true,
    match_status: isCatalogue ? 'matched' : 'manual',
    matched_product_ref: isCatalogue
      ? { collection: isRange ? 'range_products' : 'products', id: item.product_id, name: item.product_name }
      : null,
    line_image: item.custom_image || item.hero_image || null,
  }
}
