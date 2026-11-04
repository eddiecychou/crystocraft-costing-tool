export default function ShipmentAccountingTotal({
  currency, amount, computedTotalText, adjustmentText, positiveAdjustment, reason, onAmountChange, onReasonChange,
}) {
  return (
    <div className="pt-2 mt-1 border-t border-warm-grey space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-ink-60" title="What finance records for this invoice. Blank uses the Total Amount above.">Accounting Total</span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-ink-60">{currency}</span>
          <input type="number" step="0.01" className="input py-0.5 text-xs w-24 text-right font-mono"
                 value={amount} onChange={onAmountChange}
                 placeholder={computedTotalText} />
        </div>
      </div>
      {adjustmentText != null && (
        <>
          <div className="flex justify-between items-center text-xs">
            <span className="text-amber-600">Adjustment</span>
            <span className="font-mono text-amber-600">{positiveAdjustment ? '+' : ''}{currency} {adjustmentText}</span>
          </div>
          <div>
            <input className="input py-1 text-xs" value={reason}
                   onChange={onReasonChange}
                   placeholder="Reason for the adjustment (required)" />
          </div>
        </>
      )}
    </div>
  )
}
