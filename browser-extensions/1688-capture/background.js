const PORTAL_ORIGIN = 'https://portal.crystocraft.com'
const CAPTURE_TTL_MS = 30 * 60 * 1000
const MAX_FULL_PAGE_CSS_HEIGHT = 30000
const MAX_STITCH_OUTPUT_PX = 12000
const SCROLL_SETTLE_MS = 350
const captureKey = id => `capture:${id}`
const is1688Detail = url => /^https:\/\/detail\.1688\.com\/offer\/\d+\.html/i.test(url || '')
const isPortalSender = url => { try { return new URL(url).origin === PORTAL_ORIGIN } catch { return false } }
function sendToPage(tabId, message = { type: 'crystocraft-capture-page' }) {
  return new Promise((resolve, reject) => chrome.tabs.sendMessage(tabId, message, response => {
    const error = chrome.runtime.lastError
    if (error) reject(new Error(error.message)); else if (!response?.ok) reject(new Error(response?.error || 'The page could not be captured.')); else resolve(response.capture)
  }))
}
function visibleScreenshot(windowId) {
  return new Promise(resolve => chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 75 }, dataUrl => resolve(chrome.runtime.lastError ? '' : (dataUrl || ''))))
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function bitmapFromDataUrl(dataUrl) {
  return createImageBitmap(await (await fetch(dataUrl)).blob())
}
async function jpegDataUrl(canvas) {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return `data:image/jpeg;base64,${btoa(binary)}`
}
async function captureFullPage(tab) {
  const prepared = await sendToPage(tab.id, { type: 'crystocraft-full-page-state', action: 'prepare' })
  const viewportHeight = Math.max(1, Number(prepared.viewport_height) || 1)
  const viewportWidth = Math.max(1, Number(prepared.viewport_width) || 1)
  const originalHeight = Math.max(viewportHeight, Number(prepared.scroll_height) || viewportHeight)
  const captureHeight = Math.min(originalHeight, MAX_FULL_PAGE_CSS_HEIGHT)
  const maxTop = Math.max(0, captureHeight - viewportHeight)
  const targets = []
  for (let top = 0; top < maxTop; top += viewportHeight) targets.push(top)
  targets.push(maxTop)
  const positions = [...new Set(targets)]
  const frames = []
  try {
    for (const top of positions) {
      const state = await sendToPage(tab.id, { type: 'crystocraft-full-page-state', action: 'scroll', top })
      await wait(SCROLL_SETTLE_MS)
      const dataUrl = await visibleScreenshot(tab.windowId)
      if (!dataUrl) throw new Error('Chrome could not take one of the page screenshots.')
      frames.push({ top: Math.max(0, Number(state.scroll_y) || 0), dataUrl })
    }
  } finally {
    await sendToPage(tab.id, { type: 'crystocraft-full-page-state', action: 'restore' }).catch(() => {})
  }
  const first = await bitmapFromDataUrl(frames[0].dataUrl)
  const scale = first.width / viewportWidth
  first.close()
  const chunkCssHeight = Math.max(viewportHeight, Math.floor(MAX_STITCH_OUTPUT_PX / scale))
  const chunkCount = Math.ceil(captureHeight / chunkCssHeight)
  const pages = []
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkTop = chunkIndex * chunkCssHeight
    const chunkBottom = Math.min(captureHeight, chunkTop + chunkCssHeight)
    const canvas = new OffscreenCanvas(Math.round(viewportWidth * scale), Math.ceil((chunkBottom - chunkTop) * scale))
    const context = canvas.getContext('2d')
    for (const frame of frames) {
      if (frame.top >= chunkBottom || frame.top + viewportHeight <= chunkTop) continue
      const image = await bitmapFromDataUrl(frame.dataUrl)
      context.drawImage(image, 0, Math.round((frame.top - chunkTop) * scale))
      image.close()
    }
    pages.push(await jpegDataUrl(canvas))
  }
  return {
    full_page_screenshot_data_urls: pages,
    full_page_capture: { captured_height: captureHeight, original_height: originalHeight, segment_count: pages.length, truncated: originalHeight > captureHeight },
  }
}
chrome.action.onClicked.addListener(async tab => {
  if (!is1688Detail(tab.url)) { await chrome.action.setBadgeText({ tabId: tab.id, text: '!' }); return }
  try {
    // Keep the quick preview at the original page position. The full-page
    // capture scrolls the listing immediately afterwards and then restores it.
    const [capture, screenshot] = await Promise.all([sendToPage(tab.id), visibleScreenshot(tab.windowId)])
    const fullPage = await captureFullPage(tab)
    const captureId = crypto.randomUUID()
    await chrome.storage.local.set({ [captureKey(captureId)]: { ...capture, ...fullPage, capture_id: captureId, screenshot_data_url: screenshot, expires_at: Date.now() + CAPTURE_TTL_MS } })
    await chrome.tabs.create({ url: `${PORTAL_ORIGIN}/sourcing-captures/import?capture_id=${encodeURIComponent(captureId)}&extension_id=${encodeURIComponent(chrome.runtime.id)}`, openerTabId: tab.id })
  } catch { await chrome.action.setBadgeText({ tabId: tab.id, text: '!' }) }
})
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'crystocraft-get-capture' || !isPortalSender(sender.url)) return
  const captureId = String(message.capture_id || '')
  if (!/^[a-f0-9-]{36}$/i.test(captureId)) return sendResponse({ ok: false, error: 'Invalid capture identifier.' })
  chrome.storage.local.get(captureKey(captureId)).then(result => {
    const capture = result[captureKey(captureId)]
    if (!capture || capture.expires_at < Date.now()) { chrome.storage.local.remove(captureKey(captureId)); sendResponse({ ok: false, error: 'This capture has expired. Return to 1688 and capture it again.' }); return }
    sendResponse({ ok: true, capture })
  }).catch(() => sendResponse({ ok: false, error: 'The capture could not be read.' }))
  return true
})
chrome.alarms.create('crystocraft-capture-cleanup', { periodInMinutes: 30 })
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'crystocraft-capture-cleanup') return
  const all = await chrome.storage.local.get(null)
  const expired = Object.entries(all).filter(([key, value]) => key.startsWith('capture:') && value?.expires_at < Date.now()).map(([key]) => key)
  if (expired.length) await chrome.storage.local.remove(expired)
})
