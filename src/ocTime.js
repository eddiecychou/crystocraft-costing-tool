// OC business dates use Hong Kong time, independent of the operator's device.
export const OC_TIME_ZONE = 'Asia/Hong_Kong'
const HK_OFFSET = 8 * 60 * 60 * 1000

export function asOcDate(value) {
  if (value?.toDate) return value.toDate()
  if (value?.seconds != null) return new Date(value.seconds * 1000 + (value.nanoseconds || 0) / 1e6)
  if (typeof value === 'string') {
    // Date-only fields and timezone-less OC/ERP wall times belong to Hong Kong.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00+08:00`)
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) return new Date(`${value.replace(' ', 'T')}+08:00`)
    // Legacy month-name/slash dates must not fall back to device-local parsing.
    if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$|\b(?:GMT|UTC)\b/i.test(value.trim())) {
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? parsed : new Date(`${value} GMT+0800`)
    }
  }
  return new Date(value == null || value === '' ? NaN : value)
}

export function ocDateOnly(value) {
  if (!value) return ''
  // A chosen due date is already a business date; never timezone-shift it.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = asOcDate(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() + HK_OFFSET).toISOString().slice(0, 10)
}

export function untilHongKongMidnight(now) {
  // Modern Hong Kong is UTC+8 with no daylight-saving clock changes.
  const next = new Date(now.getTime() + HK_OFFSET)
  next.setUTCHours(24, 0, 0, 0)
  return Math.max(1, next.getTime() - HK_OFFSET - now.getTime())
}

export function formatOcDateTime(value, options = {}, locale = 'en-GB') {
  const d = asOcDate(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale || 'en-GB', { ...options, timeZone: OC_TIME_ZONE })
}

export function formatOcDate(value, options = {}, locale = 'en-GB') {
  const d = asOcDate(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale || 'en-GB', { ...options, timeZone: OC_TIME_ZONE })
}

export function formatOcTime(value, options = {}, locale = 'en-GB') {
  const d = asOcDate(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(locale || 'en-GB', { ...options, timeZone: OC_TIME_ZONE })
}

export const ocYear = (value = new Date()) => { const day = ocDateOnly(value); return day ? Number(day.slice(0, 4)) : NaN }

export function previousOcMonth(now = new Date()) {
  const [year, month] = ocDateOnly(now).split('-').map(Number)
  // UTC arithmetic here represents calendar dates, not stored instants.
  return { from: new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10) }
}

export function inOcLast30Days(value, now = new Date()) {
  const today = ocDateOnly(now), day = ocDateOnly(value)
  const start = new Date(`${today}T12:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 29)
  return !!day && day >= start.toISOString().slice(0, 10) && day <= today
}

export function ocDaysSince(value, now = new Date()) {
  const day = ocDateOnly(value), today = ocDateOnly(now)
  return day && today ? Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000) : null
}
