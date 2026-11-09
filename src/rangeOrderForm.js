import { brandLetter, designNumber, brandSortRank, galleryUrl } from './constants'
import { wsPriceFactor, convertFromUSD } from './currency'
import { buildRangeSku } from './rangeSku'
import { rangeCatalogueVariantLabel } from './rangeCatalogueLabels'

export const AS_SHOWN = '__AS_SHOWN__'
export const orderFormEligible = product => product.active !== false && product.status !== 'retired'
export const orderFormPrecision = currency => currency === 'HKD' ? 1 : 2

const positive = value => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0
const knownQuantity = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null

export function orderFormVariants(product) {
  if (Array.isArray(product.variants) && product.variants.length) return product.variants
  return (product.finishes || []).map(finish => ({
    ...finish, brand_code: brandLetter(product.design_code) || '',
    plating_code: finish.finish_code || '', plating_name: finish.finish_name || '',
  }))
}

// Project buyer-safe fields only. Neither complete product/profile objects nor
// supplier costs, BOMs, private notes or source attachments enter the workbook.
export function prepareRangeOrderForm(products, { colors = [], profile = null, rates = {}, availabilityById = {}, generatedAt = new Date() } = {}) {
  const currency = profile?.base_currency || 'USD'
  const precision = orderFormPrecision(currency)
  const factor = wsPriceFactor(profile)
  const lookup = new Map(colors.map(color => [color.code, color]))
  const used = new Set(), rows = []
  const eligible = products.filter(orderFormEligible)
  for (const product of eligible) {
    const variants = orderFormVariants(product)
    const design = product.design_no || designNumber(product.design_code)
    const options = variants.length ? variants : [{}]
    options.forEach((variant, index) => {
      const brand = variant.brand_code || brandLetter(product.design_code) || 'D'
      const code = [`${brand}${design}`, product.format_code].filter(Boolean).join('-')
      const choice = Array.isArray(variant.crystal_colors) && variant.crystal_colors.length
        ? [...new Set(variant.crystal_colors)] : [variant.crystal_code || AS_SHOWN]
      choice.forEach(color => used.add(color))
      const skuByColor = Object.fromEntries(choice.map(color => [color,
        design && product.format_code && variant.plating_code
          ? buildRangeSku({brand_code:brand, design_no:design, format:product.format_code,
              plating_code:variant.plating_code, crystal_code:color === AS_SHOWN ? '' : color, running_no:variant.running_no || ''})
          : variant.sku || code]))
      const converted = positive(variant.ws_price_usd) ? convertFromUSD(Number(variant.ws_price_usd) * factor, profile, rates) : null
      const rounded = product.status !== 'concept' && converted != null && Number.isFinite(converted) && converted > 0
        ? Number(converted.toLocaleString('en-US', { useGrouping:false, maximumFractionDigits:precision })) : null
      const price = rounded > 0 ? rounded : null
      const availability = availabilityById[product.id]
      const byPlating = availability?.byPlating
      const plating = String(variant.plating_code || '').trim().toUpperCase()
      const hasPools = byPlating && Object.keys(byPlating).length > 0
      const stock = product.status === 'stock'
        ? knownQuantity(hasPools && plating ? (Object.hasOwn(byPlating, plating) ? byPlating[plating] : 0) : availability?.qty) : null
      const pool = `${product.id || code}|${hasPools && plating ? plating : 'all'}`
      const option = rangeCatalogueVariantLabel(variant)
      rows.push({ key:`${product.id || code}:${index}`, productId:product.id || code, code,
        name:product.description || product.design_name || code, size:product.size || '',
        status:product.status === 'stock' ? 'Retired Stock' : product.status === 'concept' ? 'Concept — enquiry only' : 'Made to Order',
        option, plating:variant.plating_name || variant.plating_code || '', colors:choice, skuByColor, price, pool, stock,
        moq:positive(product.moq) ? Number(product.moq) : null,
        leadWeeks:positive(product.lead_time_weeks) ? Number(product.lead_time_weeks) : null,
        image:galleryUrl(product.gallery?.[0]) || variant.image || '',
        rank:brandSortRank(brand), review:false,
      })
    })
  }
  // Keep repeated SKU/finish rows distinct. An indistinguishable overlap needs
  // human confirmation; it must never silently select the cheapest price.
  for (const row of rows) row.review = rows.some(other => other !== row && other.productId === row.productId &&
    other.code === row.code && other.option === row.option && other.price !== row.price &&
    row.colors.some(color => other.colors.includes(color)))
  rows.sort((a,b) => a.rank-b.rank || a.code.localeCompare(b.code) || a.option.localeCompare(b.option) || a.key.localeCompare(b.key))
  const orderedColors = [...new Set([...colors.map(color => color.code), ...used])].filter(code => used.has(code))
  const columns = orderedColors.map(code => ({ code,
    name:code === AS_SHOWN ? 'As shown' : lookup.get(code)?.name || code,
    swatch:lookup.get(code)?.swatch || '' }))
  return { currency, precision, generatedAt, rows, colors:columns,
    buyer:profile?.company_name || profile?.name || profile?.email || '',
    contact:profile?.contact_name || '', email:profile?.email || '',
    productCount:eligible.length }
}
