import { useState } from 'react'
import { CUSTOMER_CURRENCIES, useRates, fromUSD } from '../../currency'
export default function InvitePricingDialog({ contact, onConfirm, onCancel, busy }) {
  const rates = useRates()
  const [cur, setCur] = useState('USD')
  const [fxRate, setFxRate] = useState('')
  const [disc, setDisc] = useState(100)
  const [override, setOverride] = useState('')
  const liveRate = cur === 'USD' ? 1 : fromUSD(1, cur, rates)

  // Close only on a click that ORIGINATES on the backdrop itself, not one
  // that merely bubbles up to it — relying only on the content div's
  // stopPropagation() below closed the dialog the moment an admin touched
  // the currency <select> (reported live, 2026-09-24: "first time I click
  // it, when I change the exchange rate, it will quit" — the second attempt
  // worked because the browser's already-open-once select dropdown behaves
  // differently). A native <select>'s dropdown list is a browser popup, not
  // a DOM descendant of our content div, so an option click's event can
  // reach this backdrop without ever passing through — through stopPropagation
  // to catch. e.target === e.currentTarget is the standard, robust guard.
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onCancel()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleBackdropClick}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-none shadow-xl max-w-md w-full p-6">
        <h2 className="text-sm text-ink-80 mb-1">Set pricing before inviting</h2>
        <p className="text-xs text-ink-60 mb-4">
          {contact.name || contact.email} will get portal access as soon as they set a password — there's no
          separate approval step to catch this later, so set it now. Leave as default and it can still be
          changed afterward on the account's own page.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <label className="text-xs text-ink-60">Base currency
            <select className="input py-1.5 mt-1 w-full" value={cur} onChange={e => setCur(e.target.value)}>
              {CUSTOMER_CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
          {cur !== 'USD' && (
            <label className="text-xs text-ink-60"
              title={`Fixed rate: how many ${cur} per 1 USD. Locks this customer's prices regardless of daily rates. ${
                liveRate
                  ? `Leave blank to use the live rate (currently ≈ ${liveRate.toFixed(4)}).`
                  : `There is no live ${cur} rate on file — set one here, or this account sees no prices at all. Fetch live rates in Settings to populate it.`
              }`}>
              Fixed {cur}/USD rate
              <input type="number" min="0" step="0.0001" placeholder={liveRate ? liveRate.toFixed(4) : 'live'}
                className="input py-1.5 mt-1 w-full" value={fxRate} onChange={e => setFxRate(e.target.value)} />
            </label>
          )}
          <label className="text-xs text-ink-60" title="Percentage of the list (ex-factory) price this customer pays. 100 = list price, 130 = +30% markup, 90 = 10% discount.">
            Figurine Gift Catalogue — WS %
            <input type="number" min="1" step="0.5" placeholder="100" className="input py-1.5 mt-1 w-full"
              value={disc} onChange={e => setDisc(e.target.value)} />
          </label>
          <label className="text-xs text-ink-60" title="Sell price = product cost × this markup (e.g. 2.0 = cost doubled).">
            Corp Gift Catalogue — Markup ×
            <input type="number" min="0" step="0.05" placeholder="2.0" className="input py-1.5 mt-1 w-full"
              value={override} onChange={e => setOverride(e.target.value)} />
          </label>
        </div>
        <div className="flex gap-3 justify-end">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy}
            onClick={() => onConfirm({
              baseCurrency: cur,
              fxRate: cur !== 'USD' && fxRate !== '' ? Number(fxRate) : null,
              wsDiscountPct: disc !== '' ? Number(disc) : 100,
              corpMarkupOverride: override !== '' ? Number(override) : 0,
            })}>
            {busy ? 'Sending invite…' : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  )
}
