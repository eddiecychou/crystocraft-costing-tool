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
const render = async (busy = false, focusedFollowupId, focusedInvoiceRequestId) =>
  act(async () =>
    root.render(
      React.createElement(Panel, {
        state,
        busy,
        focusedFollowupId,
        focusedInvoiceRequestId,
        onClearRequest: () => calls.push(['clear']),
        onRefresh: () => calls.push(['refresh']),
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

test('a saved-request link recovers only the selected verified receipt and never switches to a replacement', async () => {
  const id = operation.id
  state.operation.status = 'allocated'
  state.operation.receiptStatus = 'verified'
  await render(false, undefined, id)
  assert.match(host.textContent, /Checking the selected saved invoice request/)
  assert.equal(button('Resume saved request'), undefined)
  state.focusedInvoiceRequestId = id
  await render(false, undefined, id)
  assert.match(host.textContent, /Issued receipt verified/)
  assert.equal(button('New split / reissued invoice'), undefined)
  await click('Resume saved request')
  assert.deepEqual(calls, [['resume', { previous_operation_id: id }]])
  state.operation.receiptStatus = 'not_found'
  await render(false, undefined, id)
  assert.match(host.textContent, /No issued receipt found/)
  assert.equal(button('Resume saved request'), undefined)
  state.operation = { ...operation }
  await render(false, undefined, id)
  assert.match(host.textContent, /already linked.*SI260100/)
  state.operation = { ...operation, id: '12345678-1234-4123-8123-123456789abd',
    receiptStatus: 'verified', result: {si_no:'SI260101',uc_no:'UC101/26'} }
  await render(false, undefined, id)
  assert.match(host.textContent, /no longer current/)
  assert.doesNotMatch(host.textContent, /SI260101|Resume saved request|Review references/)
  await click('View current invoice status')
  assert.deepEqual(calls.at(-1), ['clear'])
})

test('a deep link focuses only the verified follow-up and explains when it has settled', async () => {
  const split = '12345678-1234-4123-8123-123456789abd'
  state.followupChecklist = { entries: [
    { id: split, current: false, disposition: 'finance_review', result: {si_no:'SI260099',uc_no:'UC99/26'}, stages: [] },
    { id: operation.id, current: true, disposition: 'resume', result: operation.result, stages: [] },
  ] }
  await render(false, split)
  assert.match(host.textContent, /Checking the selected invoice follow-up/)
  state.focusedFollowupId = split
  await render(false, split)
  assert.equal(document.activeElement.tagName, 'LI')
  assert.match(document.activeElement.textContent, /SI260099/)
  assert.doesNotMatch(document.activeElement.textContent, /SI260100/)
  state.followupChecklist.entries.shift()
  await render(false, split)
  assert.match(document.activeElement.textContent, /no longer pending/)
  assert.equal(calls.length, 0)
})
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
test('issued-unlinked state keeps its SI and UC visible and sends a customer conflict to Finance', async () => {
  state.operation.status = 'review_required'
  state.canStartNew = false
  state.expected.customer = 'Changed buyer'
  state.linkBlocked = 'Finance review needed. The saved customer or currency changed after the invoice request started.'
  await render()
  assert.equal(button('Resume saved request'), undefined)
  assert.equal(button('New split / reissued invoice'), undefined)
  assert.equal(button('Review references'), undefined)
  assert.match(host.textContent, /SI260100 · UC100\/26/)
  assert.match(host.textContent, /Finance review needed/)
  assert.deepEqual(calls, [])
})

test('the order labels each receipt check and pauses recovery controls while evidence is unavailable or conflicts', async () => {
  state.operation.status = 'allocated'
  state.canStartNew = false
  state.operation.receiptStatus = 'verified'
  await render()
  assert.match(host.textContent, /Issued receipt verified/)
  assert.ok(button('Resume saved request'))

  state.operation.receiptStatus = 'unavailable'
  await render()
  assert.match(host.textContent, /receipt source is unavailable/)
  assert.match(host.textContent, /Saved references · SI260100/)
  assert.equal(button('Resume saved request'), undefined)
  await click('Refresh receipt status')

  state.operation.receiptStatus = 'conflict'
  await render()
  assert.match(host.textContent, /Conflicting receipt evidence.*Finance/)
  assert.equal(button('Resume saved request'), undefined)
  assert.equal(button('Review references'), undefined)

  state.operation.status = 'pending'
  state.operation.result = null
  state.operation.receiptStatus = 'not_found'
  await render()
  assert.match(host.textContent, /No issued receipt found/)
  assert.ok(button('Resume saved request'))
  assert.deepEqual(calls, [['refresh']])
})

test('link review confirmation keeps the full reference snapshot and invalidates a stale date', async () => {
  state.operation.status = 'review_required'
  state.canStartNew = false
  state.linkReviewTarget = { operationId: operation.id, expected: state.expected, si: 'SI260100', uc: 'UC100/26',
    referenceRevision: 5, references: { erp_so_no: 'SO260016', erp_pi_no: 'PI260080', invoiced_at: '2026-11-15' },
    customerId: 'fictional-buyer', invoiceId: '99' }
  await render()
  await click('Review references')
  await reason()
  assert.equal(button('Confirm').disabled, false)
  state.linkReviewTarget = { ...state.linkReviewTarget, referenceRevision: 6,
    references: { ...state.linkReviewTarget.references, invoiced_at: '2026-11-16' } }
  await render()
  assert.equal(button('Confirm').disabled, true)
  assert.match(host.textContent, /saved references changed/)
  assert.match(host.querySelector('textarea').value, /Reviewed fictional split/)
  await click('Cancel')
  await click('Review references')
  await reason()
  await click('Confirm')
  assert.equal(calls[0][0], 'link_review')
  assert.deepEqual(calls[0][1].review_expected,state.linkReviewTarget)
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
  await click('Record Finance review')
  assert.equal(button('Confirm').disabled, true)
  await reason()
  await click('Confirm')
  assert.equal(calls[0][0], 'manual_followups')
  assert.equal(calls[0][1].previous_operation_id, operation.id)
  assert.equal(calls[0][1].review_expected.si, operation.result.si_no)
  await render(true)
  assert.equal(button('Confirming…').disabled, true)
})

test('a Finance review draft stays on the reviewed split across a status refresh', async () => {
  state.operation.purpose = 'split'
  state.operation.followups.financial.state = 'pending'
  await render()
  await click('Record Finance review')
  await reason()
  state = { ...state, operation: { ...state.operation, purpose: 'reissue',
    id: '87654321-1234-4123-8123-123456789abc', result: { ...operation.result, si_no: 'SI260101' } } }
  await render()
  assert.match(host.textContent, /completed follow-up review for SI260100/)
  assert.match(host.textContent, /invoice or saved references changed/)
  assert.equal(host.querySelector('textarea').value, 'Reviewed fictional split')
  assert.equal(button('Confirm').disabled, true)
  assert.deepEqual(calls, [])
})

test('historical work is visible outside collapsed history and Finance review uses the exact old receipt', async () => {
  const historical = { id: '87654321-1234-4123-8123-123456789abc', result: { si_no: 'SI250099', uc_no: 'UC099/25' },
    current: false, disposition: 'finance_review', stages: [{ stage: 'financial', error: 'Older pending copy' }] }
  state.history = []
  state.followupChecklist = { entries: [historical] }
  state.canManage = false
  await render()
  assert.match(host.textContent, /SI250099 · UC099\/25 · Historical invoice/)
  assert.match(host.textContent, /Finance review needed/)
  assert.equal(button('Record Finance review for SI250099'), undefined)
  state.canManage = true
  await render()
  await click('Record Finance review for SI250099')
  await reason()
  await click('Confirm')
  assert.equal(calls[0][0], 'closure_review_followups')
  assert.equal(calls[0][1].previous_operation_id, historical.id)
  assert.equal(calls[0][1].review_expected.si, historical.result.si_no)
})
