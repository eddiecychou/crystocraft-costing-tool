import test, { before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocFromServer, getDocsFromServer, setDoc, updateDoc } from 'firebase/firestore'

// Firestore SDK test with the repository's rules and two loopback clients.
const loopback = /^127\.0\.0\.1:(\d+)$/.exec(process.env.FIRESTORE_EMULATOR_HOST || '')
assert.ok(loopback, 'Only a loopback Firestore emulator may be used')
const componentId = 'fictional-metal-component'
const component = 'range_components/' + componentId
const quotePath = component + '/supplier_quotes'
const staff = { role: 'staff', modules: ['supply'] }
const originalFile = { file_name: 'fictional-original.pdf', file_url: '/fictional-original.pdf', metadata: { source: 'Fictional supplier', revision: 5 } }
const addedFile = { file_name: 'fictional-addendum.pdf', file_url: '/fictional-addendum.pdf' }
const concurrentFile = { file_name: 'fictional-concurrent.pdf', file_url: '/fictional-concurrent.pdf' }
const componentFields = { code: 'QA-METAL-G', name: 'Fictional metal component', plating_code: 'G', stock_qty: 82, reserved_qty: 11, movement_seq: 5 }
const noPreferred = { unit_cost: null, volume_tiers: [], tooling_sample_cost: null, preferred_supplier_name: '', preferred_quote_id: null }
const costKeys = [...Object.keys(noPreferred), 'unit_cost_currency', 'tooling_sample_cost_currency']
const attachmentOptions = { isOpen: () => true, allowAlreadySaved: true }
const options = { timeout: 20000 }
let env, scratch, dbA, dbB, writerA, writerB, original, candidateA, candidateB

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-range-quote-transaction',
    firestore: { host: '127.0.0.1', port: Number(loopback[1]), rules: await readFile('firestore.rules', 'utf8') },
  })
  await mkdir('qa/out', { recursive: true })
  scratch = await mkdtemp(resolve('qa/out/range-quote-tx-'))
  const bundle = join(scratch, 'writer.mjs')
  await build({
    stdin: {
      contents: `
        export { saveComponentQuote, setPreferredQuote, deleteComponentQuote, normQuote } from './src/criticalComponents.js'
        export { saveQuoteAttachments } from './src/supplierQuoteAttachments.js'
        export { mergeSuppliers } from './src/domain/supplierMerge.js'
      `,
      resolveDir: process.cwd(),
    },
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [{
      name: 'fixture-only-emulator-hooks',
      setup(builder) {
        builder.onResolve({ filter: /^\.\.?\/firebase$/ }, () => ({ path: 'db', namespace: 'fixture' }))
        builder.onResolve({ filter: /^firebase\/firestore$/ }, args => args.namespace === 'fixture'
          ? { path: args.path, external: true }
          : { path: 'firestore', namespace: 'fixture' })
        builder.onLoad({ filter: /^db$/, namespace: 'fixture' }, () => ({
          contents: 'export const db = globalThis.rangePreferredReviewDb',
        }))
        builder.onLoad({ filter: /^firestore$/, namespace: 'fixture' }, () => ({
          contents: `
            import { getDocsFromServer as list, runTransaction as run } from 'firebase/firestore'
            export * from 'firebase/firestore'
            export async function getDocsFromServer(ref) {
              await globalThis.rangePreferredReviewBeforeList?.(ref)
              const snap = await list(ref)
              await globalThis.rangePreferredReviewAfterList?.(ref)
              return snap
            }
            export async function runTransaction(db, work) {
              const result = await run(db, async tx => {
                const value = await work(tx)
                await globalThis.rangePreferredReviewBeforeCommit?.(db)
                return value
              })
              await globalThis.rangePreferredReviewAfterCommit?.(db)
              return result
            }
          `,
        }))
      },
    }],
  })
  dbA = env.authenticatedContext('fixture-editor-a').firestore()
  dbB = env.authenticatedContext('fixture-editor-b').firestore()
  globalThis.rangePreferredReviewDb = dbA
  writerA = await import(pathToFileURL(bundle).href + '?a')
  globalThis.rangePreferredReviewDb = dbB
  writerB = await import(pathToFileURL(bundle).href + '?b')

  const { normQuote } = writerA
  original = normQuote({
    supplier_id: 'fixture-original', supplier_name: 'Fictional Original',
    unit_cost: 1.222, unit_cost_currency: 'USD', volume_tiers: [{ min_qty: 1000, unit_cost: 1.111 }],
    moq: 100, tooling_sample_cost: 155, tooling_sample_cost_currency: 'USD', production_lead_time_days: 30,
    is_preferred: true, notes: 'Fictional approved terms', attachments: [originalFile],
  })
  candidateA = normQuote({
    supplier_id: 'fixture-option-a', supplier_name: 'Fictional Option A',
    unit_cost: 2.222, unit_cost_currency: 'RMB', volume_tiers: [{ min_qty: 2000, unit_cost: 2.111 }],
    tooling_sample_cost: 200,
  })
  candidateB = normQuote({
    supplier_id: 'fixture-option-b', supplier_name: 'Fictional Option B',
    unit_cost: 3.333, unit_cost_currency: 'EUR', volume_tiers: [{ min_qty: 3000, unit_cost: 3.222 }],
    tooling_sample_cost: 300,
  })
}, { timeout: 30000 })

