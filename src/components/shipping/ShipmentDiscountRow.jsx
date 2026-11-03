export default function ShipmentDiscountRow({ currency, percentage, amount, onPercentageChange, onAmountChange }) {
  return (
    <div className="flex items-center justify-between pt-1 border-t border-warm-grey mt-1">
      <div className="flex items-center gap-2">
        <span className="text-ink-60">Discount</span>
        <div className="flex items-center gap-1">
          <input
            type="number" step="0.01" min="0" max="100"
            className="input py-0.5 text-xs w-16 text-right"
            value={percentage}
            onChange={onPercentageChange}
            placeholder="0"
          />
          <span className="text-xs text-ink-60">%</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-ink-60">−  {currency}</span>
        <input
          type="number" step="0.01" min="0"
          className="input py-0.5 text-xs w-20 text-right font-mono text-red-600"
          value={amount}
          onChange={onAmountChange}
          placeholder="0.00"
        />
      </div>
    </div>
  )
}
