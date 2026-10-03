// SEO control plane — Step 2: the batch / review contract.
// DeepSeek Workbench (DSH) prepares a batch of intended WordPress writes and
// posts it here; the human reviews and approves per-item in the OC
// (SeoReview.jsx); DSH polls for approved batches, executes them through its
// own safeWrite, and posts results back. The OC never writes WordPress; DSH
// never writes anything but seo_batches (via this endpoint).
//
// A Node Lambda (not a Deno edge fn) because it writes Firestore with the
// Admin SDK — same reason as portal-invite.js.
//
// Auth: a shared secret, NOT a Firebase session — the caller is a machine.
//   Header: Authorization: Bearer <SEO_BATCH_SECRET>
//   SEO_BATCH_SECRET must be set on Netlify AND in the Workbench .env.
//
// The OC re-runs the code gate on `create`: the stored `validation` is the
// OC's own result, `dsh_validation` keeps DSH's self-report, and `poll` will
// not release an approved item whose OC validation failed (decision downgraded
// to 'blocked'). DSH should send `source` (the EN original) on translation
// items so the structure/parity/brand checks can run.
//
// Ops (POST JSON):
//   { op: 'create', batch: { note, items: [{ id, kind, lang, endpoint,
//         summary, payload, before, source, validation }] } }
//       -> { id, failed_validation, skipped_validation, mismatches: [itemIndex] }
//          (400 if any item has an empty/absent `payload` — nothing to write)
//          `skipped_validation` = items where the OC gate could not run every
//          applicable check (no `source`, or a `.raw`-less source body). Those
//          are not failures, but a FULL pass is only `failed_validation: 0` AND
//          `skipped_validation: 0` (L-48).
//   { op: 'poll' }                 -> { batches: [...] }   status === 'approved'
//                                    (items that failed OC validation come
//                                     back as decision:'blocked')
//   { op: 'get', id }              -> { batch }
//   { op: 'result', id, results: [{ index, ok, after, verified, noop, error }] }
//                                  -> { status: 'executed' | 'partial' }
//
// `ok` and `verified` answer two different questions (2026-10-03): `ok` proves
// no UNINTENDED drift, `verified` proves the INTENDED change happened. A no-op
// satisfies the first trivially, so `ok:true, verified:false` is a failure to
// report — see safe-write.mjs and the `result` op below.
import { initAdminApp } from './lib/firebaseAdmin.js'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { timingSafeEqual } from 'node:crypto'
// The OC re-runs the code gate server-side on every incoming batch — DSH's
// self-reported `validation` is kept as `dsh_validation` for audit, but the
// authoritative result the reviewer sees (and that `poll` enforces) is this
// one. Same SSOT file DSH vendors verbatim; if it ever forks, the OC copy
// wins and DSH must re-vendor (seo-control-plane/README.md).
import { validatePayload } from '../../seo-control-plane/validate-payload.mjs'

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

function secretOk(req) {
  const expected = process.env.SEO_BATCH_SECRET
  if (!expected || expected.length < 16) return false
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!got || got.length !== expected.length) return false
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(expected)) } catch { return false }
}

// Indexes of items with nothing to write. `safeWrite` cannot tell a no-op from
// a real write (no write error, no drift → ok:true), so a payload-less item was
// accepted, wrote nothing, and the batch was marked `executed` with
// verified:true (2026-10-03). Rejected at the door instead. Exported so
// qa/seo-batch-guard.test.mjs can cover it without Firestore credentials.
export function emptyPayloadIndexes(items) {
  return (items || [])
    .map((it, i) => (!it.payload || (typeof it.payload === 'object' && Object.keys(it.payload).length === 0) ? i : null))
    .filter(i => i !== null)
}