function costSnapshot(id, quote) {
  return {
    unit_cost: quote.unit_cost, unit_cost_currency: quote.unit_cost_currency, volume_tiers: quote.volume_tiers,
    tooling_sample_cost: quote.tooling_sample_cost, tooling_sample_cost_currency: quote.tooling_sample_cost_currency,
    preferred_supplier_name: quote.supplier_name, preferred_quote_id: id,
  }
}

beforeEach(async () => {
  delete globalThis.rangePreferredReviewBeforeList
  delete globalThis.rangePreferredReviewAfterList
  delete globalThis.rangePreferredReviewBeforeCommit
  delete globalThis.rangePreferredReviewAfterCommit
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users/fixture-editor-a'), staff),
      setDoc(doc(db, 'users/fixture-editor-b'), staff),
      setDoc(doc(db, component), { ...componentFields, ...costSnapshot('original', original) }),
      setDoc(doc(db, quotePath, 'original'), original),
      setDoc(doc(db, quotePath, 'a'), candidateA),
      setDoc(doc(db, quotePath, 'b'), candidateB),
    ])
  })
})

after(async () => {
  delete globalThis.rangePreferredReviewDb
  delete globalThis.rangePreferredReviewBeforeList
  delete globalThis.rangePreferredReviewAfterList
  delete globalThis.rangePreferredReviewBeforeCommit
  delete globalThis.rangePreferredReviewAfterCommit
  await env?.cleanup()
  if (scratch) await rm(scratch, { force: true, recursive: true })
})

async function reload() {
  const [componentDoc, listed] = await Promise.all([
    getDocFromServer(doc(dbB, component)),
    getDocsFromServer(collection(dbB, quotePath)),
  ])
  const fields = componentDoc.data()
  for (const [key, value] of Object.entries(componentFields)) assert.equal(fields[key], value)
  const quotes = Object.fromEntries(listed.docs.map(row => [row.id, row.data()]))
  const preferred = Object.keys(quotes).filter(id => quotes[id].is_preferred).sort()
  const snapshot = Object.fromEntries(costKeys.map(key => [key, fields[key]]))
  return { quotes, preferred, snapshot, parent: fields }
}

function latch() {
  let release
  const wait = new Promise(resolve => { release = resolve })
  return { wait, release }
}

async function setEditorAAccess(enabled) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users/fixture-editor-a'), enabled ? staff : { ...staff, modules: [] })
  })
}

function edit(writer, id, row, changes) {
  const { volume_tiers, attachments, updatedAt, createdAt, create_payload_hash, ...form } = row
  const original = { form, tiers: volume_tiers, attachments, stored: row }
  return writer.saveComponentQuote(componentId, id, { ...form, volume_tiers, attachments, ...changes }, undefined, { original })
}

function create(writer, id, changes = {}) {
  const draft = { ...original, supplier_id: 'fixture-new', supplier_name: 'New Fictional Supplier', unit_cost: 4.444, ...changes }
  return writer.saveComponentQuote(componentId, null, draft, undefined, { createId: id })
}

