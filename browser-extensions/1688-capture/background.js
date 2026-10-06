const PORTAL_ORIGIN = 'https://portal.crystocraft.com'
const CAPTURE_TTL_MS = 30 * 60 * 1000
const captureKey = id => `capture:${id}`
const is1688Detail = url => /^https:\/\/detail\.1688\.com\/offer\/\d+\.html/i.test(url || '')
const isPortalSender = url => { try { return new URL(url).origin === PORTAL_ORIGIN } catch { return false } }
function sendToPage(tabId) {
  return new Promise((resolve, reject) => chrome.tabs.sendMessage(tabId, { type: 'crystocraft-capture-page' }, response => {
    const error = chrome.runtime.lastError
    if (error) reject(new Error(error.message)); else if (!response?.ok) reject(new Error(response?.error || 'The page could not be captured.')); else resolve(response.capture)
  }))
}
function visibleScreenshot(windowId) {
  return new Promise(resolve => chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 75 }, dataUrl => resolve(chrome.runtime.lastError ? '' : (dataUrl || ''))))
}
chrome.action.onClicked.addListener(async tab => {
  if (!is1688Detail(tab.url)) { await chrome.action.setBadgeText({ tabId: tab.id, text: '!' }); return }
  try {
    const [capture, screenshot] = await Promise.all([sendToPage(tab.id), visibleScreenshot(tab.windowId)])
    const captureId = crypto.randomUUID()
    await chrome.storage.local.set({ [captureKey(captureId)]: { ...capture, capture_id: captureId, screenshot_data_url: screenshot, expires_at: Date.now() + CAPTURE_TTL_MS } })
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
