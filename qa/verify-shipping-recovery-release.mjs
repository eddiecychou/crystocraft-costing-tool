// Fresh authorized role logins; production business records are read-only.
// Recovery interaction uses explicit fictional HTTP responses, never real issuance.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { PI_MAX_FILE_BYTES } from '../src/piUploadPolicy.js'

const base = new URL(process.argv[2]), phase = process.argv[3]
assert.equal(base.protocol, 'https:')
assert.ok(base.hostname === 'portal.crystocraft.com' || /^[a-f0-9]{24}--ua-product-manager\.netlify\.app$/.test(base.hostname))
assert.ok(['candidate', 'production'].includes(phase))
const out = 'qa/out/sh07-release-20261112'
await mkdir(out, { recursive: true })
const secrets = await readFile('.env.local', 'utf8')
function credential(key) {
  const match = secrets.match(new RegExp('^' + key + '=(.*)$', 'm'))
  assert.ok(match, 'Missing authorized QA credential ' + key)
  return match[1].trim().replace(/^(['"])(.*)\1$/, '$2')
}
const { chromium } = createRequire(new URL('../.qa-playwright/package.json', import.meta.url))('playwright-core')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-quic'] })
const report = { origin: base.origin, phase, sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), roles: [] }
async function probe(page) {
  return page.evaluate(async id => {
    const account = await new Promise((resolve, reject) => {
      const req = indexedDB.open('firebaseLocalStorageDb')
      req.onerror = () => reject(Error('QA auth unavailable'))
      req.onsuccess = () => {
        const db = req.result, query = db.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll()
        query.onsuccess = () => { db.close(); resolve(query.result.find(r => r.fbase_key?.startsWith('firebase:authUser:'))?.value) }
        query.onerror = () => { db.close(); reject(Error('QA auth read failed')) }
      }
    })
    if (!account?.uid) throw Error('Fresh login missing')
    const headers = { Authorization: 'Bearer ' + account.stsTokenManager.accessToken, 'Content-Type': 'application/json' }
    const root = 'https://firestore.googleapis.com/v1/projects/crystocraft-costing/databases/(default)/documents/'
    const p = await fetch(root + 'users/' + account.uid, { headers })
    if (!p.ok) throw Error('Profile unavailable')
    const profile = (await p.json()).fields
    const outcomes = []
    for (const [path, body] of [
      ['/api/shipping-order-request', { action: 'status', operator: account.uid, id }],
      ['/api/shipping-order-request', { action: 'status', operator: 'fictional-other-operator', id }],
      ['/api/invoice-allocation', { action: 'ready' }]
    ]) {
      const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })
      outcomes.push({ status: r.status, body: await r.json() })
    }
    return { uid: account.uid, email: account.email, role: profile.role?.stringValue, approval: profile.status?.stringValue, outcomes }
  }, randomUUID())
}
try {
  const anon = await browser.newContext()
  for (const path of ['/api/shipping-order-request', '/api/invoice-allocation']) {
    assert.equal((await anon.request.post(base.origin + path, { data: {} })).status(), 401)
    assert.equal((await anon.request.get(base.origin + path)).status(), 405)
  }
  await anon.close()
  report.anonymousDenied = true
  for (const role of ['ADMIN', 'CUSTOMER']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    try {
      const page = await context.newPage(), errors = []
      page.setDefaultTimeout(60000)
      page.on('pageerror', e => errors.push(e.message))
      page.on('console', m => { if (m.type() === 'error' && /FirebaseError|ChunkLoadError|Failed to fetch dynamically imported/.test(m.text())) errors.push(m.text()) })
      const go = async path => {
        for (let n = 0; n < 2; n++) {
          try { return await page.goto(base.origin + path, { waitUntil: 'domcontentloaded', timeout: 60000 }) }
          catch (e) { if (n || !/net::ERR_/.test(e.message)) throw e }
        }
      }
      await go('/login')
      await page.locator('input[type=email]').fill(credential('QA_' + role + '_EMAIL'))
      await page.locator('input[type=password]').fill(credential('QA_' + role + '_PASSWORD'))
      await page.locator('form button[type=submit]').click()
      await page.waitForURL(u => u.pathname !== '/login')
      assert.equal(new URL(page.url()).pathname, role === 'ADMIN' ? '/dashboard' : '/shop')
      const identity = await probe(page)
      assert.equal(identity.email, credential('QA_' + role + '_EMAIL'))
      assert.equal(identity.role, role.toLowerCase())
      const result = { role: identity.role, qaIdentity: identity.email, freshSignIn: true, method: 'email/password', profile: identity.approval, probes: identity.outcomes }
      if (role === 'ADMIN') {
        await page.getByRole('list', { name: 'Outstanding tasks' }).waitFor()
        assert.equal(await page.getByRole('region', { name: 'My tasks' }).getByRole('alert').count(), 0)
        result.dashboardDataLoaded = true
        assert.ok(await page.locator('a[href="/portal"]').count())
        assert.ok(await page.locator('a[href="/settings"]').count())
        assert.deepEqual(identity.outcomes[0], { status: 200, body: { status: 'empty' } })
        assert.equal(identity.outcomes[1].status, 403)
        assert.deepEqual(identity.outcomes[2], { status: 200, body: { ready: true } })
        await go('/range')
        await page.getByRole('heading', { name: 'Crystocraft Range', exact: true }).waitFor()
        await page.getByText('Mini Butterfly Music Box (Wood Body)', { exact: true }).first().waitFor()
        await go('/shipments/new')
        await page.getByRole('heading', { name: 'New Order', exact: true }).waitFor()
        await page.getByText('PDF, JPG, PNG · 20 MB maximum per file', { exact: true }).waitFor()
        let extractCalls = 0
        page.on('request', r => { if (new URL(r.url()).pathname === '/api/extract-pi') extractCalls++ })
        await page.locator('input[type=file]').first().setInputFiles({ name: 'QA fictional oversized PI.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(PI_MAX_FILE_BYTES + 1) })
        await page.getByRole('alert').filter({ hasText: 'This PI exceeds the 20 MB limit' }).waitFor()
        assert.equal(extractCalls, 0)
        assert.equal(await page.getByRole('button', { name: 'Create Order', exact: true }).isDisabled(), true)
        result.oversizedSelectionRejectedWithoutUpload = true
        await page.reload()
        await page.getByRole('heading', { name: 'New Order', exact: true }).waitFor()
        result.refresh = true
        // Served recovery component, with all writes intercepted for this fictional ID.
        const requestId = randomUUID(), orderId = 'qa-sh07-no-saved-order', si = 'SI-FICTIONAL'
        let finished = false, invoiceCalls = 0
        const state = () => ({ id: requestId, direct: true, status: 'committed', customer: 'FICTIONAL QA ONLY', currency: 'GBP', total: 1222, line_count: 1, order_id: orderId,
          invoice: { state: finished ? 'issued' : 'followups_pending', si, message: finished ? '' : 'The invoice number is issued. Finish its pending accounting updates using this same request.' } })
        await page.route('**/api/shipping-order-request', async route => {
          const data = route.request().postDataJSON()
          if (data.id !== requestId) return route.continue()
          assert.ok(['status', 'commit'].includes(data.action))
          await route.fulfill({ json: state() })
        })
        await page.route('**/api/invoice-allocation', async route => {
          const data = route.request().postDataJSON()
          if (data.order_id !== orderId) return route.continue()
          assert.equal(data.action, 'initial_direct')
          assert.equal(data.request_id, requestId)
          invoiceCalls++; finished = true
          await route.fulfill({ json: { operation: { status: 'linked' } } })
        })
        await go('/shipments/new?operator=' + identity.uid + '&request=' + requestId)
        await page.getByRole('button', { name: 'Finish Direct Invoice' }).waitFor()
        await page.screenshot({ path: out + '/' + phase + '-recovery-desktop.png', fullPage: true })
        await page.setViewportSize({ width: 390, height: 844 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await page.screenshot({ path: out + '/' + phase + '-recovery-mobile.png', fullPage: true })
        await page.getByRole('button', { name: 'Finish Direct Invoice' }).click()
        await page.waitForURL(u => u.pathname === '/shipments/' + orderId)
        assert.equal(invoiceCalls, 1)
        result.servedFictionalRecovery = 'Finish resumes the original request and opens its saved order; intercepted responses, no production issuance'
        result.mobileNoOverflow = true
      } else {
        assert.equal(identity.approval, 'approved')
        for (const response of identity.outcomes) assert.equal(response.status, 403)
        await go('/shop/figurine')
        await page.getByRole('heading', { name: 'Crystocraft Range', exact: true }).waitFor()
        const product = page.locator('a[href^="/shop/figurine/"]').filter({ hasText: 'Mini Butterfly Music Box (Wood Body)' }).first()
        await product.click()
        await page.locator('h1').waitFor()
        await page.waitForFunction(() => [...document.querySelectorAll('main img')].some(i => i.complete && i.naturalWidth > 0))
        assert.equal(await page.locator('a[href="/portal"],a[href="/settings"],a[href="/products"]').count(), 0)
        assert.ok(!/INTERNAL REMARKS|BILL OF MATERIALS|SUPPLIER QUOTES/.test(await page.locator('body').innerText()))
        await page.reload()
        await page.locator('h1').waitFor()
        await page.screenshot({ path: out + '/' + phase + '-customer-catalogue.png', clip: { x: 0, y: 0, width: 1280, height: 580 } })
        result.refresh = true
        await go('/shipments/new')
        await page.waitForURL(u => u.pathname === '/shop')
        assert.equal(await page.getByRole('button', { name: 'Create Order', exact: true }).count(), 0)
      }
      assert.deepEqual(errors, [])
      result.runtimeErrors = errors
      report.roles.push(result)
      console.log(role + ': fresh sign-in, data, access separation, refresh and runtime PASS')
    } finally { await context.close() }
  }
  report.completedAt = new Date().toISOString()
  await writeFile(out + '/' + phase + '-roles.json', JSON.stringify(report, null, 2) + '\n')
} finally { await browser.close() }