function assertPreferred(state, id, expected) {
  assert.deepEqual(state.preferred, [id])
  assert.deepEqual(state.snapshot, costSnapshot(id, expected))
}

test('two explicit selections of different quotes retry against the same component', options, async () => {
  const bothListed = latch()
  let count = 0
  globalThis.rangePreferredReviewAfterList = async ref => {
    assert.equal(ref.path, quotePath)
    if (++count === 2) bothListed.release()
    await bothListed.wait
  }
  await Promise.all([
    writerA.setPreferredQuote(componentId, 'a'),
    writerB.setPreferredQuote(componentId, 'b'),
  ])
  const state = await reload()
  assert.ok(count >= 3, 'expected an automatic SDK retry')
  assert.ok(['a', 'b'].includes(state.snapshot.preferred_quote_id))
  assertPreferred(state, state.snapshot.preferred_quote_id, state.quotes[state.snapshot.preferred_quote_id])
  assert.deepEqual(state.quotes.original, { ...original, is_preferred: false })
})

test('a delayed commit retries after another selection and leaves the winning cost aligned', options, async () => {
  const staged = latch()
  const resume = latch()
  let count = 0
  globalThis.rangePreferredReviewBeforeCommit = async db => {
    if (db !== dbA || ++count > 1) return
    staged.release()
    await resume.wait
  }
  const first = writerA.setPreferredQuote(componentId, 'a')
  try {
    await staged.wait
    await writerB.setPreferredQuote(componentId, 'b')
    assertPreferred(await reload(), 'b', candidateB)
  } finally {
    resume.release()
    await first
  }
  assert.ok(count >= 2)
  assertPreferred(await reload(), 'a', candidateA)
})

test('a note save during a competing selection preserves the price, attachment and winner', options, async () => {
  const staged = latch()
  const resume = latch()
  let count = 0
  globalThis.rangePreferredReviewBeforeCommit = async db => {
    if (db !== dbA || ++count > 1) return
    staged.release()
    await resume.wait
  }
  const first = edit(writerA, 'original', original, { notes: 'Fictional revised note' })
  try {
    await staged.wait
    await edit(writerB, 'original', original, { unit_cost: 1.556 })
    await writerB.setPreferredQuote(componentId, 'b')
    await writerB.saveQuoteAttachments(doc(dbB, quotePath, 'original'), [originalFile], [originalFile, concurrentFile], attachmentOptions)
  } finally {
    resume.release()
    await first
  }
  const state = await reload()
  assert.ok(count >= 2)
  assertPreferred(state, 'b', candidateB)
  assert.equal(state.quotes.original.unit_cost, 1.556)
  assert.equal(state.quotes.original.notes, 'Fictional revised note')
  assert.deepEqual(state.quotes.original.attachments, [originalFile, concurrentFile])
})

test('a preference change between the parent read and quote list retries an unrelated draft', options, async () => {
  const beforeList = latch()
  const resume = latch()
  let count = 0
  const editorAFirestore = collection(dbA, quotePath).firestore
  globalThis.rangePreferredReviewBeforeList = async ref => {
    if (ref.firestore !== editorAFirestore || ++count > 1) return
    beforeList.release()
    await resume.wait
  }
  const first = edit(writerA, 'original', original, { notes: 'Draft waiting on the list' })
  try {
    await beforeList.wait
    await writerB.setPreferredQuote(componentId, 'b')
  } finally {
    resume.release()
    await first
  }
  const saved = await reload()
  assert.ok(count >= 2)
  assertPreferred(saved, 'b', candidateB)
  assert.equal(saved.quotes.original.notes, 'Draft waiting on the list')
})

test('overlapping price, currency and mixed attachment edits fail without modifying the newer record', options, async () => {
  await edit(writerB, 'original', original, { unit_cost: 1.556, unit_cost_currency: 'EUR' })
  await writerB.saveQuoteAttachments(doc(dbB, quotePath, 'original'), [originalFile], [originalFile, concurrentFile], attachmentOptions)
  const newer = await reload()
  await assert.rejects(edit(writerA, 'original', original, { unit_cost: 1.777 }), /changed in another session/)
  await assert.rejects(edit(writerA, 'original', original, { volume_tiers: [{ min_qty: 1000, unit_cost: 1.333 }] }), /changed in another session/)
  await assert.rejects(edit(writerA, 'original', original, { notes: 'Draft note', attachments: [originalFile, addedFile] }), /Attachments changed/)
  assert.deepEqual(await reload(), newer)
})

