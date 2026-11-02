// Actual controlled presentation + actual stock-status helper, no service calls.
import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { orderStockStatus } from '../src/orderStockStatus.js'

const require = createRequire(import.meta.url)
let dom, scratch, ui, createRoot, root, host, errors, originalError
const render = async element => { await act(async () => root.render(element)) }
const erpCheck = (count = 1) => ({ soNo: 'SO-FICTIONAL', erp: Array.from({ length: count }, (_, i) => ({ item_code: 'QA-' + i })), diff: { differing: [], onlyParsed: [], onlyErp: [] }, adopted: false })
const cfgs = ['metal', 'crystal', 'packaging'].map(name => ({ cardTitle: name, order: { committed: name + '_done', legacyIssued: name + '_legacy', reserved: name + '_reserved', gaps: name + '_gaps' } }))
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>')
  for (const key of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  scratch = await mkdtemp(join(tmpdir(), 'oc-shipment-display-'))
  await build({ entryPoints: ['src/components/shipping/ShipmentReconciliation.jsx'], outfile: join(scratch, 'ui.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    plugins: [{ name: 'real-react-runtime', setup(b) {
      b.onResolve({ filter: /^(react(?:\/.*)?|lucide-react)$/ }, a => ({ path: require.resolve(a.path), external: true }))
    } }],
  })
  ui = await import(pathToFileURL(join(scratch, 'ui.mjs')))
})
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  errors = []; originalError = console.error; console.error = (...args) => errors.push(args.map(String).join(' '))
})
afterEach(async () => {
  try { await act(async () => root.unmount()); assert.deepEqual(errors, []) }
  finally { console.error = originalError; host.remove() }
})
after(async () => { dom?.window.close(); if (scratch) await rm(scratch, { recursive: true, force: true }) })

test('no ERP comparison is rendered before a check exists', async () => {
  await render(React.createElement(ui.ErpCrossCheck, { check: null }))
  assert.equal(host.innerHTML, '')
})
for (const count of [0, 1, 2]) test(`matching ERP comparison preserves ${count}-line count and action wording`, async () => {
  await render(React.createElement(ui.ErpCrossCheck, { check: erpCheck(count) }))
  assert.ok(host.textContent.includes(`SO-FICTIONAL found in the ERP — ${count} line${count === 1 ? '' : 's'}`))
  assert.ok(host.textContent.includes('The parsed lines match the ERP exactly.'))
  assert.equal(host.querySelector('button').textContent.trim(), "Use the ERP's lines")
  assert.ok(host.firstElementChild.classList.contains('bg-green-50'))
})

test('mismatches retain every difference, zero, precision, missing rows and escaped codes', async () => {
  const check = erpCheck(2)
  check.diff = {
    differing: [{ item_code: '中文 <QA>', fields: [{ field: 'qty', parsed: 0, erp: 500 }, { field: 'price', parsed: 1.222, erp: 3.125 }] }],
    onlyParsed: [{ item_code: '' }, { item_code: 'PDF-ONLY' }], onlyErp: [{ item_code: 'ERP-ONLY' }],
  }
  await render(React.createElement(ui.ErpCrossCheck, { check }))
  for (const text of ['中文 <QA>', 'qty read as 0', 'ERP says 500', 'price read as 1.222', 'ERP says 3.125', '(no code)', 'PDF-ONLY', 'ERP-ONLY', 'read from the PDF but not in the ERP order', 'in the ERP order but missed by the parser']) assert.ok(host.textContent.includes(text), text)
  assert.equal(host.querySelector('qa'), null)
  assert.ok(host.firstElementChild.classList.contains('bg-amber-50'))
  assert.equal(host.querySelector('button').textContent.trim(), "Use the ERP's lines (recommended)")
})
for (const mismatch of [false, true]) test(`adopted ${mismatch ? 'differing' : 'matching'} comparison hides the action`, async () => {
  const check = { ...erpCheck(), adopted: true }
  if (mismatch) check.diff.onlyErp = [{ item_code: 'EXTRA' }]
  await render(React.createElement(ui.ErpCrossCheck, { check }))
  assert.equal(host.querySelector('button'), null)
  assert.ok(host.textContent.includes("Using the ERP's lines."))
})

test('ERP adoption is explicit, uses the latest callback and never submits its enclosing form', async () => {
  let first = 0, second = 0, submits = 0
  const check = erpCheck()
  const element = onUse => React.createElement('form', { onSubmit: e => { e.preventDefault(); submits++ } }, React.createElement(ui.ErpCrossCheck, { check, onUse }))
  await render(element(() => first++))
  assert.equal(first, 0)
  assert.equal(host.querySelector('button').type, 'button')
  await act(async () => host.querySelector('button').click())
  await render(element(() => second++))
  await act(async () => host.querySelector('button').click())
  assert.deepEqual([first, second, submits], [1, 1, 0])
  assert.equal(check.adopted, false, 'Presentation does not change adoption state itself')
})

test('unknown stock before the snapshot stays hidden', async () => {
  await render(React.createElement(ui.ShipmentStockStatusBadge, { stock: null }))
  assert.equal(host.innerHTML, '')
})
test('untouched stock keeps the red warning and its existing explanation', async () => {
  await render(React.createElement(ui.ShipmentStockStatusBadge, { stock: orderStockStatus({}, cfgs) }))
  assert.equal(host.textContent.trim(), 'Stock: not recorded')
  assert.ok(host.querySelector('span').classList.contains('bg-red-50'))
  assert.equal(host.querySelectorAll('svg').length, 1)
  assert.equal(host.querySelector('span').title, 'No components, crystals or packaging have been reserved or consumed for this order.')
})
test('reserved stock and recorded gaps retain the amber warning and complete tooltip', async () => {
  const stock = orderStockStatus({ metal_reserved: true, crystal_done: true, crystal_gaps: { missing: [{ id: 'gap' }], unmatched: [] } }, cfgs)
  await render(React.createElement(ui.ShipmentStockStatusBadge, { stock }))
  assert.equal(host.textContent.trim(), 'Stock: partly recorded')
  assert.ok(host.querySelector('span').classList.contains('bg-amber-50'))
  assert.equal(host.querySelectorAll('svg').length, 1)
  assert.ok(host.querySelector('span').title.includes('metal: reserved but never consumed (production-in not done)'))
  assert.ok(host.querySelector('span').title.includes('crystal: 1 line(s) could not be reserved'))
})
test('completed touched classes remain recorded even when other classes were never used', async () => {
  await render(React.createElement(ui.ShipmentStockStatusBadge, { stock: orderStockStatus({ metal_done: true }, cfgs) }))
  assert.equal(host.textContent.trim(), 'Stock: recorded')
  assert.ok(host.querySelector('span').classList.contains('bg-green-50'))
  assert.equal(host.querySelectorAll('svg').length, 0)
  assert.equal(host.querySelector('span').title, 'All material consumption for this order has been recorded.')
})
test('updated stock props reflect gaps and then completion without retaining a stale label', async () => {
  await render(React.createElement(ui.ShipmentStockStatusBadge, { stock: orderStockStatus({ metal_done: true, metal_gaps: { unmatched: [{ id: 'line' }] } }, cfgs) }))
  assert.equal(host.textContent.trim(), 'Stock: partly recorded')
  await render(React.createElement(ui.ShipmentStockStatusBadge, { stock: orderStockStatus({ metal_legacy: true }, cfgs) }))
  assert.equal(host.textContent.trim(), 'Stock: recorded')
  assert.equal(host.querySelectorAll('svg').length, 0)
})
