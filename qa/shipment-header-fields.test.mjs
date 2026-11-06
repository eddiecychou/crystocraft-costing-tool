// Saved-order form mapping contract. The shipping helper is real; external
// dependencies throw if invoked. These fictional cases never access a service.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

let orderEditFields, scratch
const destination = () => ({ country: '', city: '', address: '', port: '' })
before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'oc-shipment-header-'))
  await build({ entryPoints: ['src/shipping.js'], outfile: join(scratch, 'engine.mjs'), bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'no-header-mapping-io', setup(b) {
    b.onResolve({ filter: /^react$|^firebase\/firestore$|\/(firebase|criticalComponents|soNumber)$/ }, a => ({ path: a.path.split('/').at(-1), namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: {
      firebase: 'export const db={};',
      react: 'export const useState=()=>{throw Error("Unexpected hook")},useEffect=useState;',
      criticalComponents: 'const fail=()=>{throw Error("Unexpected product lookup")};export{fail as buildProductIndex,fail as matchProductCode};',
      soNumber: 'export const JES_SEED_BY_YEAR={};const fail=()=>{throw Error("Unexpected number allocation")};export{fail as soYear,fail as formatSoNo};',
      firestore: 'const fail=()=>{throw Error("Unexpected database access")};export{fail as collection,fail as doc,fail as getDoc,fail as getDocs,fail as addDoc,fail as updateDoc,fail as deleteDoc,fail as onSnapshot,fail as query,fail as orderBy,fail as serverTimestamp,fail as writeBatch,fail as runTransaction};',
    }[a.path] }))
  } }] })
  ;({ orderEditFields } = await import(pathToFileURL(join(scratch, 'engine.mjs'))))
  assert.equal(typeof orderEditFields, 'function')
})
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }) })

test('saved header includes the complete existing whitelist and excludes source-only fields', () => {
  const order = {
    customer_id: 'customer-fictional', contact_id: 'contact-fictional', customer_name: '客戶 & Co',
    erp_pi_no: 'LEGACY-PI', erp_so_no: 'SO-FICTIONAL', erp_si_no: 'SI-FICTIONAL', uc_no: 'UC-FICTIONAL',
    customer_po: 'PO 中文 & /', invoiced_at: '2026-11-01', invoice_date: '2026-11-02',
    accounting_total: 1234.56789, adjustment_reason: 'Original adjustment reason',
    order_date: '2026-10-30', est_ship_date: '2026-12-05',
    currency: 'EUR', incoterm: 'DAP', payment_terms: '30% deposit, balance before shipment', status: 'confirmed',
    destination: { country: 'Hong Kong', city: 'Kowloon', address: '中文 street & building', port: 'HK', attention: 'Warehouse' },
    notes: 'Keep full notes\nSecond line', discount_pct: 2.125, discount_amount: 12.34567,
    deposit_paid: 155.12345, total_amount: 1234.56789, hide_total_qty: true, pi_revision: 3,
    pi_subtotal: 1261.12345, pi_total: 1248.77778,
    channel: 'woo', woo_order_no: '66849', woo_fee: 12.34567, woo_net_payout: 1222.22222,
    woo_net_payout_hkd: 9511.77777, woo_payout_date: '2026-11-03',
    id: 'order-fictional', source: 'imported_pi', subtotal: 9999,
    source_file: { url: 'https://fictional.invalid/source.pdf' },
    lines: [{ item_code: 'DO-NOT-COPY' }], _raw: { secret: 'source-only' }, unrelated_future_field: 'omit',
  }
  assert.deepEqual(orderEditFields(order, destination()), {
    customer_id: 'customer-fictional', contact_id: 'contact-fictional', customer_name: '客戶 & Co',
    erp_pi_no: 'LEGACY-PI', erp_so_no: 'SO-FICTIONAL', erp_si_no: 'SI-FICTIONAL', uc_no: 'UC-FICTIONAL',
    customer_po: 'PO 中文 & /', invoiced_at: '2026-11-01', invoice_date: '2026-11-02',
    accounting_total: 1234.56789, adjustment_reason: 'Original adjustment reason',
    order_date: '2026-10-30', est_ship_date: '2026-12-05',
    currency: 'EUR', incoterm: 'DAP', payment_terms: '30% deposit, balance before shipment', status: 'confirmed',
    destination: { country: 'Hong Kong', city: 'Kowloon', address: '中文 street & building', port: 'HK', attention: 'Warehouse' },
    notes: 'Keep full notes\nSecond line', discount_pct: 2.125, discount_amount: 12.34567,
    deposit_paid: 155.12345, total_amount: 1234.56789, hide_total_qty: true, pi_revision: '3',
    pi_subtotal: 1261.12345, pi_total: 1248.77778,
    channel: 'woo', woo_order_no: '66849', woo_fee: 12.34567, woo_net_payout: 1222.22222,
    woo_net_payout_hkd: 9511.77777, woo_payout_date: '2026-11-03',
  })
})