for (const [kind, action] of Object.entries({
  edit: () => edit(writerA, 'original', original, { unit_cost: 1.555, tooling_sample_cost: 180 }),
  create: () => create(writerA, 'retry-create'),
  select: () => writerA.setPreferredQuote(componentId, 'b'),
  delete: () => writerA.deleteComponentQuote(componentId, 'original'),
})) {
  test(`a real rejected ${kind} commit leaves every quote and component field intact and can retry`, options, async () => {
    const before = await reload()
    globalThis.rangePreferredReviewBeforeCommit = async db => {
      if (db === dbA) await setEditorAAccess(false)
    }
    await assert.rejects(action(), { code: 'permission-denied' })
    assert.deepEqual(await reload(), before)
    delete globalThis.rangePreferredReviewBeforeCommit
    await setEditorAAccess(true)
    await action()
    const saved = await reload()
    if (kind === 'delete') {
      assert.deepEqual(saved.quotes, { a: candidateA, b: candidateB })
      assert.deepEqual(saved.preferred, [])
      assert.deepEqual(saved.snapshot, { ...noPreferred, unit_cost_currency: 'USD', tooling_sample_cost_currency: 'USD' })
    } else {
      const id = { edit: 'original', create: 'retry-create', select: 'b' }[kind]
      assertPreferred(saved, id, saved.quotes[id])
      assert.deepEqual(saved.quotes.original.attachments, [originalFile])
      if (kind === 'edit') {
        assert.equal(saved.snapshot.unit_cost, 1.555)
        assert.equal(saved.snapshot.tooling_sample_cost, 180)
      }
      if (kind === 'create') {
        assert.equal(Object.keys(saved.quotes).length, 4)
        assert.deepEqual(saved.quotes[id].attachments, [originalFile])
      }
    }
  })
}

test('a lost create response recovers the exact quote once even if another editor selected a different quote', options, async () => {
  globalThis.rangePreferredReviewAfterCommit = db => {
    if (db === dbA) throw new Error('Fictional lost response')
  }
  await assert.rejects(create(writerA, 'lost-create'), /lost response/)
  const committed = await reload()
  assertPreferred(committed, 'lost-create', committed.quotes['lost-create'])
  delete globalThis.rangePreferredReviewAfterCommit
  await writerB.setPreferredQuote(componentId, 'b')
  const current = await reload()
  assert.equal(await create(writerA, 'lost-create'), 'lost-create')
  assert.deepEqual(await reload(), current)
  await assert.rejects(create(writerA, 'lost-create', { notes: 'New unsaved draft terms' }), /already saved with different terms/)
  assert.deepEqual(await reload(), current)
  assert.equal(await create(writerA, 'intentional-second-quote', { is_preferred: false }), 'intentional-second-quote')
  const final = await reload()
  assert.equal(Object.keys(final.quotes).length, 5)
  assertPreferred(final, 'b', candidateB)
  assert.deepEqual(final.quotes['lost-create'].attachments, [originalFile])
})

test('deleting an unselected quote preserves the selected price and a stale delete protects changed files', options, async () => {
  await writerA.deleteComponentQuote(componentId, 'a')
  assertPreferred(await reload(), 'original', original)
  await writerB.saveQuoteAttachments(doc(dbB, quotePath, 'original'), [originalFile], [originalFile, concurrentFile], attachmentOptions)
  const state = await reload()
  await assert.rejects(writerA.deleteComponentQuote(componentId, 'original', undefined, { original }), /changed in another session/)
  assert.deepEqual(await reload(), state)
})

