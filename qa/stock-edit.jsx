// Exercise the stock detail editor without a login or a database.
//
// InventoryStockTab is reached at /components behind an admin login, and its
// list subscribes to Firestore. This mounts the tab with a fake `inv` config
// whose save() records the payload instead of writing, so the write path can be
// checked: which fields go, and — importantly — that stock_qty does not.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import InventoryStockTab from '../src/components/InventoryStockTab'

const ITEMS = [
  { id: 'a1', code: 'C01-1028-18-037', name: 'Swarovski PP#1028/18 Light Rose', colour: 'PI', size: '', stock_qty: 4210, reserved_qty: 0 },
  { id: 'a2', code: 'C01-1028-18-015', name: 'Swarovski PP#1028/18 Amethyst', colour: '', size: '', stock_qty: 3390, reserved_qty: 100 },
]

export function makeFakeInv(onSave) {
  return {
    collectionPath: 'crystals',
    noun: 'crystal', nounPlural: 'crystals',
    attrField: 'colour', attrLabel: 'Colour',
    cardTitle: 'Crystal', iconKey: 'gem',
    codePlaceholder: 'BDC-8232-0014-005', namePlaceholder: 'Rosaline', attrPlaceholder: 'PI',
    importExample: '',
    useItems: () => ({ items: ITEMS, loading: false }),
    save: async (id, data) => { onSave({ id, data }); return id || 'new' },
    remove: async () => {},
    importStock: async () => ({}),
    load: async () => ITEMS,
  }
}

function Harness() {
  const [log, setLog] = useState([])
  const inv = makeFakeInv(entry => setLog(l => [...l, entry]))
  return (
    <div className="min-h-screen bg-ivory p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg text-ink-90">QA — Stock detail editor</h1>
          <p className="text-xs text-ink-60">
            Expand a row to edit its details. Nothing is written; saves are logged below.
            The Light Rose colour (PI) is one of the proposals that needed a human.
          </p>
        </div>
        <InventoryStockTab inv={inv} />
        <div className="card p-4">
          <p className="text-xs text-ink-60 mb-2">Saved payloads ({log.length})</p>
          <pre id="savelog" className="text-[10px] overflow-auto">{JSON.stringify(log, null, 2)}</pre>
        </div>
      </div>
    </div>
  )
}

const el = document.getElementById('root')
const root = (window.__qaRoot ||= createRoot(el))
root.render(<Harness />)
