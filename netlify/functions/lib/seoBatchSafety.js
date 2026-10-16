// Shared queue policy and injected transaction helper. No credentials.
export class QueueConflict extends Error {}
export function entityKey(item) {
  const path = String(item.endpoint || '').split('?')[0].replace(/^\/+|\/+$/g, '')
  const match = /^(wp\/v2\/(?:pages|posts)|wc\/v3\/products)\/(\d+)$/.exec(path)
  return match ? match[1] + '/' + Number(match[2]) : null
}
export function supersedesIds(value) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20
      || value.some(v => typeof v !== 'string' || !/^[\w-]{1,128}$/.test(v))
      || new Set(value).size !== value.length) throw new Error('supersedes must contain up to 20 unique batch IDs')
  return value
}
export const withdrawable = b => !!b && ['pending_review', 'approved'].includes(b.status)
  && !b.superseded_by && !b.execution_started_at && !(b.items || []).some(it => it.result)
const activeItems = b => (b.items || []).filter(it => it.decision !== 'reject' && !it.result)
export function queuePlan(items, batches, supersedes = []) {
  const targets = items.map(entityKey).filter(Boolean)
  if (new Set(targets).size !== targets.length) throw new QueueConflict('Combine edits to the same entity into one batch item')
  for (const id of supersedes) {
    const b = batches.find(b => b.id === id)
    if (!withdrawable(b)) {
      throw new QueueConflict('Only unclaimed pending-review or approved batches with no results may be superseded: ' + id)
    }
    if (!activeItems(b).some(it => targets.includes(entityKey(it)))) throw new QueueConflict('Superseded batch does not overlap this replacement: ' + id)
  }
  const conflicts = batches.filter(b => !supersedes.includes(b.id) && !b.superseded_by
    && ['pending_review', 'approved', 'executing'].includes(b.status)
    && activeItems(b).some(it => targets.includes(entityKey(it))))
    .map(b => b.id)
  return { conflicts, supersedes }
}
export function releaseBatch(batch) {
  if (batch.status !== 'approved' || batch.superseded_by || batch.execution_started_at) return null
  let blocked = 0
  const items = (batch.items || []).map(it => {
    if (it.decision === 'approve' && it.validation?.passed !== true) {
      blocked++
      return { ...it, decision: 'blocked', block_reason: 'OC validation not passed — not released' }
    }
    return it
  })
  return { ...batch, items, ...(blocked ? { blocked_count: blocked } : {}) }
}

// Exported with injected store so tests exercise the actual transaction writes.
export async function storeQueuedBatch(db, col, ref, doc, supersedes) {
  return db.runTransaction(async tx => {
    // Query and replacement writes share one serialisable transaction.
    // Concurrent creates cannot both miss an overlapping pending batch.
    const active = await tx.get(col.where('status', 'in', ['pending_review', 'approved', 'executing']))
    const batches = active.docs.map(d => ({ ...d.data(), id: d.id }))
    for (const id of supersedes) if (!batches.some(b => b.id === id)) {
      const old = await tx.get(col.doc(id))
      if (old.exists) batches.push({ ...old.data(), id })
    }
    const plan = queuePlan(doc.items, batches, supersedes)
    if (plan.conflicts.length) {
      const e = new QueueConflict('An active batch already targets this entity; combine edits or supersede its unclaimed batch')
      e.conflicts = plan.conflicts
      throw e
    }
    for (const id of supersedes) tx.update(col.doc(id), {
      status: 'superseded', superseded_by: ref.id, superseded_at: doc.created_at,
    })
    tx.set(ref, { ...doc, supersedes })
  })
}

// Claim and supersession read/write the same document in transactions. One wins;
// absence of a result is NOT proof that a worker has not already started.
export async function claimBatch(db, ref, at) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const batch = snap.exists ? releaseBatch({ ...snap.data(), id: ref.id }) : null
    if (!batch || !withdrawable(batch) || !(batch.items || []).some(it => it.decision === 'approve' && !it.result)) {
      throw new QueueConflict('Batch is not available for execution; do not write')
    }
    tx.update(ref, { status: 'executing', execution_started_at: at })
    return { ...batch, status: 'executing', execution_started_at: at }
  })
}
export async function withdrawBatch(db, ref, at, reason) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists || !withdrawable(snap.data())) throw new QueueConflict('Batch is claimed or has results; cannot withdraw')
    tx.update(ref, { status: 'withdrawn', withdrawn_at: at, withdrawal_reason: reason, withdrawn_by: 'dsh' })
  })
}