test('absent values keep the current blank, null and direct-field distinctions', () => {
  assert.deepEqual(orderEditFields({}, destination()), {
    customer_id: undefined, contact_id: '', customer_name: undefined,
    erp_pi_no: undefined, erp_so_no: '', erp_si_no: '', uc_no: '', customer_po: '',
    invoiced_at: '', invoice_date: '', accounting_total: '', adjustment_reason: '',
    order_date: '', est_ship_date: '', currency: undefined, incoterm: undefined,
    payment_terms: '', status: undefined, destination: destination(), notes: undefined,
    discount_pct: '', discount_amount: '', deposit_paid: '', total_amount: null,
    hide_total_qty: false, pi_revision: '', pi_subtotal: '', pi_total: '',
    channel: null, woo_order_no: '', woo_fee: null, woo_net_payout: null,
    woo_net_payout_hkd: null, woo_payout_date: null,
  })
})

test('zero is preserved for amounts and source PI figures while a numeric zero revision stays blank', () => {
  const financialFields = ['accounting_total', 'discount_pct', 'discount_amount', 'deposit_paid', 'total_amount', 'pi_subtotal', 'pi_total', 'woo_fee', 'woo_net_payout', 'woo_net_payout_hkd']
  const mapped = orderEditFields({ ...Object.fromEntries(financialFields.map(key => [key, 0])), pi_revision: 0, source: 'imported_pi', subtotal: 900 }, destination())
  for (const key of financialFields) assert.equal(mapped[key], 0, key)
  assert.equal(mapped.pi_revision, '')
})

test('null uses only the established blank/null defaults and leaves direct fields untouched', () => {
  const order = Object.fromEntries([
    'customer_id', 'customer_name', 'erp_pi_no', 'currency', 'incoterm', 'status', 'notes',
    'contact_id', 'erp_so_no', 'erp_si_no', 'customer_po', 'invoiced_at', 'invoice_date',
    'accounting_total', 'adjustment_reason', 'order_date', 'est_ship_date', 'payment_terms',
    'discount_pct', 'discount_amount', 'deposit_paid', 'total_amount', 'pi_subtotal', 'pi_total',
    'channel', 'woo_order_no', 'woo_fee', 'woo_net_payout', 'woo_net_payout_hkd', 'woo_payout_date',
  ].map(key => [key, null]))
  const mapped = orderEditFields(order, destination())
  for (const key of ['customer_id', 'customer_name', 'erp_pi_no', 'currency', 'incoterm', 'status', 'notes', 'total_amount', 'channel', 'woo_fee', 'woo_net_payout', 'woo_net_payout_hkd', 'woo_payout_date']) assert.equal(mapped[key], null, key)
  for (const key of ['contact_id', 'erp_so_no', 'erp_si_no', 'customer_po', 'invoiced_at', 'invoice_date', 'accounting_total', 'adjustment_reason', 'order_date', 'est_ship_date', 'payment_terms', 'discount_pct', 'discount_amount', 'deposit_paid', 'pi_subtotal', 'pi_total', 'woo_order_no']) assert.equal(mapped[key], '', key)
})

test('legacy UC fallback keeps the existing precedence and does not validate or rewrite references', () => {
  for (const [uc_no, erp_pi_no, expected] of [
    ['UC-EXPLICIT', 'UC-LEGACY', 'UC-EXPLICIT'],
    ['', 'UC-LEGACY', 'UC-LEGACY'],
    [null, 'Free text legacy PI', 'Free text legacy PI'],
    [undefined, '', ''],
  ]) {
    const mapped = orderEditFields({ uc_no, erp_pi_no }, destination())
    assert.equal(mapped.uc_no, expected); assert.equal(mapped.erp_pi_no, erp_pi_no)
  }
})

