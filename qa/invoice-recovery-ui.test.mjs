import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
const require = createRequire(import.meta.url),
  dom = new JSDOM('<body></body>')
for (const k of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent'])
  globalThis[k] = dom.window[k]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client'),
  { Simulate } = await import('react-dom/test-utils')
let scratch, Panel, root, host, calls, state
const operation = {
  id: '12345678-1234-4123-8123-123456789abc',
  customer: 'Fictional buyer',
  currency: 'USD',
  purpose: 'first',
  status: 'linked',
  result: { si_no: 'SI260100', uc_no: 'UC100/26' },
  followups: { financial: { state: 'done' }, woo: { state: 'not_applicable' } }
}
before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-invoice-panel-'))
  await build({
    entryPoints: ['src/components/shipping/ShipmentInvoiceRecovery.jsx'],
    outfile: join(scratch, 'panel.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    plugins: [
      {
        name: 'react-external',
        setup(b) {
          b.onResolve({ filter: /^react(?:\/.*)?$/ }, (a) => ({
            path: require.resolve(a.path),
            external: true
          }))
        }
      }
    ]
  })
  Panel = (await import(pathToFileURL(join(scratch, 'panel.mjs')))).default
})
after(async () => {
  dom.window.close()
  await rm(scratch, { recursive: true, force: true })
})
beforeEach(() => {
  calls = []
  state = {
    expected: {
      customer: 'Fictional buyer',
      currency: 'USD',
      si: 'SI260100',
      uc: 'UC100/26'
    },
    operation: structuredClone(operation),
    history: [operation],
    canStartNew: true
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
const render = async (busy = false) =>
  act(async () =>
    root.render(
      React.createElement(Panel, {
        state,
        busy,
        hasInvoice: true,
        onAction: async (...args) => calls.push(args)
      })
    )
  )
const button = (text) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text)
const click = async (text) => act(async () => button(text).click())
const reason = async () =>
  act(async () =>
    Simulate.change(host.querySelector('textarea'), {
      target: { value: 'Reviewed fictional split' }
    })
  )
test('separate split/reissue action requires purpose/reason and sends reviewed previous operation without automatic voiding', async () => {
  await render()
  assert.equal(calls.length, 0)
  await click('New split / reissued invoice')
  assert.equal(button('Confirm').disabled, true)
  assert.match(host.textContent, /Earlier invoices remain/)
  await reason()
  await click('Confirm')
  assert.equal(calls[0][0], 'new')
  assert.equal(calls[0][1].purpose, 'split')
  assert.equal(calls[0][1].previous_operation_id, operation.id)
  await click('New split / reissued invoice')
  await act(async () =>
    Simulate.change(host.querySelector('select'), {
      target: { value: 'reissue' }
    })
  )
  await reason()
  await click('Confirm')
  assert.equal(calls[1][1].purpose, 'reissue')
})
test('issued-unlinked state shows its actual SI/UC and only resumes; customer conflict blocks reviewed linking', async () => {
  state.operation.status = 'review_required'
  state.canStartNew = false
  state.expected.customer = 'Changed buyer'
  await render()
  assert.ok(button('Resume saved request'))
  assert.equal(button('New split / reissued invoice'), undefined)
  assert.match(host.textContent, /SI260100 · UC100\/26/)
  await click('Review references')
  await reason()
  assert.equal(button('Confirm').disabled, true)
  assert.match(host.textContent, /customer\/currency differ/)
  await click('Cancel')
  await click('Resume saved request')
  assert.equal(calls[0][0], 'resume')
})
test('pending financial follow-up and history remain visible; explicit manual review requires reason and pins operation', async () => {
  state.operation.followups.financial = {
    state: 'pending',
    error: 'Manual financial edit preserved'
  }
  state.canStartNew = false
  state.moreHistory = true
  await render()
  assert.match(host.textContent, /Manual financial edit preserved/)
  assert.match(
    host.textContent,
    /Earlier requests and invoices remain retained/
  )
  await click('Record manual follow-up')
  assert.equal(button('Confirm').disabled, true)
  await reason()
  await click('Confirm')
  assert.equal(calls[0][0], 'manual_followups')
  assert.equal(calls[0][1].previous_operation_id, operation.id)
  await render(true)
  assert.equal(button('Confirming…').disabled, true)
})
