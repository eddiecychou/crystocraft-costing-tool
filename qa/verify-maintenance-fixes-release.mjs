// Supplemental view-only CRM checks using the existing QA customer record.
// Never create/save customers, merge, invite, generate or send messages.
import assert from 'node:assert/strict'
import {readFile, mkdir, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'

const base = new URL(process.argv[2] || '')
const phase = process.argv[3], out = process.argv[4] || 'qa/out/save-navigation-fixes'
assert.equal(base.protocol, 'https:')
assert.ok(base.hostname === 'portal.crystocraft.com' || /^[a-f0-9]{24}--ua-product-manager\.netlify\.app$/.test(base.hostname))
assert.ok(['baseline', 'candidate', 'production'].includes(phase))
assert.match(out, /^qa\/out\/[\w-]+$/)
const require = createRequire(new URL('../.qa-playwright/package.json', import.meta.url))
const {chromium} = require('playwright-core')
const secret = await readFile('.env.local', 'utf8'), env = {}
for (const key of ['QA_ADMIN_EMAIL', 'QA_ADMIN_PASSWORD']) {
  const match = secret.match(new RegExp('^' + key + '=(.*)$', 'm'))
  assert.ok(match, 'Missing authorized QA credential: ' + key)
  env[key] = match[1].trim().replace(/^(['"])(.*)\1$/, '$2')
}
await mkdir(out, {recursive: true})
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--disable-quic']})
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}})
  try {
    const page = await context.newPage(), errors = []
    page.setDefaultTimeout(60000)
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => {
      if (m.type() === 'error' && /permission-denied|FirebaseError|ChunkLoadError|Failed to fetch dynamically imported/.test(m.text())) errors.push(m.text())
    })
    const go = async path => {
      for (let i = 0; i < 2; i++) {
        try { return await page.goto(base.origin + path, {waitUntil: 'domcontentloaded', timeout: 60000}) }
        catch (e) { if (i || !/net::ERR_/.test(e.message)) throw e }
      }
    }
    await go('/login')
    await page.locator('input[type=email]').fill(env.QA_ADMIN_EMAIL)
    await page.locator('input[type=password]').fill(env.QA_ADMIN_PASSWORD)
    await page.locator('form button[type=submit]').click()
    await page.waitForURL(u => u.pathname === '/dashboard')
    await page.getByRole('heading', {name: 'Customer to-do list', exact: true}).waitFor()
    const selectQaCustomer = async () => {
      await page.getByRole('heading', {name: 'Customers', exact: true}).waitFor()
      await page.getByRole('button', {name: /^All\s+\d/}).click()
      await page.getByPlaceholder('Search name, contact, tag, segment…', {exact: true}).fill('QA ONLY')
      const row = page.locator('a[href^="/customers/"]').filter({hasText: /QA ONLY/i}).first()
      await row.waitFor()
      const path = await row.getAttribute('href')
      assert.match(path, /^\/customers\/[^/]+$/)
      await row.click()
      await page.getByRole('heading', {level: 1, name: /QA ONLY/i}).waitFor()
      assert.equal(new URL(page.url()).pathname, path)
      return path
    }
    await go('/customers')
    const customerPath = await selectQaCustomer()
    const originalTitle = await page.locator('h1').innerText()
    const heading = page.getByRole('heading', {name: /^Contacts \(\d+\)$/})
    await heading.waitFor()
    const header = heading.locator('../..')
    const isOpen = async () => (await header.getAttribute('class')).split(/\s+/).includes('border-b')
    const originalOpen = await isOpen()
    await header.click()
    assert.equal(await isOpen(), !originalOpen)
    await page.reload({waitUntil: 'domcontentloaded'})
    await heading.waitFor()
    assert.equal(await page.locator('h1').innerText(), originalTitle)
    assert.equal(await isOpen(), !originalOpen)
    // Ordinary SPA navigation out and back exercises route unmount/remount.
    // Controlled A/B delays are covered by the fictional actual-page tests.
    await page.getByRole('link', {name: '← Customers', exact: true}).click()
    assert.equal(await selectQaCustomer(), customerPath)
    assert.equal(await page.locator('h1').innerText(), originalTitle)
    assert.equal(await isOpen(), !originalOpen)
    await header.click()
    assert.equal(await isOpen(), originalOpen)
    await page.setViewportSize({width: 375, height: 900})
    await heading.scrollIntoViewIfNeeded()
    await heading.locator('../../..').screenshot({path: `${out}/${phase}-qa-customer-contacts-mobile.png`})
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    assert.equal(overflow, false)
    await page.setViewportSize({width: 1280, height: 900})
    await heading.locator('../../..').screenshot({path: `${out}/${phase}-qa-customer-contacts-desktop.png`})
    assert.deepEqual(errors, [])
    const result = {
      origin: base.origin, phase,
      checkoutSha: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
      role: 'admin', identity: env.QA_ADMIN_EMAIL, freshSignIn: true,
      qaCustomerLoaded: true, customerPath,
      contactsToggleAndReload: 'PASS', listAndReturnNavigation: 'PASS',
      originalPreferenceRestored: true, mobileOverflow: false, runtime: errors,
      completedAt: new Date().toISOString(),
      limits: 'QA record viewed only; delayed A/B reads and failed saves tested with fictional services, no live save/send/merge/invite actions',
    }
    await writeFile(`${out}/${phase}-crm-${base.hostname}.json`, JSON.stringify(result, null, 2) + '\n')
    console.log('ADMIN: fresh QA customer read, section preference/reload, SPA return and responsive/runtime checks PASS')
  } finally { await context.close() }
} finally { await browser.close() }