// The batch verdict once results are in. `ok` ALONE is not enough: an item
// whose intended change never happened (`verified:false` — a no-op) is not a
// success, and the batch must not report `executed` (2026-10-03). A missing
// `verified` (an older DSH) falls back to `ok` rather than retro-failing.
export function batchOutcome(items) {
  const approved = (items || []).filter(it => it.decision === 'approve')
  const done = approved.filter(it => it.result)
  const succeeded = (it) => it.result?.ok === true && it.result?.verified !== false
  return {
    status: done.length === approved.length && approved.every(succeeded) ? 'executed' : 'partial',
    executed: done.filter(succeeded).length,
    unverified: done.filter(it => it.result?.verified === false).length,
    of: approved.length,
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try { initAdminApp() } catch (e) { return json({ error: String(e?.message || e) }, 500) }
  if (!secretOk(req)) return json({ error: 'Unauthorized' }, 401)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }

  const col = getFirestore().collection('seo_batches')

  if (body.op === 'create') {
    const items = Array.isArray(body.batch?.items) ? body.batch.items : null
    if (!items?.length) return json({ error: 'batch.items required' }, 400)
    if (items.length > 500) return json({ error: 'batch too large (max 500 items)' }, 400)

    const emptyPayloads = emptyPayloadIndexes(items)
    if (emptyPayloads.length) {
      return json({ error: 'item(s) with an empty payload — nothing to write', indexes: emptyPayloads }, 400)
    }

    // Server-side re-validation. `source` (the EN original) makes the full
    // check set run — structure/parity/brand checks cannot run without it — so
    // DSH should include it on translation items (and fetch it with
    // `context=edit`); `before` is only a fallback, and a FLAT `before` is fine:
    // validate-payload's `normalizeEntity` folds its `meta.*` keys into a nested
    // `meta`, so using it no longer silently disables the layout guards (L-48).
    // A validator throw becomes a failed check, never a 500.
    //
    // `ran`/`skipped` are carried through so a PARTIAL pass stays
    // distinguishable from a full one — see `skipped_validation` below.
    const revalidate = (it) => {
      try {
        const src = it.source ?? it.original ?? it.before ?? null
        const v = validatePayload({
          kind: it.kind ?? undefined,
          lang: it.lang ?? undefined,
          endpoint: String(it.endpoint || ''),
          payload: it.payload ?? {},
          source: src && typeof src === 'object' && Object.keys(src).length ? src : null,
        })
        return {
          passed: v.passed === true,
          checks: v.checks || [],
          ran: typeof v.ran === 'number' ? v.ran : null,
          skipped: typeof v.skipped === 'number' ? v.skipped : 0,
          by: 'oc',
          at: Timestamp.now(),
        }
      } catch (e) {
        return { passed: false, checks: [{ name: 'validator_error', ok: false, detail: String(e?.message || e) }], ran: 0, skipped: 0, by: 'oc', at: Timestamp.now() }
      }
    }

    let failed = 0
    const outItems = items.map((it, i) => {
      const validation = revalidate(it)
      if (!validation.passed) failed++
      const dsh = it.validation ?? { passed: null, checks: [] }
      return {
        index: i,
        id: it.id ?? null,
        kind: it.kind ?? null,
        lang: it.lang ?? null,
        endpoint: String(it.endpoint || ''),
        summary: String(it.summary || '').slice(0, 200),
        payload: it.payload ?? {},
        before: it.before ?? {},
        source: it.source ?? it.original ?? null,
        validation,                                   // OC's — authoritative
        dsh_validation: dsh,                           // what DSH claimed
        validation_mismatch: dsh.passed != null && dsh.passed !== validation.passed,
        decision: 'pending',
        result: null,
      }
    })

    const doc = {
      created_by: 'dsh',
      created_at: Timestamp.now(),
      note: String(body.batch.note || '').slice(0, 500),
      status: 'pending_review',
      item_count: outItems.length,
      oc_validated: true,
      failed_validation: failed,
      items: outItems,
    }
    const ref = await col.add(doc)
    // `skipped_validation` counts items whose OC gate could not run every
    // applicable check (no `source`, or a source body without `.raw`). They are
    // NOT failures — but `failed_validation: 0` on its own must never be read as
    // "fully validated", which is exactly the misreading L-48 removed.
    const skippedValidation = outItems.filter(x => (x.validation?.skipped || 0) > 0).length
    return json({
      ok: true,
      id: ref.id,
      failed_validation: failed,
      skipped_validation: skippedValidation,
      mismatches: outItems.filter(x => x.validation_mismatch).map(x => x.index),
    })
  }

  if (body.op === 'poll') {
    const snap = await col.where('status', '==', 'approved').limit(20).get()
    // Hard gate: an item can be approved in the UI but still have failed the
    // OC code gate — never release those for execution. Downgrade the
    // decision to 'blocked' so DSH's `decision === 'approve'` filter skips it.
    const batches = snap.docs.map((d) => {
      const b = { id: d.id, ...d.data() }
      let blocked = 0
      b.items = (b.items || []).map((it) => {
        if (it.decision === 'approve' && it.validation?.passed === false) {
          blocked++
          return { ...it, decision: 'blocked', block_reason: 'failed OC validation — not released' }
        }
        return it
      })
      if (blocked) b.blocked_count = blocked
      return b
    })
    return json({ batches })
  }

  if (body.op === 'get') {
    if (!body.id) return json({ error: 'id required' }, 400)
    const d = await col.doc(String(body.id)).get()
    if (!d.exists) return json({ error: 'not found' }, 404)
    return json({ batch: { id: d.id, ...d.data() } })
  }

  if (body.op === 'result') {
    if (!body.id || !Array.isArray(body.results)) return json({ error: 'id + results[] required' }, 400)
    const ref = col.doc(String(body.id))
    const d = await ref.get()
    if (!d.exists) return json({ error: 'not found' }, 404)
    const byIndex = new Map(body.results.map(r => [r.index, r]))
    // `verified` is kept as an explicit boolean when DSH sends one, and null
    // when it doesn't (an older DSH — fall back to `ok` for it rather than
    // retro-failing every result). A present `verified:false` means the
    // intended change did not happen (no-op), which is a failure to report.
    const items = (d.data().items || []).map(it => {
      const r = byIndex.get(it.index)
      return r
        ? { ...it, result: {
            ok: !!r.ok,
            after: r.after ?? null,
            verified: typeof r.verified === 'boolean' ? r.verified : null,
            noop: !!r.noop,
            error: r.error ?? null,
            at: Timestamp.now(),
          } }
        : it
    })
    const outcome = batchOutcome(items)
    await ref.update({ items, status: outcome.status, executed_at: Timestamp.now() })
    return json({ ok: true, ...outcome })
  }

  return json({ error: `Unknown op: ${body.op}` }, 400)
}

export const config = { path: '/api/seo-batch' }
