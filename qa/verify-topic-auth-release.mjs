// Fresh QA sign-ins and safe endpoint probes. Never draft, save or send mail.
// Browser tokens remain inside their own isolated page; credentials stay local.
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const base = new URL(process.argv[2] || '')
assert.equal(base.protocol, 'https:')
assert.ok(base.hostname === 'portal.crystocraft.com' || /^[a-f0-9]{24}--ua-product-manager\.netlify\.app$/.test(base.hostname), 'Only the canonical site or a pinned OC candidate is authorized')
const scope = process.argv[4] || 'topic'
assert.ok(['topic', 'both'].includes(scope), 'Probe scope must be topic or both')
const endpoints = [
  { path: '/api/draft-outreach-topic', error: 'topic is required' },
  ...(scope === 'both' ? [{ path: '/api/discuss-outreach-draft', error: 'message is required' }] : []),
]
const origin = base.origin, out = process.argv[5] || (scope === 'both' ? 'qa/out/refinement-auth' : 'qa/out/topic-auth'), phase = process.argv[3]
assert.match(out, /^qa\/out\/[\w-]+$/, 'Evidence must stay in a named qa/out directory')
assert.ok(['baseline', 'candidate', 'production'].includes(phase), 'Specify baseline, candidate or production')
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
  for (const endpoint of endpoints) for (const [method, status, error] of [['POST', 401, 'Not signed in'], ['GET', 405, 'Method not allowed']]) {
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
        await go('/marketing')
        const draft = page.getByRole('button', { name: 'Draft with AI', exact: true })
        await draft.waitFor()
        assert.equal(await draft.isDisabled(), true)
        const topic = page.locator('textarea[placeholder^="e.g."]').first()
        await topic.fill('Fictional unsaved QA topic — do not generate or send')
        assert.equal(await draft.isEnabled(), true)
        await topic.fill('')
        assert.equal(await draft.isDisabled(), true)
        result.composer = 'PASS; unsaved edits only'
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
          const r = await fetch(endpoint.path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })
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
        assert.equal(probe.probes[i].status, role === 'ADMIN' ? 400 : 403)
        assert.deepEqual(probe.probes[i].body, { error: role === 'ADMIN' ? endpoint.error : 'Access denied' })
      }
      result.profileAndEndpoint = probe
      await page.reload({ waitUntil: 'domcontentloaded' })
      if (role === 'ADMIN') {
        await page.getByRole('button', { name: 'Draft with AI', exact: true }).waitFor()
        assert.ok(await page.locator('a[href="/settings"]').count())
        assert.equal(new URL(page.url()).pathname, '/marketing')
      } else {
        await page.locator('h1').waitFor()
        await page.waitForFunction(() => [...document.querySelectorAll('main img')].some(i => i.complete && i.naturalWidth > 0))
        await go('/marketing'); await page.waitForURL(u => u.pathname === '/shop')
        assert.equal(await page.getByRole('button', { name: 'Draft with AI', exact: true }).count(), 0)
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
  await writeFile(`${out}/${phase}-roles-${base.hostname}.json`, JSON.stringify(report, null, 2) + '\n')
} finally { await browser.close() }
