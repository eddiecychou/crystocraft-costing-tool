// Actual portal page, HTTP client and invoice merge. Only Auth and HTTP are fictional.
import assert from 'node:assert/strict'
import {MessageChannel} from 'node:worker_threads'
import {before, test} from 'node:test'
import {build} from 'esbuild'
import {JSDOM} from 'jsdom'

let script
before(async () => {
  const bundle = await build({
    stdin: {resolveDir:process.cwd(), loader:'jsx', contents:`
      import {act} from 'react'
      import {createRoot} from 'react-dom/client'
      import OrderHistoryPage from './src/customer/OrderHistoryPage'
      const root = createRoot(document.getElementById('root'))
      window.run = act
      window.show = (uid, company) => {
        window.fixtureUid = uid
        return act(() => root.render(<OrderHistoryPage profile={{id:uid,customer_id:company}}/>))
      }
      window.unmount = () => act(() => root.unmount())
    `},
    jsx:'automatic', bundle:true, write:false,
    plugins:[{name:'fictional-auth', setup(b) {
      b.onResolve({filter:/^\.\/firebase$/}, () => ({path:'auth',namespace:'fixture'}))
      b.onLoad({filter:/.*/,namespace:'fixture'}, () => ({contents:
        'export const authedUser = async () => ({getIdToken:async () => window.fixtureUid})'}))
    }}],
  })
  script = bundle.outputFiles[0].text
})

function fixture(t, advanceTimeout = false) {
  const dom = new JSDOM('<div id="root"></div>', {url:'https://portal.example.test',runScripts:'outside-only'})
  const w = dom.window, calls = []
  let timeouts
  if (advanceTimeout) {
    timeouts = new Map()
    const set = w.setTimeout.bind(w), clear = w.clearTimeout.bind(w)
    w.setTimeout = (fn, delay, ...args) => {
      if (delay !== 30000) return set(fn, delay, ...args)
      const id = Symbol()
      timeouts.set(id, fn)
      return id
    }
    w.clearTimeout = id => typeof id === 'symbol' ? timeouts.delete(id) : clear(id)
  }
  const channels = []
  w.MessageChannel = class extends MessageChannel {
    constructor() { super(); channels.push(this) }
  }
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.fetch = (url, options) => new Promise(resolve => {
    assert.equal(url, '/api/customer-order-history')
    const {action} = JSON.parse(options.body)
    calls.push({action, owner:options.headers.Authorization, signal:options.signal,
      respond:(status,data) => w.run(async () => resolve(Response.json(data, {status})))})
  })
  w.eval(script)
  t.after(async () => { await w.unmount(); w.close(); for (const c of channels) { c.port1.close(); c.port2.close() } })
  return {
    expire:() => w.run(() => { for (const fn of timeouts.values()) fn(); timeouts.clear() }),
    show:(owner, company='shared-fictional-company') => w.show(owner,company),
    calls,
    button:name => [...w.document.querySelectorAll('button')].find(b => b.textContent.trim() === name),
    retry:name => w.run(() => {
      const button = [...w.document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Retry '+name)
      assert.ok(button, name+' retry is available')
      button.click()
    }),
    text:() => w.document.body.textContent,
    links:() => [...w.document.querySelectorAll('a')].map(a=>a.getAttribute('href')),
  }
}
const oc = {id:'fictional-order',no:'SI991001',original:true,date:'2026-01-02',amount:25}
const jes = {code:'SI980010',date:'2026-01-01',amount:30}

for (const failed of ['OC','JES']) {
  test(failed+' outage keeps the other source visible while loading, failed and retrying', async t => {
    const page = fixture(t)
    await page.show('fictional-maple')
    const ocFailed = failed === 'OC'
    const missingAction = ocFailed ? 'oc-history' : 'history'
    const healthy = page.calls.find(c => c.action !== missingAction)
    const down = page.calls.find(c => c.action === missingAction)
    await healthy.respond(200,{rows:ocFailed ? [jes] : [oc]})
    const visible = ocFailed ? jes.code : oc.no
    assert.ok(page.text().includes(visible))
    assert.ok(page.text().includes('Loading '+failed+' invoices'))
    await down.respond(503,{error:'fictional source down'})
    assert.ok(page.text().includes(failed+' invoice history is temporarily unavailable'))
    assert.ok(page.text().includes(visible))
    await page.retry(failed)
    assert.ok(page.text().includes(visible))
    assert.equal(page.button('Retry '+failed),undefined)
    assert.deepEqual(page.calls.map(c=>c.action),['oc-history','history',missingAction])
    await page.calls[2].respond(200,{rows:ocFailed ? [oc] : [jes]})
    assert.deepEqual(page.links(),['/shop/invoice/app-fictional-order?si=SI991001','/shop/invoice/erp-SI980010'])
    assert.doesNotMatch(page.text(),/Retry|unavailable|Loading/)
  })
}

test('empty and shared notices wait for both sources to succeed, including after repeat failures', async t => {
  const page = fixture(t)
  await page.show('fictional-cedar')
  await page.calls[0].respond(503,{})
  await page.calls[1].respond(200,{rows:[{}]})
  assert.ok(page.button('Retry OC') && page.button('Retry JES'))
  assert.doesNotMatch(page.text(),/No invoices on file|Not linked/)
  await page.retry('JES')
  await page.calls[2].respond(200,{rows:[],shared:true})
  assert.doesNotMatch(page.text(),/No invoices on file|Not linked/)
  await page.retry('OC')
  await page.calls[3].respond(200,{})
  assert.ok(page.button('Retry OC'))
  await page.retry('OC')
  await page.calls[4].respond(200,{rows:[]})
  assert.match(page.text(),/Not linked to this account/)
  await page.show('fictional-maple')
  assert.doesNotMatch(page.text(),/Not linked|No invoices on file/)
  await page.calls[5].respond(200,{rows:[]})
  await page.calls[6].respond(200,{rows:[]})
  assert.match(page.text(),/No invoices on file yet/)
})

test('switching buyers drops old rows immediately and ignores a late retry', async t => {
  const page = fixture(t)
  await page.show('fictional-maple')
  await page.calls[0].respond(200,{rows:[oc]})
  await page.calls[1].respond(503,{})
  await page.retry('JES')
  await page.show('fictional-cedar')
  assert.deepEqual(page.links(),[])
  assert.ok(page.calls[2].signal.aborted)
  await page.calls[2].respond(200,{rows:[jes]})
  assert.deepEqual(page.links(),[])
  assert.equal(page.calls[4].owner,'Bearer fictional-cedar')
  await page.calls[4].respond(200,{rows:[{code:'SI980099'}]})
  await page.calls[3].respond(200,{rows:[]})
  assert.deepEqual(page.links(),['/shop/invoice/erp-SI980099'])
})

test('a timed-out source can recover while the healthy source stays visible', async t => {
  const page = fixture(t,true)
  await page.show('fictional-cedar')
  await page.calls[0].respond(200,{rows:[oc]})
  await page.expire()
  assert.ok(page.button('Retry JES'))
  assert.ok(page.calls[1].signal.aborted)
  assert.deepEqual(page.links(),['/shop/invoice/app-fictional-order?si=SI991001'])
  await page.retry('JES')
  await page.calls[1].respond(200,{rows:[{code:'LATE'}]})
  assert.doesNotMatch(page.text(),/LATE/)
  await page.calls[2].respond(200,{rows:[jes]})
  assert.deepEqual(page.links(),['/shop/invoice/app-fictional-order?si=SI991001','/shop/invoice/erp-SI980010'])
})
