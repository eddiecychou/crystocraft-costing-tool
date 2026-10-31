import { formatOcDate } from '../../ocTime.js'
export function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return formatOcDate(d, { day: 'numeric', month: 'short', year: 'numeric' }, 'en-GB')
}

// WhatsApp thread docs (domain/whatsappImport.js) store dates as plain ISO
// strings, not Firestore Timestamps — fmtDate() above expects a Timestamp
// (.toDate()/.seconds) and would silently produce "Invalid Date" on a string.
export function fmtIsoDate(iso) {
  if (!iso) return '—'
  return formatOcDate(iso, { day: 'numeric', month: 'short', year: 'numeric' }, 'en-GB')
}
