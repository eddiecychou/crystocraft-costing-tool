const MAX_TEXT = 24000
const MAX_TITLE = 500
const MAX_URL = 2000
const MAX_IMAGES = 30
const MAX_FULL_PAGE_SEGMENTS = 8
const clean = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
const safeUrl = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.toString().slice(0, MAX_URL) : '' } catch { return '' } }

export function extensionIdFromSearch(search) {
  const id = new URLSearchParams(search).get('extension_id') || ''
  return /^[a-p]{32}$/.test(id) ? id : ''
}
export function captureIdFromSearch(search) {
  const id = new URLSearchParams(search).get('capture_id') || ''
  return /^[a-f0-9-]{36}$/i.test(id) ? id : ''
}
export function requestExtensionCapture(extensionId, captureId) {
  return new Promise((resolve, reject) => {
    const runtime = globalThis.chrome?.runtime
    if (!runtime?.sendMessage) return reject(new Error('Chrome extension messaging is unavailable. Open this link from the Capture to OC button.'))
    runtime.sendMessage(extensionId, { type: 'crystocraft-get-capture', capture_id: captureId }, response => {
      const error = runtime.lastError
      if (error) reject(new Error('The capture extension is unavailable. Return to 1688 and capture the listing again.'))
      else if (!response?.ok) reject(new Error(response?.error || 'The capture could not be loaded.'))
      else resolve(response.capture)
    })
  })
}
// Extension data is untrusted source material. Keep stored data bounded and safe to render.
export function normaliseSourcingCapture(value) {
  const sourceUrl = safeUrl(value?.source_url)
  if (!/^https:\/\/detail\.1688\.com\/offer\/\d+\.html/i.test(sourceUrl)) throw new Error('This does not appear to be an 1688 offer capture.')
  const images = Array.isArray(value?.image_urls) ? value.image_urls.map(safeUrl).filter(Boolean).slice(0, MAX_IMAGES) : []
  const fullPageScreenshots = Array.isArray(value?.full_page_screenshot_data_urls)
    ? value.full_page_screenshot_data_urls.filter(item => typeof item === 'string' && item.startsWith('data:image/jpeg;base64,')).slice(0, MAX_FULL_PAGE_SEGMENTS)
    : []
  const fullPage = value?.full_page_capture && typeof value.full_page_capture === 'object' ? value.full_page_capture : {}
  return {
    source: { provider: '1688', offer_id: clean(value?.offer_id, 80), url: sourceUrl, shop_url: safeUrl(value?.shop_url) },
    evidence: {
      page_title: clean(value?.page_title, MAX_TITLE), supplier_name_visible: clean(value?.supplier_name_visible, MAX_TITLE),
      selected_options_visible: clean(value?.selected_options_visible, 1200), visible_text: clean(value?.visible_text, MAX_TEXT),
      image_urls: [...new Set(images)], captured_at_source: clean(value?.captured_at, 80),
    },
    screenshot_data_url: typeof value?.screenshot_data_url === 'string' && value.screenshot_data_url.startsWith('data:image/jpeg;base64,') ? value.screenshot_data_url : '',
    full_page_screenshot_data_urls: fullPageScreenshots,
    full_page_capture: {
      captured_height: Number.isFinite(Number(fullPage.captured_height)) ? Math.max(0, Number(fullPage.captured_height)) : 0,
      original_height: Number.isFinite(Number(fullPage.original_height)) ? Math.max(0, Number(fullPage.original_height)) : 0,
      segment_count: fullPageScreenshots.length,
      truncated: Boolean(fullPage.truncated),
    },
  }
}
