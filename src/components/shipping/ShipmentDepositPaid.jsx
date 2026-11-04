export default function ShipmentDepositPaid({
  currency, amount, invoiceTotal, error, outstandingText, onAmountChange,
}) {
  return (
    <div className="pt-2 mt-1 border-t border-warm-grey space-y-1.5">
      <div className="flex justify-between items-center gap-3">
        <label htmlFor="deposit-paid" className="text-ink-60">Deposit paid</label>
        <div className="flex items-center gap-1">
          <span className="text-xs text-ink-60">− {currency}</span>
          <input id="deposit-paid" type="number" step="0.01" min="0" max={invoiceTotal}
                 className="input py-0.5 text-xs w-24 text-right font-mono"
                 aria-invalid={!!error} aria-describedby={error ? 'deposit-paid-error' : undefined}
                 value={amount} onChange={onAmountChange} placeholder="0.00" />
        </div>
      </div>
      {error && <p id="deposit-paid-error" className="text-xs text-brand-600" role="alert">{error}</p>}
      {outstandingText != null && (
        <div className="flex justify-between items-center gap-3 pt-1.5 border-t border-warm-grey">
          <span className="font-semibold text-ink">Total outstanding</span>
          <span className="font-mono font-bold text-ink text-base">{currency} {outstandingText}</span>
        </div>
      )}
    </div>
  )
}
