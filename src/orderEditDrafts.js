const PREFIX = 'oc-order-edit:'
const key = (uid, orderId, id) => PREFIX + [uid, orderId, id].map(encodeURIComponent).join(':')

export function storeOrderEditDraft(uid, orderId, draft) {
  if (!uid) return false
  try {
    localStorage.setItem(key(uid, orderId, draft.id), JSON.stringify(draft))
    return true
  } catch { return false }
}

export function loadOrderEditDrafts(uid, orderId) {
  if (!uid) return []
  const prefix = key(uid, orderId, '')
  try {
    return Object.keys(localStorage).filter(name => name.startsWith(prefix)).map(name => {
      try { return JSON.parse(localStorage.getItem(name)) } catch { return null }
    }).filter(draft => typeof draft?.id === 'string' && draft.header && typeof draft.header === 'object' && !Array.isArray(draft.header) &&
      Array.isArray(draft.lines) && draft.lines.every(line => line && typeof line === 'object' && !Array.isArray(line)) &&
      Number.isSafeInteger(draft.base?.revision) && typeof draft.savedAt === 'string').sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  } catch { return [] }
}

export function removeOrderEditDraft(uid, orderId, id) {
  try {
    if (uid) localStorage.removeItem(key(uid, orderId, id))
    return true
  } catch { return false }
}
