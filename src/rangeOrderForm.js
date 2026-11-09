import { designNumber, galleryUrl } from './constants'
import { wsPriceFactor, convertFromUSD } from './currency'
import { buildRangeSku } from './rangeSku'
import { rangeCatalogueVariantLabel } from './rangeCatalogueLabels'

export const AS_SHOWN = '__AS_SHOWN__'
export const orderFormEligible = product => product.active !== false && product.status !== 'retired'
export const orderFormPrecision = currency => currency === 'HKD' ? 1 : 2

const positive = value => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0
const natural = new Intl.Collator('en', { numeric:true, sensitivity:'base' })
const figurines = ['U','D','A','H','M']
const codeParts = code => {
  const [,prefix='',design='',format=''] = String(code).match(/^([A-Za-z]+)([^-]*)(?:-(.*))?$/) || []
  return { prefix:prefix.toUpperCase(), design, format }
}
const seriesRank = prefix => figurines.includes(prefix) ? 0 : prefix === 'UA' ? 1 : prefix === 'UB' ? 2 : 3
const fallbackBrand = product => {
  const prefix=String(product.design_code||'').match(/^[A-Za-z]+/)?.[0]||''
  return /^[A-Za-z]/.test(String(product.design_no||'')) ? prefix.slice(0,1) : prefix
}

// Keep crystal-brand versions of one design/format together. UA/UB and other
// body/accessory series follow the classic figurines, irrespective of number.
function compareRows(a,b) {
  const x=codeParts(a.code),y=codeParts(b.code),rank=seriesRank(x.prefix)-seriesRank(y.prefix)
  return rank || (seriesRank(x.prefix)>0 ? natural.compare(x.prefix,y.prefix) : 0) ||
    natural.compare(x.design,y.design) || natural.compare(x.format,y.format) ||
    figurines.indexOf(x.prefix)-figurines.indexOf(y.prefix) ||
    natural.compare(a.platingCode,b.platingCode) || natural.compare(a.option,b.option) || natural.compare(a.key,b.key)
}

function crystalLabel(option,plating) {
  // Remove only the conventional structured finish suffix. Keep free-form
  // specifications intact, including premium crystal distinctions.
  const comma=option.lastIndexOf(',')
  if(comma<0 || !plating)return option
  const tail=option.slice(comma+1).trim().toLowerCase(),finish=plating.trim().toLowerCase()
  return tail===finish || tail===finish+' plated' ? option.slice(0,comma).trim() : option
}

export function orderFormVariants(product) {
  if (Array.isArray(product.variants) && product.variants.length) return product.variants
  return (product.finishes || []).map(finish => ({
    ...finish, brand_code: fallbackBrand(product),
    plating_code: finish.finish_code || '', plating_name: finish.finish_name || '',
  }))
}

// Project buyer-safe fields only. Neither complete product/profile objects nor
// supplier costs, BOMs, private notes or source attachments enter the workbook.
export function prepareRangeOrderForm(products, { colors = [], profile = null, rates = {}, generatedAt = new Date() } = {}) {
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
      const brand = variant.brand_code || fallbackBrand(product) || 'D'
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
      const plating = String(variant.plating_code || '').trim().toUpperCase()
      const option = rangeCatalogueVariantLabel(variant)
      rows.push({ key:`${product.id || code}:${index}`, productId:product.id || code, code,
        name:product.description || product.design_name || code, size:product.size || '',
        status:product.status === 'stock' ? 'Retired Stock' : product.status === 'concept' ? 'Concept — enquiry only' : 'Made to Order',
        option, crystalOption:crystalLabel(option,variant.plating_name || ''),
        plating:variant.plating_name || variant.plating_code || '', platingCode:plating,
        runningNo:String(variant.running_no || ''), colors:choice, skuByColor, price,
        image:galleryUrl(product.gallery?.[0]) || variant.image || '',
        review:false,
      })
    })
  }
  // Keep repeated SKU/finish rows distinct. An indistinguishable overlap needs
  // human confirmation; it must never silently select the cheapest price.
  for (const row of rows) row.review = rows.some(other => other !== row && other.productId === row.productId &&
    other.code === row.code && other.option === row.option && other.price !== row.price &&
    row.colors.some(color => other.colors.includes(color)))
  rows.sort(compareRows)
  const orderedColors = [...new Set([...colors.map(color => color.code), ...used])].filter(code => used.has(code))
  const columns = orderedColors.map(code => ({ code,
    name:code === AS_SHOWN ? 'As shown' : lookup.get(code)?.name || code,
    swatch:lookup.get(code)?.swatch || '' }))
  return { currency, precision, generatedAt, rows, colors:columns,
    buyer:profile?.company_name || profile?.name || profile?.email || '',
    contact:profile?.contact_name || '', email:profile?.email || '',
    productCount:eligible.length }
}
