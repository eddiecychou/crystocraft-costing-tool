// Fresh Shipping role gates and read-only/invalid-input recovery probes. Never issue live financial numbers.
// Browser tokens remain inside their own isolated page; credentials stay local.
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const base = new URL(process.argv[2] || '')
assert.equal(base.protocol, 'https:')
assert.ok(base.hostname === 'portal.crystocraft.com' || /^[a-f0-9]{24}--ua-product-manager\.netlify\.app$/.test(base.hostname), 'Only the canonical site or a pinned OC candidate is authorized')
const scope=process.argv[4]||'ready'
assert.ok(['pre-sql','ready','quote-initialization','quote-recovery'].includes(scope))
const isQuoteScope=['quote-initialization','quote-recovery'].includes(scope)
const missingQuoteId='qa-sh08-missing-'+Date.now()
const endpoints=[
 {path:'/api/invoice-allocation',body:{},status:400,error:'Choose a saved order and valid invoice action.'},
 {path:'/api/uc',body:{op:'allocate_invoice',year:'QA-INVALID'},status:409,error:'Refresh OC and use Raise Invoice on the saved order to resume the protected invoice request.'},
 ...(scope!=='pre-sql'?[{path:'/api/invoice-allocation',body:{action:'ready'},status:200,ready:true}]:[]),
 ...(scope==='quote-recovery'?[
  {path:'/api/quote-order-conversion',body:{},status:400,error:'Choose a saved quote and valid conversion action.'},
  {path:'/api/quote-order-conversion',body:{action:'ready'},status:200,expectedBody:{ready:true,protocol:1}},
  {path:'/api/quote-order-conversion',body:{action:'status',quote_id:missingQuoteId},status:404,error:'That quote could not be found.'},
  {path:'/api/quote-order-conversion',body:{action:'commit',quote_id:missingQuoteId,operation_id:'missing'},status:404,error:'That quote could not be found.'},
 ]:[]),
]
const origin=base.origin,out=scope==='quote-recovery'?'qa/out/quote-conversion-recovery':scope==='quote-initialization'?'qa/out/quote-initialization':'qa/out/invoice-recovery',phase=process.argv[3]
assert.ok(['candidate','production'].includes(phase))
const require = createRequire(new URL('../.qa-playwright/package.json', import.meta.url))
const { chromium } = require('playwright-core')
const secrets = await readFile('.env.local', 'utf8'), env = {}
for (const key of ['QA_ADMIN_EMAIL', 'QA_ADMIN_PASSWORD', 'QA_CUSTOMER_EMAIL', 'QA_CUSTOMER_PASSWORD']) {
  const match = secrets.match(new RegExp('^' + key + '=(.*)$', 'm'))
  if (!match) throw Error('Missing authorized QA credential: ' + key)
  env[key] = match[1].trim().replace(/^(['"])(.*)\1$/, '$2')
}
await mkdir(out, { recursive: true })
const report = { origin, phase, scope, checkoutSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), roles: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-quic'] })
try {
  const anonymous = await browser.newContext()
  for (const endpoint of endpoints.filter((e,i,a)=>a.findIndex(x=>x.path===e.path)===i&&['/api/invoice-allocation','/api/quote-order-conversion'].includes(e.path))) for (const [method, status, error] of [['POST', 401, 'Not signed in'], ['GET', 405, 'Method not allowed']]) {
    const r = await anonymous.request.fetch(origin + endpoint.path, { method, ...(method === 'POST' ? { data: '{}' } : {}) })
    assert.equal(r.status(), status)
    assert.deepEqual(await r.json(), { error })
  }
  await anonymous.close()
  report.unauthenticatedAndMethod = 'PASS'
  for (const role of ['ADMIN', 'CUSTOMER']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    try {
      const page = await context.newPage(), errors = []
      page.setDefaultTimeout(60000)
      page.on('pageerror', e => errors.push(e.message))
      page.on('console', m => { if (m.type() === 'error' && /permission-denied|FirebaseError|ChunkLoadError|Failed to fetch dynamically imported/.test(m.text())) errors.push(m.text()) })
      const go = async path => {
        for (let n = 0; n < 2; n++) {
          try { return await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 60000 }) }
          catch (e) { if (n || !/net::ERR_/.test(e.message)) throw e }
        }
      }
      await go('/login')
      await page.locator('input[type=email]').fill(env['QA_' + role + '_EMAIL'])
      await page.locator('input[type=password]').fill(env['QA_' + role + '_PASSWORD'])
      await page.locator('form button[type=submit]').click()
      await page.waitForURL(u => u.pathname !== '/login')
      assert.equal(new URL(page.url()).pathname, role === 'ADMIN' ? '/dashboard' : '/shop')
      const result = { role: role.toLowerCase(), identity: env['QA_' + role + '_EMAIL'], freshSignIn: true }
      if (role === 'ADMIN') {
        await page.getByRole('heading', { name: 'Customer to-do list', exact: true }).waitFor()
        assert.ok(await page.locator('a[href="/settings"]').count())
        assert.ok(await page.locator('a[href="/portal"]').count())
        await page.locator('select option').nth(1).waitFor({ state: 'attached' })
        result.dashboard = 'PASS'
        await go('/range')
        await page.getByRole('heading', { name: 'Crystocraft Range', exact: true }).waitFor()
        await page.getByText('Mini Butterfly Music Box (Wood Body)', { exact: true }).first().waitFor()
        result.catalogue = 'PASS'
        await go('/shipments/new')
        await page.getByRole('heading',{name:'New Order',exact:true}).waitFor()
        await page.getByRole('heading',{name:'Document References',exact:true}).waitFor()
        assert.equal(await page.getByRole('button',{name:'Create Order',exact:true}).isDisabled(),true)
        result.shipping='PASS; blank form, no saves or allocations'
        if(isQuoteScope){
          // A new, nonexistent fictional ID exercises real SDK reads/catch/Retry.
          // Never create a production quote/order or press Create/Allocate.
          await go('/shipments/new?from_quote='+missingQuoteId)
          const quoteError=page.getByRole('alert').filter({hasText:'That quote could not be found.'})
          await quoteError.waitFor()
          assert.equal(await page.locator('form').count(),0)
          assert.equal(await page.getByText(/Prefilled from the quote/).count(),0)
          assert.ok(await page.locator('a[href="/quotes/'+missingQuoteId+'"]').count())
          await page.getByRole('button',{name:'Retry',exact:true}).click()
          await quoteError.waitFor()
          assert.equal(await page.locator('form').count(),0)
          result.quoteInitialization='PASS; real SDK missing-source alert, Retry, no editable form or Create'
        }
      } else {
        await page.getByText(/QA ONLY/).first().waitFor()
        await go('/shop/figurine')
        await page.getByRole('heading', { name: 'Crystocraft Range', exact: true }).waitFor()
        const product = page.locator('a[href^="/shop/figurine/"]').filter({ hasText: 'Mini Butterfly Music Box (Wood Body)' }).first()
        await product.waitFor(); await product.click(); await page.locator('h1').waitFor()
        await page.waitForFunction(() => [...document.querySelectorAll('main img')].some(i => i.complete && i.naturalWidth > 0))
        assert.equal(await page.locator('a[href="/settings"],a[href="/portal"],a[href="/products"]').count(), 0)
        assert.ok(!/INTERNAL REMARKS|BILL OF MATERIALS|SUPPLIER QUOTES/.test(await page.locator('body').innerText()))
        result.catalogueAndDetail = 'PASS'
      }
      const probe = await page.evaluate(async endpoints => {
        const records = await new Promise((resolve, reject) => {
          const r = indexedDB.open('firebaseLocalStorageDb')
          r.onerror = () => reject(Error('QA auth store unavailable'))
          r.onsuccess = () => {
            const db = r.result, read = db.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll()
            read.onsuccess = () => { db.close(); resolve(read.result) }
            read.onerror = () => { db.close(); reject(Error('QA auth read failed')) }
          }
        })
        const account = records.find(r => r.fbase_key?.startsWith('firebase:authUser:'))?.value
        const token = account?.stsTokenManager?.accessToken
        if (!token || !account.uid) throw Error('Fresh QA session missing')
        const headers = { Authorization: `Bearer ${token}` }
        const profile = await fetch(`https://firestore.googleapis.com/v1/projects/crystocraft-costing/databases/(default)/documents/users/${account.uid}`, { headers })
        if (!profile.ok) throw Error('QA profile read failed')
        const fields = (await profile.json()).fields
        // Empty input is deliberate: allowed admin reaches 400 before AI;
        // customer must stop at 403. Neither API receives usable generation input.
        const probes = []
        for (const endpoint of endpoints) {
          const r = await fetch(endpoint.path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(endpoint.body) })
          probes.push({ path: endpoint.path, status: r.status, body: await r.json() })
        }
        return { ...probes[0], probes, email: account.email, role: fields.role?.stringValue, approval: fields.status?.stringValue || null }
      }, endpoints)
      assert.equal(probe.email, result.identity)
      assert.equal(probe.role, role.toLowerCase())
      if (role === 'CUSTOMER') assert.equal(probe.approval, 'approved')
      assert.equal(probe.probes.length, endpoints.length)
      for (const [i, endpoint] of endpoints.entries()) {
        assert.equal(probe.probes[i].path, endpoint.path)
        assert.equal(probe.probes[i].status, role === 'ADMIN' ? endpoint.status : 403)
        assert.deepEqual(probe.probes[i].body, role==='CUSTOMER'?{error:'Access denied'}:endpoint.expectedBody|| (endpoint.ready?{ready:true}:{error:endpoint.error}))
      }
      result.profileAndEndpoint = probe
      await page.reload({ waitUntil: 'domcontentloaded' })
      if (role === 'ADMIN') {
        await page.getByRole('heading',{name:'New Order',exact:true}).waitFor()
        assert.ok(await page.locator('a[href="/settings"]').count())
        assert.equal(new URL(page.url()).pathname,'/shipments/new')
        if(isQuoteScope){
          await page.getByRole('alert').filter({hasText:'That quote could not be found.'}).waitFor()
          assert.equal(await page.locator('form').count(),0)
          result.quoteRefresh='PASS'
        }
      } else {
        await page.locator('h1').waitFor()
        await page.waitForFunction(() => [...document.querySelectorAll('main img')].some(i => i.complete && i.naturalWidth > 0))
        await go('/shipments/new'+(isQuoteScope?'?from_quote='+missingQuoteId:'')); await page.waitForURL(u => u.pathname === '/shop')
        assert.equal(await page.getByRole('button', {name:'Create Order',exact:true}).count(),0)
        assert.equal(await page.locator('a[href="/settings"]').count(), 0)
      }
      result.refreshAndSeparation = 'PASS'
      assert.deepEqual(errors, []); result.runtime = errors
      // Crop avoids exposing unrelated customer summaries or draft queues.
      await page.screenshot({ path: `${out}/${phase}-${base.hostname}-${role.toLowerCase()}.png`, clip: { x: 0, y: 0, width: 1280, height: 580 } })
      result.completedAt = new Date().toISOString(); report.roles.push(result)
      console.log(role + ': fresh sign-in, profile, data, endpoint, separation, refresh and runtime PASS')
    } finally { await context.close() }
  }
  await writeFile(`${out}/${phase}-${scope}-roles-${base.hostname}.json`, JSON.stringify(report, null, 2) + '\n')
} finally { await browser.close() }
