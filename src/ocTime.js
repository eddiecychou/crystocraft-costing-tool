// OC business dates use Hong Kong time, independent of the operator's device.
export const OC_TIME_ZONE = 'Asia/Hong_Kong'
const HK_OFFSET = 8 * 60 * 60 * 1000

export function ocDateOnly(value) {
  if (!value) return ''
  // A chosen due date is already a business date; never timezone-shift it.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = value.toDate?.() || new Date(value.seconds != null ? value.seconds * 1000 : value)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() + HK_OFFSET).toISOString().slice(0, 10)
}

export function untilHongKongMidnight(now) {
  // Modern Hong Kong is UTC+8 with no daylight-saving clock changes.
  const next = new Date(now.getTime() + HK_OFFSET)
  next.setUTCHours(24, 0, 0, 0)
  return Math.max(1, next.getTime() - HK_OFFSET - now.getTime())
}

export function formatOcDateTime(value, options = {}) {
  return new Date(value).toLocaleString('en-GB', { ...options, timeZone: OC_TIME_ZONE })
}
