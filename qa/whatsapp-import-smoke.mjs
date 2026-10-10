// Visionless browser smoke test for the WhatsApp import / migration / dry-run
// UI. Bundles the REAL WhatsAppImport page with its data layer stubbed+seeded,
// compiles the real Tailwind CSS, then drives it with playwright-core against
// the system Chrome and asserts DOM + overflow + console errors as TEXT (no
// screenshots — the model has no vision).
//
//   node qa/whatsapp-import-smoke.mjs
import { build } from 'esbuild'
import { writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { createServer } from 'http'
import { readFileSync } from 'fs'
import { extname, join } from 'path'
import { chromium } from '../.qa-playwright/node_modules/playwright-core/index.mjs'

const REPO = process.cwd()

// ── stubs (the three modules WhatsAppImport.jsx imports) ──────────────────
const STUBS = {
  customer: `
    export const CHANNELS = ['WhatsApp Business', 'Personal WhatsApp']
    export const CRM_CATEGORIES = ['VIP', 'Retail', 'Wholesale']
    export const CUSTOMER_COUNTRIES = ['Hong Kong', 'Australia']
    export const saveCustomer = async () => ({ ok: true, id: 'x' })
    export function useCustomers() {
      return { customers: [
        { id: 'c1', company_name: 'A Very Long Company Name That Could Overflow At Narrow Widths Limited', contacts: [
          { id: 'c_abc123', name: 'Alexandra Winterbottom-Smythe', title: 'Head of International Procurement' },
          { id: 'c_def456', name: 'Sam', title: 'Owner' },
        ] },
        { id: 'c2', company_name: 'Short Co', contacts: [{ id: 'c2a', name: 'Pat', title: '' }] },
      ] }
    }
  `,
  whatsappImport: `
    export const previewWhatsAppZip = async () => ({ contactName: 'Alexandra', looksLikePhone: false, messageCount: 5, dateRange: [new Date('2024-05-01'), new Date('2024-06-01')], voiceCount: 0, attachmentCount: 0, senders: ['Alexandra'] })
    export const importWhatsAppZip = async () => ({})
    export const analyzeWhatsappImport = async () => ({ verdict: 'safe-update', exact: 3, newAfter: 2, conflicts: 0, crossAccount: 0, targetExists: true, targetThreadId: 'business__c_abc123' })
    export const loadLegacyWhatsappThreads = async (onProgress) => {
      onProgress?.({ done: 2, total: 2 })
      return [
        { kind: 'customer', parentId: 'c1', displayName: 'A Very Long Company Name That Could Overflow At Narrow Widths Limited', legacyId: 'alexandra-winterbottom-smythe', subject: 'Alexandra Winterbottom-Smythe', channel: 'WhatsApp Business', message_count: 120, date_range: ['2024-05-01T00:00:00.000Z', '2024-06-01T00:00:00.000Z'] },
        { kind: 'lead', parentId: 'wa-00000000000', displayName: 'A Long Lead Name With No Company Record At All', legacyId: 'lead-name', subject: 'Lead Name', channel: 'Personal WhatsApp', message_count: 8, date_range: ['2024-05-01T00:00:00.000Z', '2024-05-02T00:00:00.000Z'] },
      ]
    }
    export const migrateLegacyThread = async () => ({ legacyId: 'x', newId: 'business__c_abc123' })
    export const undoMigrateLegacyThread = async () => ({})
    export const mergeLegacyThread = async () => ({ legacyId: 'x', newId: 'business__c_abc123' })
  `,
  whatsappSummaryApi: `
    export const loadWhatsappSummaryCandidates = async () => []
    export const loadContactWhatsappSummaryCandidates = async () => []
    export const generateAndSaveWhatsappSummary = async () => ({})
  `,
  marketingContact: `
    export const contactName = c => c.first_name || c.company || c.email || c.id
    export function useMarketingContacts() {
      return { contacts: [{ id: 'lead1', first_name: 'Mandy', company: 'Sample Lead' }] }
    }
  `,
  firebase: `export const db = {}`,
  firestore: `
    export const collection = (...parts) => parts.join('/')
    export const doc = (...parts) => parts.join('/')
    export const serverTimestamp = () => 'server-time'
    export const writeBatch = () => ({ set: () => {}, commit: async () => ({}) })
    export const getDocs = async () => ({ docs: [{ id: 'archive1', data: () => ({
      file: 'WhatsApp Chat - Mandy.zip', archive_key: 'business:WhatsApp Chat - Mandy.zip',
      account: 'business', suggested_name: 'Mandy', message_count: 18, status: 'pending',
    }) }] })
  `,
}

const stubPlugin = {
  name: 'qa-stubs',
  setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'qa-stub' }))
    b.onResolve({ filter: /(^|\/)(customer|whatsappImport|whatsappSummaryApi|marketingContact|firebase)$/ }, args => ({
      path: args.path.split('/').pop(), namespace: 'qa-stub',
    }))
    b.onLoad({ filter: /.*/, namespace: 'qa-stub' }, args => ({
      contents: STUBS[args.path], loader: 'js', resolveDir: REPO,
    }))
  },
}

