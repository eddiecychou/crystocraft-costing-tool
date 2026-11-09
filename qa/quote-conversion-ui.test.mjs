// Current form/QuoteDetail/Router and commercial mapping; fictional service I/O.
// Actual server transaction/rules proof lives in quote-conversion-emulator.mjs.
import { test as nodeTest, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import {
  referenceFixtureQuoteAction,
  fixtureSourceToken
} from './quote-conversion-page-fixture.mjs'
import { duplicateQuoteFields } from '../src/quoteConversionModel.js'
const test = (name, fn) => nodeTest(name, { timeout: 10000 }, fn)
const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://fictional.test' })
for (const key of [
  'window',
  'document',
  'HTMLElement',
  'Event',
  'MouseEvent',
  'FileReader'
])
  globalThis[key] = dom.window[key]
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { MemoryRouter, Routes, Route, useNavigate, useLocation } = await import(
  'react-router-dom'
)
const { createRoot } = await import('react-dom/client'),
  { Simulate } = await import('react-dom/test-utils')
let scratch, Page, QuotePage, f, active, originalFetch, originalError, errors
const contexts = []
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const fixtureSource = await readFile('qa/shipment-references.test.mjs', 'utf8')
const stubs = Function(
  'return (' +
    fixtureSource.slice(
      fixtureSource.indexOf('const stubs=') + 'const stubs='.length,
      fixtureSource.indexOf('\nbefore(async()=>{')
    ) +
    ')'
)()
delete stubs.router
delete stubs.soNumber
stubs.quoteConversionModel =
  'export const quoteSourceToken=async(...a)=>globalThis.__shipmentReferences.sourceToken(...a);export const duplicateQuoteFields=q=>globalThis.__shipmentReferences.duplicateQuote(q)'
stubs.firestore = `const f=()=>globalThis.__shipmentReferences;
export const collection=(...p)=>p.flat();export const doc=(...p)=>{const parts=p.flat().filter(x=>typeof x==='string');if(parts.length%2)parts.push('fictional-'+(++f().ids));return{id:parts.at(-1),path:parts.join('/'),parts}};
export const query=(...p)=>p.flat(),orderBy=()=>{},where=()=>{},limit=()=>{},serverTimestamp=()=> 'FICTIONAL timestamp';
const data=path=>path.startsWith('client_quotes/')?f().quotes.get(path.split('/')[1]):f().records.get(path);
export {getDoc as getDocFromServer,getDocs as getDocsFromServer};export const getDoc=async ref=>{f().reads.push(ref.path);if(f().quoteReadFailure&&ref.path.startsWith('client_quotes/'))throw Error('Fictional quote read failure');const value=data(ref.path);return{id:ref.id,exists:()=>value!=null,data:()=>structuredClone(value)}};
export const getDocs=async raw=>{const path=raw.flat().filter(x=>typeof x==='string').join('/');if(path==='range_products')return{docs:[]};if(path.includes('client_quotes/'))return{docs:f().quoteItems.map((item,i)=>({id:'quote-item-'+i,data:()=>structuredClone(item)}))};return{docs:[...f().records].filter(([key])=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1).map(([key,value])=>({id:key.split('/').at(-1),ref:{path:key},data:()=>structuredClone(value)}))}};
export const onSnapshot=(raw,next)=>{const path=raw.path||raw.flat().filter(x=>typeof x==='string').join('/');if(path.startsWith('client_quotes/'))next({docs:[]});return()=>{}};
const forbidden=()=>{throw Error('Legacy client conversion write forbidden')};export{forbidden as runTransaction,forbidden as updateDoc};
export const addDoc=async(raw,value)=>{const ref=doc(raw);if(ref.path.split('/').length===2&&ref.path.startsWith('client_quotes/')){f().quotes.set(ref.id,structuredClone(value));f().addedQuotes.push({id:ref.id,data:structuredClone(value)});return ref};f().records.set(ref.path,structuredClone(value));return ref};
const fail=()=>{throw Error('Unexpected independent mutation')};export{fail as writeBatch,fail as deleteDoc,fail as setDoc,fail as increment};`
stubs.storage =
  'const fail=()=>{throw Error("No Storage access")};export{fail as ref,fail as uploadBytes,fail as getDownloadURL,fail as deleteObject}'
stubs.bankAccounts =
  'export const listBankAccounts=async()=>[];export const accountForCurrency=()=>null;export const formatBankDetails=()=>""'
stubs.customerAssets =
  'export const loadCustomerAssets=async()=>[];export const TYPE_LABEL={},CATEGORIES=[],CATEGORY_LABEL={}'
stubs.QuoteExport = 'export default()=>null'
stubs.QuoteProductPicker = 'export default()=>null'
function Bridge({ context }) {
  context.navigate = useNavigate()
  context.route = useLocation().pathname
  return null
}
const flush = async () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
async function mount(path) {
  const ctx = { host: document.createElement('div') }
  document.body.append(ctx.host)
  ctx.root = createRoot(ctx.host)
  contexts.push(ctx)
  active = ctx
  await act(async () =>
    ctx.root.render(
      React.createElement(
        MemoryRouter,
        {
          initialEntries: [path],
          future: { v7_startTransition: true, v7_relativeSplatPath: true }
        },
        React.createElement(Bridge, { context: ctx }),
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: '/shipments/new',
            element: React.createElement(Page)
          }),
          React.createElement(Route, {
            path: '/shipments/:id',
            element: React.createElement(Page)
          }),
          React.createElement(Route, {
            path: '/quotes/:id',
            element: React.createElement(QuotePage)
          }),
          React.createElement(Route, {
            path: '/elsewhere',
            element: React.createElement('p', null, 'Fictional other page')
          })
        )
      )
    )
  )
  await flush()
  return ctx
}
const go = async (path) => {
  await act(async () => active.navigate(path))
  await flush()
}
const button = (label) =>
  [...active.host.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
const click = async (el) => {
  assert.ok(Boolean(el))
  await act(async () => el.click())
  await flush()
}
const fill = async (el, value) => {
  assert.ok(Boolean(el))
  await act(async () => {
    el.value = value
    Simulate.change(el, { target: { value } })
  })
}
const submit = () => active.host.querySelector('button[type="submit"]')
const alerts = () =>
  [...active.host.querySelectorAll('[role=alert]')].map((x) => x.textContent)
const orders = () =>
  [...f.records]
    .filter(([p]) => /^orders\/[^/]+$/.test(p))
    .map(([path, data]) => ({ id: path.split('/')[1], ...data }))
const prepare = () => mount('/shipments/new?from_quote=qa-quote')
before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-conversion-ui-'))
  const plugin = {
    name: 'fictional-conversion-review',
    setup(b) {
      b.onResolve(
        {
          filter:
            /^(react(?:\/.*)?|react-dom(?:\/.*)?|react-router-dom|lucide-react|@dnd-kit\/.*)$/
        },
        (a) => ({ path: require.resolve(a.path), external: true })
      )
      b.onResolve({ filter: /^firebase\/(firestore|storage)$/ }, (a) => ({
        path: a.path.split('/')[1],
        namespace: 'fixture'
      }))
      b.onResolve({ filter: /^\.\.?\// }, (a) => {
        const name = basename(a.path).replace(/\.jsx?$/, '')
        if (name in stubs) return { path: name, namespace: 'fixture' }
      })
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
        contents: stubs[a.path],
        loader: 'js',
        resolveDir: process.cwd()
      }))
    }
  }
  for (const [name, path] of [
    ['form', 'src/pages/ShipmentForm.jsx'],
    ['quote', 'src/pages/QuoteDetail.jsx']
  ])
    await build({
      entryPoints: [resolve(path)],
      outfile: join(scratch, name + '.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      jsx: 'automatic',
      plugins: [plugin]
    })
  Page = (await import(pathToFileURL(join(scratch, 'form.mjs')))).default
  QuotePage = (await import(pathToFileURL(join(scratch, 'quote.mjs')))).default
  originalFetch = globalThis.fetch
  globalThis.fetch = () => {
    throw Error('Network forbidden')
  }
})
beforeEach(() => {
  f = {
    ids: 0,
    records: new Map(),
    quotes: new Map([
      [
        'qa-quote',
        {
          quote_type: 'built',
          customer_id: 'qa-customer',
          client_name: 'Fictional Buyer',
          quote_currency: 'USD',
          quote_no: 'FICTIONAL-QUOTE',
          status: 'draft'
        }
      ]
    ]),
    quoteItems: [
      {
        is_custom: true,
        product_name: 'Fictional quoted item',
        product_unit: 'pcs',
        tiers: [
          { quantity: 1000, price: 1.222 },
          { quantity: 2000, price: 1.111 }
        ]
      }
    ],
    transactions: [],
    updates: [],
    reads: [],
    addedQuotes: [],
    customers: [{ id: 'qa-customer', company_name: 'Fictional Buyer' }]
  }
  f.duplicateQuote = duplicateQuoteFields
  f.multipleOrders = true
  f.quoteSequence = 0
  f.quote = f.quotes.get('qa-quote')
  f.sourceToken = fixtureSourceToken
  f.quoteAction = (...args) => referenceFixtureQuoteAction(f, ...args)
  f.persistCreated = (op) => {
    f.records.set('orders/' + op.order_id, {
      ...op.payload.order,
      client_quote_id: op.quote_id,
      quote_conversion_id: op.id
    })
    op.payload.lines.forEach((line, i) =>
      f.records.set('orders/' + op.order_id + '/lines/line-' + i, line)
    )
  }
  f.invoiceAction = async () => ({ operation: null, history: [] })
  f.createdRecords = []
  f.createAttempts = 0
  f.allowCreate = true
  globalThis.__shipmentReferences = f
  errors = []
  originalError = console.error
  console.error = (...args) => errors.push(args.map(String).join(' '))
})
afterEach(async () => {
  try {
    for (const ctx of contexts) await act(async () => ctx.root.unmount())
    assert.deepEqual(errors, [])
  } finally {
    console.error = originalError
    for (const ctx of contexts.splice(0)) ctx.host.remove()
    delete globalThis.__shipmentReferences
  }
})
after(async () => {
  globalThis.fetch = originalFetch
  dom.window.close()
  if (scratch) await rm(scratch, { recursive: true, force: true })
})

