import { useEffect, useState } from 'react'
import { getPackingScenariosByOrder } from '../../packing'

export default function ClosedPackingList({ orderId }) {
  const [scenarios, setScenarios] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    getPackingScenariosByOrder(orderId).then(rows => { if (active) setScenarios(rows) })
      .catch(() => { if (active) setError('Could not load the saved packing scenarios.') })
    return () => { active = false }
  }, [orderId])
  return <section className="card p-4 space-y-3" aria-label="Saved packing lists">
    <h2 className="eyebrow">Saved packing lists</h2>
    {error ? <p role="alert">{error}</p> : !scenarios ? <p>Loading packing lists…</p> : !scenarios.length ? <p>No packing scenarios saved.</p> :
      <ul className="space-y-2">{scenarios.map(scenario => <li key={scenario.id}>
        <a className="text-brand-600 hover:underline" href={`/packing/${scenario.id}/print`} target="_blank" rel="noreferrer">{scenario.label}</a>
        {scenario.selected && <span className="ml-2 text-sm text-ink-60">Selected</span>}
      </li>)}</ul>}
  </section>
}
