import { asOcDate } from './ocTime.js'

// Cooldowns are elapsed durations, not a reset at local or Hong Kong midnight.
// Timestamp instances, REST timestamps and legacy OC wall times share one parser.
export function outreachDaysAgo(value, now = Date.now()) {
  if (!value) return Infinity
  const ms = asOcDate(value).getTime()
  return Number.isFinite(ms) ? (now - ms) / 86400000 : 0 // unknown history: exclude conservatively
}
export function outreachBlocked(value, now = Date.now()) {
  if (!value) return false
  const ms = asOcDate(value).getTime()
  return !Number.isFinite(ms) || ms > now
}
