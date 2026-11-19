// The account's "WS %" is the percentage of the list (ex-factory) price the
// customer pays: 100 = list price as-is, 130 = +30% markup, 90 = 10% discount.
// Stored on profile.ws_discount_pct (legacy field name). Blank / 0 / invalid ⇒
// 100 (full list price) so an unconfigured account is never priced at zero.
// Returns a multiplier (1.0 = list price). No upper clamp — markup is allowed.
export const wsPriceFactor = profile => {
  const pct = Number(profile?.ws_discount_pct)
  return Number.isFinite(pct) && pct > 0 ? pct / 100 : 1
}
