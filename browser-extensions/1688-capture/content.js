/* User-triggered capture only: no navigation, API calls, login bypass or crawl. */
const clean = (value, max = 2000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
const unique = values => [...new Set(values.filter(Boolean))]

function firstText(selectors) {
  for (const selector of selectors) {
    const node = document.querySelector(selector)
    const value = clean(node?.innerText || node?.textContent || '')
    if (value) return value
  }
  return ''
}
function imageUrls() {
  const urls = []
  for (const image of document.images) {
    const src = image.currentSrc || image.src || image.getAttribute('data-src') || ''
    if (/^https?:\/\//i.test(src)) urls.push(src)
  }
  const ogImage = document.querySelector('meta[property="og:image"]')?.content
  if (ogImage) urls.unshift(ogImage)
  return unique(urls).slice(0, 30)
}
function selectedText() {
  const nodes = [...document.querySelectorAll('[aria-selected="true"], [aria-checked="true"], input:checked, option:checked')]
  return clean(unique(nodes.map(node => node.closest('label, li, button, div')?.innerText || node.value || '')).join(' | '), 1200)
}
function capture() {
  const offerMatch = location.pathname.match(/offer\/(\d+)\.html/i)
  const sourceUrl = new URL(location.href); sourceUrl.hash = ''
  const shopLink = [...document.querySelectorAll('a[href]')].map(link => link.href).find(href => /(?:shop|company)\d*\.1688\.com|sale\.1688\.com/i.test(href)) || ''
  const title = firstText(['h1', '[class*="title"]']) || clean(document.querySelector('meta[property="og:title"]')?.content || document.title, 500)
  return {
    schema_version: 1, provider: '1688', source_url: sourceUrl.toString(), offer_id: offerMatch?.[1] || '', page_title: title,
    supplier_name_visible: firstText(['[class*="company"]', '[class*="supplier"]', '[class*="shop-name"]']), shop_url: shopLink,
    selected_options_visible: selectedText(), visible_text: clean(document.body?.innerText || '', 24000), image_urls: imageUrls(), captured_at: new Date().toISOString(),
  }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'crystocraft-capture-page') return
  try { sendResponse({ ok: true, capture: capture() }) }
  catch (error) { sendResponse({ ok: false, error: error?.message || 'The page could not be captured.' }) }
})