test('stale selection and edit cannot recreate a deleted quote, and a delete retry leaves newer preference alone', options, async () => {
  await writerB.deleteComponentQuote(componentId, 'original')
  await writerB.setPreferredQuote(componentId, 'b')
  const saved = await reload()
  assertPreferred(saved, 'b', candidateB)
  await assert.rejects(writerA.setPreferredQuote(componentId, 'original'), /no longer exists/)
  await assert.rejects(edit(writerA, 'original', original, { notes: 'Draft note' }), /no longer exists/)
  await assert.rejects(writerA.saveQuoteAttachments(doc(dbA, quotePath, 'original'), [originalFile], [originalFile, addedFile], attachmentOptions), /Attachments changed/)
  await writerA.deleteComponentQuote(componentId, 'original')
  assert.deepEqual(await reload(), saved)
})

test('clearing a preferred quote leaves no preferred supplier and preserves alternative attachments', options, async () => {
  await writerB.saveQuoteAttachments(doc(dbB, quotePath, 'b'), [], [addedFile], attachmentOptions)
  await edit(writerA, 'original', original, { is_preferred: false })
  const state = await reload()
  assert.deepEqual(state.preferred, [])
  assert.equal(state.snapshot.preferred_quote_id, null)
  assert.equal(state.snapshot.unit_cost, null)
  assert.deepEqual(state.quotes.original.attachments, [originalFile])
  assert.deepEqual(state.quotes.b.attachments, [addedFile])
})

test('attachment-only saves and retries keep newer pricing and block a genuinely different attachment list', options, async () => {
  await edit(writerB, 'original', original, { unit_cost: 1.556 })
  await writerB.setPreferredQuote(componentId, 'b')
  const ref = doc(dbA, quotePath, 'original')
  await writerA.saveQuoteAttachments(ref, [originalFile], [originalFile, addedFile], attachmentOptions)
  const state = await reload()
  assertPreferred(state, 'b', candidateB)
  assert.equal(state.quotes.original.unit_cost, 1.556)
  assert.deepEqual(state.quotes.original.attachments, [originalFile, addedFile])
  await writerA.saveQuoteAttachments(ref, [originalFile], [originalFile, addedFile], attachmentOptions)
  await assert.rejects(writerB.saveQuoteAttachments(doc(dbB, quotePath, 'original'), [originalFile], [originalFile, concurrentFile], attachmentOptions), /Attachments changed/)
  assert.deepEqual(await reload(), state)
})

test('historic conflicting flags are left for an explicit selection', options, async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), quotePath, 'b'), { ...candidateB, is_preferred: true })
  })
  const legacy = await reload()
  await assert.rejects(edit(writerA, 'original', original, { notes: 'Retain my draft' }), /costing disagree/)
  assert.deepEqual(await reload(), legacy)
  await writerA.setPreferredQuote(componentId, 'b')
  assertPreferred(await reload(), 'b', candidateB)
})

test('legacy standalone cost survives creating an unselected quote', options, async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await updateDoc(doc(db, quotePath, 'original'), { is_preferred: false })
    await updateDoc(doc(db, component), { preferred_quote_id: null, preferred_supplier_name: '' })
  })
  const before = await reload()
  const created = await create(writerA, 'unselected', { is_preferred: false, supplier_id: '' })
  const after = await reload()
  assert.deepEqual(after.preferred, [])
  assert.deepEqual(after.snapshot, before.snapshot)
  assert.equal(after.quotes[created].supplier_id, '')
})

test('a pending Range note keeps the supplier identity updated by supplier merge', options, async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'suppliers', original.supplier_id), { name: original.supplier_name })
    await setDoc(doc(db, 'suppliers', 'fixture-survivor'), { name: 'Fictional survivor' })
  })
  const preview = await writerB.mergeSuppliers(original.supplier_id, 'fixture-survivor')
  assert.equal(preview.rangeQuoteCount, 1)
  await edit(writerA, 'original', original, { notes: 'Draft from before the merge' })
  const saved = await reload()
  assert.equal(saved.quotes.original.supplier_id, 'fixture-survivor')
  assert.equal(saved.quotes.original.supplier_name, 'Fictional survivor')
  assert.deepEqual(saved.quotes.original.attachments, [originalFile])
  assertPreferred(saved, 'original', { ...original, supplier_name: 'Fictional survivor' })
})