// ── 1. bundle ─────────────────────────────────────────────────────────────
await build({
  entryPoints: ['qa/whatsapp-import-preview.jsx'],
  bundle: true,
  outfile: 'qa/whatsapp-import-preview.js',
  format: 'esm',
  jsx: 'automatic',
  define: { 'import.meta.env.MODE': '"development"', 'import.meta.env.DEV': 'true' },
  plugins: [stubPlugin],
})

// ── 2. real Tailwind CSS (flex/grid/break-words must actually exist) ──────
execSync(
  `node_modules/.bin/tailwindcss -i src/index.css -o qa/whatsapp-import-preview.css --content "./src/**/*.{js,jsx}","./qa/whatsapp-import-preview.jsx"`,
  { stdio: 'inherit' }
)

writeFileSync('qa/whatsapp-import-preview.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA — WhatsApp Import (seeded)</title><link rel="icon" href="data:,"><link rel="stylesheet" href="./whatsapp-import-preview.css"></head><body><div id="root"></div><script type="module" src="./whatsapp-import-preview.js"></script></body></html>`)

// ── 3. serve + drive ───────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = join(REPO, urlPath === '/' ? 'qa/whatsapp-import-preview.html' : urlPath.replace(/^\//, ''))
  let body
  try { body = readFileSync(file) } catch { res.writeHead(404); res.end('not found'); return }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(body)
})
await new Promise(r => server.listen(0, r))
const port = server.address().port
const PAGE_URL = `http://127.0.0.1:${port}/qa/whatsapp-import-preview.html`

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []

async function check(viewport) {
  const page = await browser.newPage({ viewport })
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  page.on('pageerror', e => errors.push('pageerror: ' + String(e)))
  await page.goto(PAGE_URL, { waitUntil: 'load' })

  // The folder inbox and manual upload now share this one screen.
  await page.getByText('WhatsApp Chat - Mandy.zip').waitFor({ timeout: 5000 })
  const hasArchiveInbox = await page.getByRole('tab', { name: 'Archive inbox' }).getAttribute('aria-selected') === 'true'
  await page.getByRole('tab', { name: 'Manual upload & tools' }).click()

  // Migration review: scan -> long-name rows render.
  await page.getByRole('button', { name: 'Scan for legacy threads' }).click()
  await page.getByText('Legacy').first().waitFor({ timeout: 5000 })

  // Dry-run: upload a fake zip -> FileRow renders -> pick a contact -> Review.
  await page.setInputFiles('input[type="file"]', { name: 'WhatsApp Chat - Alexandra.zip', mimeType: 'application/zip', buffer: Buffer.from('fake') })
  const fileCard = page.locator('div.card').filter({ hasText: 'Alexandra.zip' }).first()
  await fileCard.getByRole('button', { name: 'Review', exact: true }).waitFor({ timeout: 5000 })
  await fileCard.locator('select', { hasText: 'Select contact person…' }).selectOption('c_abc123')
  await fileCard.getByRole('button', { name: 'Review', exact: true }).click()
  await fileCard.getByText(/Updates an existing thread/).waitFor({ timeout: 5000 })

  const report = await page.evaluate(() => {
    const docW = document.documentElement.scrollWidth
    const winW = document.documentElement.clientWidth
    let maxRight = 0
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > maxRight) maxRight = r.right
    }
    return {
      pageScrollW: docW, clientW: winW, pageOverflows: docW > winW,
      maxElementRight: Math.round(maxRight), innerWidth: window.innerWidth,
      hasLegacyBadge: document.body.textContent.includes('Legacy'),
      hasVerdict: document.body.textContent.includes('Updates an existing thread'),
    }
  })
  report.hasArchiveInbox = hasArchiveInbox
  await page.close()
  return report
}

const mobile = await check({ width: 375, height: 812 })
const desktop = await check({ width: 1280, height: 900 })

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) } }

ok('mobile 375px: no page-level horizontal scroll', !mobile.pageOverflows, `scrollW ${mobile.pageScrollW} vs clientW ${mobile.clientW}`)
ok('mobile 375px: no element pokes past the viewport', mobile.maxElementRight <= mobile.innerWidth + 1, `max right ${mobile.maxElementRight} vs ${mobile.innerWidth}`)
ok('mobile: "Legacy" badge rendered after scan', mobile.hasLegacyBadge)
ok('mobile: dry-run verdict rendered after review', mobile.hasVerdict)
ok('mobile: archive inbox is the default integrated tab', mobile.hasArchiveInbox)
ok('desktop 1280px: no page-level horizontal scroll', !desktop.pageOverflows, `scrollW ${desktop.pageScrollW} vs clientW ${desktop.clientW}`)
ok('desktop: no element pokes past the viewport', desktop.maxElementRight <= desktop.innerWidth + 1, `max right ${desktop.maxElementRight} vs ${desktop.innerWidth}`)
ok('desktop: archive inbox is the default integrated tab', desktop.hasArchiveInbox)
ok('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
server.close()
process.exit(fail ? 1 : 0)
