// Fictional browser proof: actual Dashboard and shared clock, no live data/writes.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from '../src/pages/Dashboard'

const NativeDate = Date
let start = new NativeDate(2026, 9, 17, 12).getTime(), elapsed = performance.now()
window.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [start + performance.now() - elapsed])) }
  static now() { return start + performance.now() - elapsed }
}
globalThis.__dashboardAiCalls = []; globalThis.__dashboardSuggestionCalls = []
globalThis.__dashboardRows = { customers: [{ id: 'c1', company_name: 'QA Midnight Customer', crm_category: 'Gift / OEM' }], orders: [] }
globalThis.__dashboardWork = [
  { id: 'qa-today', customerId: 'c1', kind: 'task', state: 'waiting', text: 'Today task moves to Overdue', due_on: '2026-10-17' },
  { id: 'qa-tomorrow', customerId: 'c1', kind: 'task', state: 'todo', text: 'Tomorrow task moves to Today', due_on: '2026-10-18' },
]
function startMidnight() {
  start = new NativeDate(2026, 9, 17, 23, 59, 58).getTime(); elapsed = performance.now()
  window.dispatchEvent(new Event('focus')) // reschedule the actual midnight timer
}
createRoot(document.getElementById('root')).render(<MemoryRouter>
  <div className="p-4"><p>Fictional midnight preview · no live data or writes</p>
    <button className="btn-secondary mt-2" onClick={startMidnight}>Cross midnight in two seconds</button></div>
  <Dashboard />
</MemoryRouter>)
