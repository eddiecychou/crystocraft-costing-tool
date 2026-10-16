// Quick entry uses the existing editor/persistence; only a new product opts in.
export const isQuickRangeEntry = (isNew, params) => isNew && params.get('quick') === '1'
export function quickRangePayload(payload, quick) {
  if (!quick) return payload
  return { ...payload, active: false, status: 'concept', variants: (payload.variants || []).map(v => ({ ...v, ws_price_usd: null })) }
}