test('actual Back re-entry after success shows saved order and blocks ordinary Create', async () => {
  await prepare()
  assert.equal(active.host.querySelector('h1').textContent, 'Quote orders')
  await click(submit())
  assert.equal(orders().length, 1)
  assert.equal(active.route, '/shipments/fictional-order-1')
  await go(-1)
  assert.equal(active.route, '/shipments/new')
  assert.equal(Boolean(submit()), false)
  assert.equal(
    Boolean(active.host.querySelector('a[href="/shipments/fictional-order-1"]')),
    true
  )
  assert.equal(f.createAttempts, 1)
})
test('two loaded editors do not turn the second ordinary Create into an additional order', async () => {
  const a = await prepare(),
    b = await prepare()
  active = a
  await click(submit())
  active = b
  await click(submit())
  assert.equal(orders().length, 1)
  assert.equal(f.createAttempts, 1)
  assert.equal(Boolean(submit()), false)
  assert.match(active.host.textContent, /Create additional order/)
})
test('lost prepare response exposes saved request; reopen and Resume commit once', async () => {
  await prepare()
  f.lostPrepare = true
  await click(submit())
  assert.equal(orders().length, 0)
  assert.equal(Boolean(submit()), false)
  assert.match(alerts().join(' '), /prepared response lost/)
  await go('/elsewhere')
  await go('/shipments/new?from_quote=qa-quote')
  await click(button('Resume saved conversion'))
  assert.equal(orders().length, 1)
  assert.equal(f.createAttempts, 1)
  assert.equal(active.route, '/shipments/fictional-order-1')
})
test('lost commit response shows existing order with no fresh Create or second request', async () => {
  await prepare()
  f.lostCommit = true
  await click(submit())
  assert.equal(orders().length, 1)
  assert.equal(Boolean(submit()), false)
  assert.match(alerts().join(' '), /committed response lost/)
  await click(active.host.querySelector('a[href="/shipments/fictional-order-1"]'))
  assert.equal(active.route, '/shipments/fictional-order-1')
  assert.equal(f.createAttempts, 1)
})
test('uncertain response with failed status blocks Create until saved-state check succeeds', async () => {
  await prepare()
  f.lostPrepare = true
  f.statusFailure = true
  await click(submit())
  assert.equal(Boolean(submit()), false)
  assert.equal(orders().length, 0)
  delete f.statusFailure
  await click(button('Check saved requests'))
  assert.equal(Boolean(button('Resume saved conversion')), true)
  await click(button('Resume saved conversion'))
  assert.equal(orders().length, 1)
  assert.equal(f.createAttempts, 1)
})
test('intentional additional order requires a reason and preserves first order and separate edited quantities', async () => {
  await prepare()
  await click(submit())
  const original = structuredClone(orders()[0])
  await go(-1)
  await click(button('Create additional order'))
  assert.equal(button('Review additional order').disabled, true)
  await fill(
    active.host.querySelector('textarea[maxlength="500"]'),
    'Reviewed second partial order'
  )
  await click(button('Review additional order'))
  assert.equal(Boolean(submit()), true)
  await fill(active.host.querySelector('[placeholder="Qty"]'), '500')
  await fill(active.host.querySelector('[placeholder="e.g. 56909"]'), 'Fictional PO B')
  await click(submit())
  assert.equal(orders().length, 2)
  assert.deepEqual(orders()[0], original)
  assert.equal(orders()[1].total_amount, 611)
  assert.equal(orders()[1].customer_po, 'Fictional PO B')
  const request = f.quoteRequests.filter((r) => r.action === 'prepare').at(-1)
  assert.equal(request.details.kind, 'additional')
  assert.equal(request.details.reason, 'Reviewed second partial order')
  assert.equal(f.updates.length, 0, 'no independent client quote-link write')
})
test('pending response after leaving does not hijack navigation; returning recovers the committed order', async () => {
  await prepare()
  f.prepareGate = deferred()
  await click(submit())
  assert.equal(submit().disabled, true)
  await go('/elsewhere')
  await act(async () => f.prepareGate.resolve())
  await flush()
  assert.equal(active.route, '/elsewhere')
  assert.equal(orders().length, 1)
  await go('/shipments/new?from_quote=qa-quote')
  assert.equal(Boolean(submit()), false)
  assert.equal(f.createAttempts, 1)
})
test('saved prepared quantities and Unicode notes remain readable on Resume UI', async () => {
  await prepare()
  await fill(active.host.querySelector('[placeholder="Qty"]'), '500')
  f.commitFailure = true
  await click(submit())
  assert.equal(Boolean(submit()), false)
  assert.match(active.host.textContent, /500 pcs/)
  assert.match(active.host.textContent, /Fictional quoted item/)
  assert.equal(orders().length, 0)
  delete f.commitFailure
  await click(button('Resume saved conversion'))
  const line = [...f.records].find(([p]) => p.includes('/lines/'))[1]
  assert.equal(line.qty_ordered, 500)
  assert.equal(line.unit_price, 1.222)
})
test('legacy additional order needs explicit legacy acknowledgment as well as a reason', async () => {
  f.quoteLegacy = {
    order_id: 'legacy',
    order_no: 'SO-FICTIONAL-LEGACY',
    missing: false,
    customer_matches: true,
    review_token: 'fictional-review',
    verified: false
  }
  await prepare()
  assert.equal(Boolean(submit()), false)
  await click(button('Create additional order'))
  await fill(
    active.host.querySelector('textarea[maxlength="500"]'),
    'Reviewed legacy link'
  )
  assert.equal(button('Review additional order').disabled, true)
  await click(active.host.querySelector('input[type="checkbox"]'))
  await click(button('Review additional order'))
  assert.equal(Boolean(submit()), true)
  await click(submit())
  const request = f.quoteRequests.find((r) => r.action === 'prepare')
  assert.deepEqual(request.details.legacy_review, {
    order_id: 'legacy',
    review_token: 'fictional-review'
  })
})
test('actual QuoteDetail Duplicate strips conversion metadata while preserving original attachments and notes', async () => {
  Object.assign(f.quote, {
    converted_order_id: 'existing-order',
    order_conversion_version: 3,
    latest_order_conversion_id: 'old-op',
    legacy_converted_order_id: 'legacy',
    notes: 'Original 中文 notes',
    attachments: [{ name: '原始.pdf', url: 'https://fictional.invalid/original.pdf' }]
  })
  const original = structuredClone(f.quote)
  await mount('/quotes/qa-quote')
  await click(button('Duplicate'))
  assert.equal(f.addedQuotes.length, 1)
  const copy = f.addedQuotes[0].data
  for (const key of [
    'converted_order_id',
    'order_conversion_version',
    'latest_order_conversion_id',
    'legacy_converted_order_id'
  ])
    assert.equal(copy[key], undefined)
  assert.equal(copy.notes, original.notes)
  assert.deepEqual(copy.attachments, original.attachments)
  assert.deepEqual(f.quote, original)
})

test('invalid source prices on re-entry keep committed history accessible without a new Create', async () => {
  await prepare()
  await click(submit())
  Object.assign(f.quoteItems[0], {
    product_collection: 'range_products',
    product_id: 'fictional-range',
    is_custom: false,
    tiers: [{ quantity: 1000, price: 0 }]
  })
  await go(-1)
  assert.equal(Boolean(submit()), false)
  assert.equal(
    Boolean(active.host.querySelector('a[href="/shipments/fictional-order-1"]')),
    true
  )
  assert.match(alerts().join(' '), /no quantity or positive price/)
  assert.equal(Boolean(button('Create additional order')), false)
})
test('source becoming an uploaded document still exposes the saved request and cancellation controls', async () => {
  await prepare()
  f.commitFailure = true
  await click(submit())
  f.quote.quote_type = 'uploaded'
  await go('/elsewhere')
  await go('/shipments/new?from_quote=qa-quote')
  assert.equal(Boolean(submit()), false)
  assert.equal(Boolean(button('Resume saved conversion')), true)
  assert.equal(Boolean(button('Cancel uncommitted request')), true)
  assert.match(alerts().join(' '), /uploaded document/)
})
