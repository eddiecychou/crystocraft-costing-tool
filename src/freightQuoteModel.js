// Incoterms a forwarder can quote on (subset relevant to freight; the full
// commercial set lives on the order).
export const FREIGHT_INCOTERMS = ['FOB', 'DAP', 'DDP']

export const QUOTE_SOURCES = [
  { value: 'rfq',              label: 'RFQ reply' },
  { value: 'wechat_bootstrap', label: 'WeChat history' },
  { value: 'manual',           label: 'Manual entry' },
]

const numOrNull = v =>
  v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v)
const str = v => (v == null ? '' : String(v)).trim()

// HKD per 1 unit of currency (same convention as currency.js / rangeCosting.js).
// CNY is aliased to the RMB rate — same currency, and the rates table (settings/
// exchange_rates) only carries one entry for it; FreightComparison.jsx's own
// currency picker offers both codes.
//
// `rates?.[currency] || 1` used to silently treat ANY currency missing from the
// rates table as 1:1 with HKD — comparing a USD quote against an RMB quote as
// if both were HKD. Returns null now instead (bug-fix pack B-05), so a caller
// can show "rate unavailable" rather than a wrong number that looks legitimate.
const toHKD = (amount, currency, rates) => {
  const a = numOrNull(amount)
  if (a == null) return null
  if (currency === 'HKD') return a
  const rate = rates?.[currency === 'CNY' ? 'RMB' : currency]
  return Number.isFinite(rate) ? a * rate : null
}

export function freightScenarioCargo(scenario) {
  return {
    cbm: scenario?.totals?.cbm ?? '',
    chargeable_weight_kg: scenario?.totals?.chargeable_weight_kg ?? '',
    cartons: scenario?.totals?.carton_count ?? '',
  }
}

export const normFreightQuote = (q, rates) => {
  const total = numOrNull(q.quoted_total)
  const currency = str(q.currency) || 'USD'
  return {
    vendor_id: str(q.vendor_id),
    vendor_name: str(q.vendor_name),
    order_id: q.order_id || null,
    scenario_id: q.scenario_id || null,
    scenario_label: str(q.scenario_label),
    lane: {
      origin: str(q.lane?.origin) || 'Shenzhen',
      dest_country: str(q.lane?.dest_country),
      dest_city: str(q.lane?.dest_city),
    },
    mode: str(q.mode),
    incoterm: FREIGHT_INCOTERMS.includes(q.incoterm) ? q.incoterm : 'FOB',
    cargo_basis: {
      chargeable_weight_kg: numOrNull(q.cargo_basis?.chargeable_weight_kg),
      cbm: numOrNull(q.cargo_basis?.cbm),
      cartons: numOrNull(q.cargo_basis?.cartons),
    },
    quoted_total: total,
    currency,
    // Normalised to HKD so quotes across currencies are comparable in history.
    quoted_total_hkd: rates ? toHKD(total, currency, rates) : numOrNull(q.quoted_total_hkd),
    breakdown: {
      freight: numOrNull(q.breakdown?.freight),
      destination_charges: numOrNull(q.breakdown?.destination_charges),
      customs: numOrNull(q.breakdown?.customs),
      duties_included: !!q.breakdown?.duties_included,
    },
    transit_days: numOrNull(q.transit_days),
    valid_until: q.valid_until || null,
    source: QUOTE_SOURCES.some(s => s.value === q.source) ? q.source : 'manual',
    source_file: q.source_file || null,
    quote_date: q.quote_date || null,
    is_chosen: !!q.is_chosen,
    decision_notes: str(q.decision_notes),
  }
}

// Saved plans have an explicit revision. Use the legacy timestamp only to
// check the exact snapshot when a plan predates atomic Packing saves.
export function packingRevision(scenario) {
  const saveId = scenario?.packing_save_id ?? null
  const stamp = scenario?.updatedAt ?? scenario?.createdAt
  return {
    save_id: saveId,
    legacy_stamp: saveId === null && stamp
      ? [stamp.seconds, stamp.nanoseconds]
      : null,
  }
}

export function freightPackingBasis(scenario) {
  return {
    revision: packingRevision(scenario),
    cargo: freightScenarioCargo(scenario),
  }
}

export function freightPackingStatus(quote, scenario) {
  if (!quote.scenario_id) return 'unlinked'
  if (!scenario) return 'unavailable'
  if (!Object.hasOwn(quote, 'scenario_revision')) return 'unknown'
  const revision = packingRevision(scenario)
  return quote.scenario_revision === revision.save_id &&
    JSON.stringify(quote.scenario_legacy_stamp ?? null) === JSON.stringify(revision.legacy_stamp)
    ? 'current' : 'changed'
}
