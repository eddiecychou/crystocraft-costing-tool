export function ShipmentSubtotalRows({ currency, subtotalText, statedSubtotalText, subtotalMatch, chargesText }) {
  return (
    <>
      {/* Computed subtotal vs PI stated */}
      <div className="flex justify-between items-center">
        <span className="text-ink-60">Computed subtotal</span>
        <span className="font-mono font-medium text-ink">{currency} {subtotalText}</span>
      </div>
      {statedSubtotalText != null && (
        <div className="flex justify-between items-center">
          <span className="flex items-center gap-1.5 text-ink-60">
            PI stated subtotal
            {subtotalMatch
              ? <span className="text-green-600 text-xs">✓ match</span>
              : <span className="text-amber-600 text-xs">⚠ mismatch</span>}
          </span>
          <span className={`font-mono text-sm ${subtotalMatch ? 'text-ink-60' : 'text-amber-600 font-medium'}`}>
            {currency} {statedSubtotalText}
          </span>
        </div>
      )}

      {/* Charges — flat-amount lines (freight, insurance, etc.) with no qty */}
      {chargesText != null && (
        <div className="flex justify-between items-center">
          <span className="text-ink-60">Charges (freight, insurance, etc.)</span>
          <span className="font-mono text-ink">+ {currency} {chargesText}</span>
        </div>
      )}
    </>
  )
}

export function ShipmentTotalRow({ currency, totalText, statedTotalText }) {
  return (
    <div className="flex justify-between items-center pt-1.5 border-t border-warm-grey mt-0.5">
      <span className="font-semibold text-ink">Total Amount</span>
      <div className="text-right">
        <span className="font-mono font-bold text-ink text-base">{currency} {totalText}</span>
        {statedTotalText != null && (
          <div className="text-xs text-amber-600">PI states {currency} {statedTotalText}</div>
        )}
      </div>
    </div>
  )
}
