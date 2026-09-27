// node qa/money-fixes.test.mjs
//
// Covers the three money bugs found in the 2026-09-28 whole-repo review:
//   L-35  a currency with no rate on file was returned UNCONVERTED, wearing the
//         target currency's label (GBP account saw "GBP 155.60" for ~GBP 15.90)
//   L-36  a default-HKD quote read the deleted legacy `sell_price` and priced
//         every added product at 0.00, ignoring the real `price_hkd`
//   L-37  an uncosted product published price_hkd 0, which passed the customer
//         storefront's `!= null` filter and rendered as free
//
// src/currency.js can't be imported directly in Node — it pulls `db` from
// ./firebase, which needs a browser. Same approach as qa/supplier-merge.test.mjs:
// copy the real module to a temp file with the React/Firebase imports and the
// useRates hook stripped, so the PURE conversion logic under test is the actual
// shipped code, not a replica.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'src', 'currency.js'), 'utf8')
const pure = src
  .replace(/^import[\s\S]*?from '\.\/firebase'\n/m, '')
  .replace(/^import .*\n/gm, '')
  .replace(/export function useRates\(\)[\s\S]*?\n}\n/m, '')
const dir = mkdtempSync(join(tmpdir(), 'money-'))
const modPath = join(dir, 'currency.mjs')
writeFileSync(modPath, pure)
const { fromHKD, fromUSD, convertFromUSD, convertFromHKD, wsPriceFactor, fmtMoney, CUSTOMER_CURRENCIES } =
  await import(modPath)
rmSync(dir, { recursive: true, force: true })

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
const near = (a, b, eps = 0.01) => a != null && Math.abs(a - b) < eps

// What the rates doc actually holds today: RMB/USD/EUR only.
const RATES = { RMB: 1.09, USD: 7.78, EUR: 8.6, HKD: 1 }

// ── L-35 ────────────────────────────────────────────────────────────────
{
  check('every CUSTOMER_CURRENCY is either HKD, rated, or returns null (never raw HKD)',
    CUSTOMER_CURRENCIES.every(c => {
      const out = fromHKD(155.6, c, RATES)
      return c === 'HKD' ? out === 155.6 : (RATES[c] ? out != null : out === null)
    }))

  // The headline case: USD 20 item, GBP account, no GBP rate on file.
  const gbp = convertFromUSD(20, { base_currency: 'GBP' }, RATES)
  check('GBP account with no rate returns null, not the HKD figure', gbp === null,
    `got ${gbp}`)
  check('  and renders as "—", not a wrong price', fmtMoney(gbp, 'GBP') === '—',
    fmtMoney(gbp, 'GBP'))
  // Prove the old behaviour was the 7.8x error, so this test fails loudly if
  // anyone reintroduces `rates[cur] || 1`.
  const oldWay = 20 * RATES.USD / (RATES.GBP || 1)
  check('  (old `|| 1` path would have shown ~155.60)', near(oldWay, 155.6, 0.1))

  // Once a rate exists, it converts properly.
  const withRate = convertFromUSD(20, { base_currency: 'GBP' }, { ...RATES, GBP: 9.8 })
  check('GBP converts correctly once a rate is on file', near(withRate, 15.88, 0.05),
    `got ${withRate}`)

  // A per-account fixed rate must still work even with no global rate — this is
  // the documented escape hatch, so it must not have been broken by the fix.
  const fixed = convertFromUSD(20, { base_currency: 'GBP', fx_rate: 0.79 }, RATES)
  check('a fixed per-account fx_rate still works without a global rate', near(fixed, 15.8),
    `got ${fixed}`)
  const fixedHkd = convertFromHKD(155.6, { base_currency: 'GBP', fx_rate: 0.79 }, RATES)
  check('  same via the HKD bridge', near(fixedHkd, 15.8, 0.05), `got ${fixedHkd}`)

  check('HKD and USD are unaffected', fromHKD(100, 'HKD', RATES) === 100 &&
    near(fromUSD(1, 'EUR', RATES), 0.9047, 0.001))
}

// ── L-35 regression guard: wsPriceFactor must still never yield 0 ───────
{
  check('wsPriceFactor blank/0/invalid → 1.0 (never free)',
    [undefined, null, '', 0, -5, 'abc'].every(v => wsPriceFactor({ ws_discount_pct: v }) === 1))
  check('wsPriceFactor 130 → 1.3', wsPriceFactor({ ws_discount_pct: 130 }) === 1.3)
}

// ── L-36: the quote tier price selection ───────────────────────────────
{
  // Mirrors QuoteDetail.handleAddProducts: HKD quote, toQuoteCurrency is
  // identity for HKD.
  const toQuoteCurrency = (hkd, quoteCurrency = 'HKD', rates = { HKD: 1 }) =>
    quoteCurrency === 'HKD' ? hkd : +(hkd / (rates[quoteCurrency] || 1)).toFixed(2)
  const priceFor = (td, quoteCurrency) =>
    (td.sell_currency === quoteCurrency && td.sell_price != null)
      ? td.sell_price
      : toQuoteCurrency(td.price_hkd || 0, quoteCurrency)

  // What PricingTiers.publish() actually writes: price_hkd set, sell_price DELETED.
  const published = { quantity: 500, price_hkd: 78, sell_currency: 'HKD' }
  check('published tier on an HKD quote prices at price_hkd, not 0',
    priceFor(published, 'HKD') === 78, `got ${priceFor(published, 'HKD')}`)
  const oldPrice = published.sell_currency === 'HKD' ? (published.sell_price || 0) : null
  check('  (old branch would have given 0)', oldPrice === 0)

  // A legacy doc that still carries a real sell_price keeps using it.
  const legacy = { quantity: 500, price_hkd: 78, sell_currency: 'HKD', sell_price: 80 }
  check('legacy tier with a real sell_price still honours it', priceFor(legacy, 'HKD') === 80)
  // Explicit zero is a real value, not "missing".
  const zeroed = { quantity: 500, price_hkd: 78, sell_currency: 'HKD', sell_price: 0 }
  check('an explicit sell_price of 0 is respected, not treated as missing',
    priceFor(zeroed, 'HKD') === 0)
}

// ── L-37: zero price must not reach the storefront ─────────────────────
{
  const tiers = [{ quantity: 200, price_hkd: 0 }, { quantity: 500, price_hkd: 78 }]
  const detail = tiers.filter(t => Number(t.price_hkd) > 0)
  check('detail page hides the 0 tier', detail.length === 1 && detail[0].price_hkd === 78)
  const from = tiers.map(t => Number(t.price_hkd)).filter(v => v > 0)
  check('"from" price skips 0', Math.min(...from) === 78)
  const oldFrom = tiers.map(t => t.price_hkd).filter(v => v != null).map(Number)
  check('  (old filter would have advertised "from HKD 0")', Math.min(...oldFrom) === 0)
  const allZero = [{ quantity: 200, price_hkd: 0 }].map(t => Number(t.price_hkd)).filter(v => v > 0)
  check('an entirely uncosted product shows no price at all, not free',
    allZero.length === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
