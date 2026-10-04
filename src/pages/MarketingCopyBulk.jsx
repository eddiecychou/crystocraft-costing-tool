import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useRole } from '../access'
import { REGENERATE_IDS, TARGET_IDS } from '../marketingRegenerationList'
import { applyApproved, delay, generatePreview, loadJob, MAX_COPY_CHARS, readTarget, saveJob, verifyTargets } from '../marketingRegeneration'

export default function MarketingCopyBulk({ embedded = false }) {
  const role = useRole()
  const [job, setJob] = useState(loadJob)
  const jobRef = useRef(job)
  const [busy, setBusy] = useState('')
  const [activeId, setActiveId] = useState('')
  const [verification, setVerification] = useState(null)
  const [verifyProgress, setVerifyProgress] = useState(0)
  const [notice, setNotice] = useState('')
  const stopRef = useRef(false)
  useEffect(() => () => { stopRef.current = true }, [])

  if (role !== 'admin') return <Navigate to="/products" replace />

  function change(id, patch) {
    const next = { ...jobRef.current, entries: { ...jobRef.current.entries, [id]: { ...jobRef.current.entries[id], ...patch } } }
    jobRef.current = next
    setJob(next)
    try { saveJob(next) } catch { setNotice('Browser storage is full; keep this tab open and export the report before leaving.') }
  }

  async function preview() {
    setBusy('preview')
    setNotice('')
    stopRef.current = false
    for (const id of TARGET_IDS) {
      if (stopRef.current) break
      if (['previewed', 'written', 'write_failed'].includes(jobRef.current.entries[id]?.status)) continue
      setActiveId(id)
      try {
        const product = await readTarget(id)
        const before = product.marketing_description || ''
        const guidance = jobRef.current.entries[id]?.guidance?.trim() || ''
        const after = await generatePreview(product, guidance)
        change(id, { name: product.name || id, before, after, previousChars: before.length, newChars: after.length, approved: false, status: 'previewed', error: '', instructionsApplied: guidance, previewId: crypto.randomUUID(), landed: false })
      } catch (error) {
        change(id, { status: 'preview_failed', approved: false, error: error.message || String(error) })
      }
      if (!stopRef.current) await delay(800)
    }
    setActiveId('')
    setBusy('')
  }

  async function rewriteOne(id) {
    const guidance = jobRef.current.entries[id]?.guidance?.trim()
    if (!guidance) return
    setBusy('rewrite')
    setActiveId(id)
    setNotice('')
    try {
      const product = await readTarget(id)
      const before = product.marketing_description || ''
      const after = await generatePreview(product, guidance)
      change(id, { name: product.name || id, before, after, previousChars: before.length, newChars: after.length, approved: false, status: 'previewed', error: '', instructionsApplied: guidance, previewId: crypto.randomUUID(), landed: false })
    } catch (error) {
      change(id, { approved: false, error: `Rewrite failed: ${error.message || String(error)}. Existing copy and preview were not changed.` })
    } finally {
      setActiveId('')
      setBusy('')
    }
  }

  async function apply() {
    setBusy('apply')
    setNotice('')
    stopRef.current = false
    for (const id of TARGET_IDS) {
      if (stopRef.current) break
      const entry = jobRef.current.entries[id]
      if (entry?.status !== 'previewed' || !entry.approved) continue
      setActiveId(id)
      try {
        const chars = await applyApproved(id, entry, jobRef.current.runId)
        change(id, { status: 'written', approved: false, landed: true, newChars: chars, error: '' })
      } catch (error) {
        change(id, { status: 'write_failed', landed: false, error: error.message || String(error) })
      }
      if (!stopRef.current) await delay(800)
    }
    setActiveId('')
    if (!stopRef.current) {
      setBusy('verify')
      setVerifyProgress(0)
      setVerification(await verifyTargets(setVerifyProgress))
    }
    setBusy('')
  }

  async function verify() {
    setBusy('verify')
    setVerification(null)
    setVerifyProgress(0)
    const results = await verifyTargets(setVerifyProgress)
    setVerification(results)
    setBusy('')
  }

  function downloadReport() {
    const rows = TARGET_IDS.map(id => {
      const e = job.entries[id] || {}
      const v = verification?.find(item => item.id === id) || {}
      return { id, group: REGENERATE_IDS.includes(id) ? 'Regenerate' : 'Generate', name: e.name || v.name || '', status: e.status || 'pending', previous_chars: e.previousChars ?? '', new_chars: e.newChars ?? '', write_landed: e.landed === true, over_300: (e.newChars || 0) > MAX_COPY_CHARS || v.overLimit === true, verified_chars: v.chars ?? '', verified_has_copy: v.hasCopy ?? '', error: e.error || v.error || '' }
    })
    const blob = new Blob([JSON.stringify({ runId: job.runId, results: rows }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `marketing-copy-${job.runId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const entries = job.entries
  const counts = {
    previewed: TARGET_IDS.filter(id => entries[id]?.status === 'previewed').length,
    written: TARGET_IDS.filter(id => entries[id]?.status === 'written').length,
    skipped: TARGET_IDS.filter(id => entries[id]?.status === 'previewed' && !entries[id]?.approved).length,
    failed: TARGET_IDS.filter(id => ['preview_failed', 'write_failed'].includes(entries[id]?.status)).length,
    left: TARGET_IDS.filter(id => !['written'].includes(entries[id]?.status)).length,
  }
  const staged = TARGET_IDS.filter(id => entries[id]?.status === 'previewed' || entries[id]?.status === 'written').length
  const approved = TARGET_IDS.filter(id => entries[id]?.status === 'previewed' && entries[id]?.approved).length
  const verified = verification && { total: verification.length, withCopy: verification.filter(r => r.hasCopy).length, withinLimit: verification.filter(r => r.hasCopy && !r.overLimit).length }

  return <div className="p-6 max-w-6xl mx-auto space-y-5">
    <div>
      {!embedded && <Link to="/settings?tab=products&sub=marketing-copy" className="text-sm text-brand-600">← Settings · Products</Link>}
      <h1 className="text-2xl text-ink mt-2">Bulk marketing copy review</h1>
      <p className="text-sm text-ink-60">Fixed allowlist: 75 regenerate + 39 generate = 114 products. The 13 already-compliant products are excluded.</p>
      <p className="text-sm text-ink-60">Previews never write. Every item defaults to skip; approve each diff individually. Keep this tab open while a run is active. Progress is saved in this browser.</p>
    </div>

    <div className="card p-4 space-y-3">
      <p className="text-sm">Previewed {staged}/114 · Succeeded {counts.written} · Skipped {counts.skipped} · Failed {counts.failed} · Left {counts.left}</p>
      {activeId && <p className="text-sm text-brand-700">{busy === 'preview' ? 'Generating preview' : busy === 'apply' ? 'Saving' : 'Checking'}: {activeId}</p>}
      {busy === 'verify' && <p className="text-sm text-brand-700">Re-reading {verifyProgress}/114 from Firestore…</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary text-sm" disabled={Boolean(busy)} onClick={preview}>Generate / resume dry-run previews</button>
        <button className="btn-primary text-sm" disabled={Boolean(busy) || approved === 0} onClick={apply}>Save {approved} approved</button>
        <button className="btn-secondary text-sm" disabled={Boolean(busy)} onClick={verify}>Re-read all 114</button>
        <button className="btn-secondary text-sm" onClick={downloadReport}>Download report</button>
        {busy && <button className="btn-secondary text-sm" onClick={() => { stopRef.current = true }}>Stop after current item</button>}
      </div>
      <p className="text-xs text-ink-60">A failed item stays in the report. Retry a failed preview with the item button; retry a failed save after inspecting the error. Saving backs up the previous text atomically in product_marketing_history.</p>
      {notice && <p role="alert" className="text-sm text-red-700">{notice}</p>}
      {verified && <div className="text-sm" role="status"><p>Verification: {verified.total} targeted · {verified.withCopy} with copy · {verified.withinLimit} with copy at ≤300 characters.</p>{verified.withinLimit !== 114 && <p className="text-red-700">Not complete: inspect failed, skipped, or over-limit items below before claiming success.</p>}</div>}
    </div>

    <div className="space-y-3">
      {TARGET_IDS.map(id => {
        const e = entries[id] || {}
        const v = verification?.find(item => item.id === id)
        const compliantBefore = Boolean(e.before?.trim()) && e.previousChars <= MAX_COPY_CHARS
        const instructionsChanged = (e.guidance || '').trim() !== (e.instructionsApplied || '')
        return <div key={id} className="card p-4 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="text-sm font-medium text-ink">{e.name || id}</p><p className="text-xs text-ink-60">{REGENERATE_IDS.includes(id) ? 'Regenerate' : 'Generate'} · {id}</p></div>
            <span className="text-xs text-ink-60">{e.status || 'pending'} · before {e.previousChars ?? '—'} chars · after {e.newChars ?? '—'} chars {e.newChars > MAX_COPY_CHARS ? '⚠ OVER 300' : ''}</span>
          </div>
          {e.status === 'previewed' && <>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <div><p className="font-medium">Before</p><p className="whitespace-pre-wrap bg-ivory-dark p-3">{e.before || '(empty)'}</p></div>
              <div><p className="font-medium">After</p><p className="whitespace-pre-wrap bg-ivory-dark p-3">{e.after}</p></div>
            </div>
            {compliantBefore && <p className="text-xs text-amber-700">Current copy is already within 300 characters; leave skipped unless you explicitly want to replace it.</p>}
            {instructionsChanged && <p className="text-xs text-amber-700">Instructions changed. Regenerate this preview before approving it.</p>}
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(e.approved)} disabled={Boolean(busy) || instructionsChanged} onChange={event => change(id, { approved: event.target.checked })} />Approve replacement (default: skip)</label>
          </>}
          {e.status === 'written' && <p className="text-sm text-green-700">Write landed; backup saved. {e.previousChars} → {e.newChars} characters.</p>}
          {['previewed', 'written'].includes(e.status) && <div className="space-y-1">
            <label htmlFor={`guidance-${id}`} className="block text-sm font-medium">AI rewrite instructions for this item</label>
            <textarea id={`guidance-${id}`} className="input w-full" rows={2} value={e.guidance || ''} disabled={Boolean(busy)} placeholder="E.g. Do not mention specific colours; colour is customisable." onChange={event => change(id, { guidance: event.target.value, approved: false })} />
            <button className="btn-secondary text-sm" disabled={Boolean(busy) || !e.guidance?.trim()} onClick={() => rewriteOne(id)}>{e.status === 'written' ? 'Revise saved copy with instructions' : 'Regenerate this preview with instructions'}</button>
            {e.instructionsApplied && <p className="text-xs text-ink-60">Instructions used for current preview: {e.instructionsApplied}</p>}
          </div>}
          {e.error && <p role="alert" className="text-sm text-red-700">{e.error}</p>}
          {e.status === 'preview_failed' && <button className="btn-secondary text-sm" disabled={Boolean(busy)} onClick={() => { change(id, { status: 'pending', error: '' }); setNotice('Retry queued. Click Generate / resume dry-run previews.') }}>Retry preview</button>}
          {e.status === 'write_failed' && <button className="btn-secondary text-sm" disabled={Boolean(busy)} onClick={() => change(id, { status: 'previewed', approved: false, error: '' })}>Return to review</button>}
          {v && <p className={`text-xs ${v.error || !v.hasCopy || v.overLimit ? 'text-red-700' : 'text-green-700'}`}>Live check: {v.error || `${v.chars} chars · ${v.hasCopy ? 'has copy' : 'EMPTY'} · ${v.overLimit ? 'OVER 300' : 'within limit'}`}</p>}
        </div>
      })}
    </div>
  </div>
}
