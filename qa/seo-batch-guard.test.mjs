// node qa/seo-batch-guard.test.mjs
//
// The two control-plane defects raised by DSH on 2026-10-03, on the OC side:
//   1. a write with no payload is rejected at `create` (emptyPayloadIndexes)
//   2. `ok:true, verified:false` (a no-op) must not report the batch `executed`
// Both helpers are pure and exported from netlify/functions/seo-batch.js, so
// they run here without Firestore credentials or a Netlify runtime.
import { emptyPayloadIndexes, batchOutcome } from '../netlify/functions/seo-batch.js'

let pass = 0, fail = 0
function expect(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── 1. empty/absent payloads are rejected at create ─────────────────────
{
  const items = [
    { payload: {} },                      // 0 — the DSH defect: omitted payload became {}
    { payload: { title: 'ok' } },          // 1 — fine
    { summary: 'no payload key at all' },  // 2
    { payload: [] },                       // 3 — an empty array writes nothing
    { payload: null },                     // 4
    { payload: { status: 'draft' } },      // 5 — fine
    { payload: 'raw string body' },         // 6 — a non-empty string is a body
  ]
  expect('flags every empty/absent payload', JSON.stringify(emptyPayloadIndexes(items)) === '[0,2,3,4]',
    JSON.stringify(emptyPayloadIndexes(items)))
  expect('nothing to reject is an empty list', emptyPayloadIndexes([{ payload: { a: 1 } }]).length === 0)
  expect('handles a missing items array', emptyPayloadIndexes(undefined).length === 0)
}

// ── 2. the batch verdict ────────────────────────────────────────────────
const it = (decision, result) => ({ decision, result })

{
  const o = batchOutcome([it('approve', { ok: true, verified: true }), it('approve', { ok: true, verified: true })])
  expect('all approved + verified → executed', o.status === 'executed' && o.executed === 2 && o.of === 2,
    JSON.stringify(o))
}

// The exact defect: safeWrite returned ok:true with nothing written.
{
  const o = batchOutcome([it('approve', { ok: true, verified: false, noop: true, error: 'no-op: none of the expected fields changed' })])
  expect('ok:true + verified:false → partial, NOT executed', o.status === 'partial', JSON.stringify(o))
  expect('  …counted as 0 executed', o.executed === 0, JSON.stringify(o))
  expect('  …and surfaced as unverified', o.unverified === 1, JSON.stringify(o))
}

{
  const o = batchOutcome([it('approve', { ok: true, verified: false }), it('approve', { ok: true, verified: true })])
  expect('one no-op poisons the batch', o.status === 'partial' && o.executed === 1 && o.unverified === 1, JSON.stringify(o))
}

{
  const o = batchOutcome([it('approve', { ok: false, verified: false, error: 'drift' })])
  expect('ok:false → partial', o.status === 'partial' && o.executed === 0, JSON.stringify(o))
}

// An older DSH omits `verified` entirely — fall back to `ok`, don't retro-fail.
{
  const o = batchOutcome([it('approve', { ok: true })])
  expect('missing verified falls back to ok → executed', o.status === 'executed' && o.executed === 1,
    JSON.stringify(o))
}

// Only approve/reject/blocked decisions that were actually approved count.
{
  const o = batchOutcome([
    it('approve', { ok: true, verified: true }),
    it('reject', null),
    it('blocked', null),
    it('pending', null),
  ])
  expect('rejected/blocked/pending items are not in `of`', o.of === 1 && o.status === 'executed', JSON.stringify(o))
}

// A batch with no results back yet is never `executed`.
{
  const o = batchOutcome([it('approve', { ok: true, verified: true }), it('approve', null)])
  expect('missing result → partial', o.status === 'partial' && o.executed === 1 && o.of === 2, JSON.stringify(o))
}

{
  const o = batchOutcome([it('approve', null)])
  expect('no results at all → partial, 0 of 1', o.status === 'partial' && o.executed === 0 && o.of === 1, JSON.stringify(o))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