test('only imported PI records fall back from absent PI reference totals to their stored amounts', () => {
  const legacy = orderEditFields({ source: 'imported_pi', subtotal: 123.456789, total_amount: 111.222333 }, destination())
  assert.equal(legacy.pi_subtotal, 123.456789); assert.equal(legacy.pi_total, 111.222333)
  for (const source of ['manual', 'woo', undefined]) {
    const mapped = orderEditFields({ source, subtotal: 123.456789, total_amount: 111.222333 }, destination())
    assert.equal(mapped.pi_subtotal, ''); assert.equal(mapped.pi_total, '')
    assert.equal(mapped.total_amount, 111.222333)
  }
  const absent = orderEditFields({ source: 'imported_pi', subtotal: null, total_amount: null }, destination())
  assert.equal(absent.pi_subtotal, ''); assert.equal(absent.pi_total, '')
})

test('explicit blank or zero PI references override imported fallbacks instead of being treated as absent', () => {
  for (const value of ['', 0]) {
    const mapped = orderEditFields({ source: 'imported_pi', subtotal: 100, total_amount: 90, pi_subtotal: value, pi_total: value }, destination())
    assert.equal(mapped.pi_subtotal, value); assert.equal(mapped.pi_total, value)
  }
})

test('amount strings and existing precision are preserved without parsing, rounding or total recalculation', () => {
  const values = {
    accounting_total: '1234.567890', discount_pct: '2.1250', discount_amount: '12.345678',
    deposit_paid: '155.123456', total_amount: '789.123456', pi_subtotal: '801.469134',
    pi_total: '789.123456', woo_fee: '3.14159265', woo_net_payout: '785.98186335',
    woo_net_payout_hkd: '6130.65853413',
  }
  const mapped = orderEditFields(values, destination())
  for (const [key, value] of Object.entries(values)) assert.equal(mapped[key], value, key)
})

test('explicit blank amounts stay blank rather than being coerced to zero or null', () => {
  const fields = ['accounting_total', 'discount_pct', 'discount_amount', 'deposit_paid', 'total_amount', 'pi_subtotal', 'pi_total', 'woo_fee', 'woo_net_payout', 'woo_net_payout_hkd']
  const mapped = orderEditFields({ ...Object.fromEntries(fields.map(key => [key, ''])), source: 'imported_pi', subtotal: 999, channel: '', woo_payout_date: '' }, destination())
  for (const key of fields) assert.equal(mapped[key], '', key)
  assert.equal(mapped.channel, null); assert.equal(mapped.woo_payout_date, null)
})

test('revision string conversion and hide-quantity truthiness retain the existing form rules', () => {
  for (const [input, expected] of [[undefined, ''], [null, ''], ['', ''], [0, ''], ['0', '0'], [4, '4'], ['04', '04']]) assert.equal(orderEditFields({ pi_revision: input }, destination()).pi_revision, expected)
  for (const [input, expected] of [[undefined, false], [null, false], [0, false], ['', false], [1, true], ['false', true], [true, true]]) assert.equal(orderEditFields({ hide_total_qty: input }, destination()).hide_total_qty, expected)
})

test('partial destinations merge into the supplied blanks without mutating either input', () => {
  const blanks = Object.freeze({ country: '', city: 'Default city', address: '', port: '' })
  const orderDestination = Object.freeze({ country: 'Hong Kong', city: null, address: undefined, extra: 'preserve nested source field' })
  const order = Object.freeze({ destination: orderDestination, notes: 'Keep original notes' })
  const mapped = orderEditFields(order, blanks)
  assert.deepEqual(mapped.destination, { country: 'Hong Kong', city: null, address: undefined, port: '', extra: 'preserve nested source field' })
  assert.notEqual(mapped.destination, blanks); assert.notEqual(mapped.destination, orderDestination)
  mapped.destination.country = 'Changed only in result'
  assert.equal(blanks.country, ''); assert.equal(orderDestination.country, 'Hong Kong')
  for (const empty of [undefined, null]) assert.deepEqual(orderEditFields({ destination: empty }, blanks).destination, blanks)
})
