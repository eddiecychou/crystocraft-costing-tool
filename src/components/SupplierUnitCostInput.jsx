export default function SupplierUnitCostInput({ value, storedValue, ...props }) {
  // An existing quote can carry finer precision than the editor's normal step.
  // Keep that value valid for saves such as adding a source document.
  const storedCost = Number(storedValue)
  const keepStoredPrecision = storedValue != null && storedValue !== '' && value !== ''
    && Number(value) === storedCost && Number(storedCost.toFixed(3)) !== storedCost

  return (
    <input {...props} type="number" min="0" step={keepStoredPrecision ? 'any' : '0.001'}
           value={value} placeholder="0.000" />
  )
}
