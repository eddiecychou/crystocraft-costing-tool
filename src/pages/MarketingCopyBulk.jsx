import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useRole } from '../access'
import { applyApproved, delay, generatePreview, loadJob, readTarget, saveJob, verifyTargets, watchReviewProducts } from '../marketingRegeneration'
import { hasValidCopy, MAX_COPY_CHARS, previewIsStale, REVIEW_LABELS, reviewState } from '../marketingCopyReview'

export default function MarketingCopyBulk({ embedded = false }) {
  const role = useRole()
  const [job, setJob] = useState(loadJob)
  const jobRef = useRef(job)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState('')
  const [activeId, setActiveId] = useState('')
  const [filter, setFilter] = useState('all')
  const [notice, setNotice] = useState('')
  const stopRef = useRef(false)
  useEffect(() => {
    if (role !== 'admin') return
    stopRef.current = false
    const unsubscribe = watchReviewProducts(rows => {
      setProducts(rows)
      setLoading(false)
      setLoadError('')
    }, error => { setLoadError(error.message); setLoading(false) })
    return () => { stopRef.current = true; unsubscribe() }
  }, [role])

  if (role !== 'admin') return <Navigate to="/products" replace />

  function change(id, patch) {
    const next = { ...jobRef.current, entries: { ...jobRef.current.entries, [id]: { ...jobRef.current.entries[id], ...patch } } }
    jobRef.current = next
    setJob(next)
    try { saveJob(next) } catch { setNotice('Browser storage is full; keep this tab open and export the report before leaving.') }
  }
  function updateProduct(product) {
    setProducts(rows => rows.map(row => row.id === product.id ? product : row))
  }
  async function makePreview(id) {
    const product = await readTarget(id)
    updateProduct(product)
    const before = product.marketing_description || ''
    const guidance = jobRef.current.entries[id]?.guidance?.trim() || ''
    const after = await generatePreview(product, guidance)
    change(id, { name: product.name || id, before, after, previousChars: before.length, newChars: after.length, approved: false, status: 'previewed', error: '', instructionsApplied: guidance, previewId: crypto.randomUUID(), landed: false })
  }
  async function preview() {
    setBusy('preview')
    setNotice('')
    stopRef.current = false
    try {
      // Fresh server scan includes products added since the page opened.
      const current = await verifyTargets()
      setProducts(current)
      for (const product of current) {
        if (stopRef.current) break
        const entry = jobRef.current.entries[product.id] || {}
        if (hasValidCopy(product.marketing_description) || ['previewed', 'write_failed'].includes(entry.status)) continue
        setActiveId(product.id)
        try { await makePreview(product.id) } catch (error) {
          change(product.id, { status: 'preview_failed', approved: false, error: error.message || String(error) })
        }
        if (!stopRef.current) await delay(800)
      }
    } catch (error) { setLoadError(error.message) }
    finally { setActiveId(''); setBusy('') }
  }
  async function rewriteOne(id) {
    setBusy('rewrite')
    setActiveId(id)
    setNotice('')
    try { await makePreview(id) } catch (error) {
      change(id, { approved: false, error: `Preview failed: ${error.message || String(error)}. Existing copy and preview were not changed.` })
    } finally { setActiveId(''); setBusy('') }
  }
  async function apply() {
    setBusy('apply')
    setNotice('')
    stopRef.current = false
    try {
      for (const product of products) {
        if (stopRef.current) break
        const entry = jobRef.current.entries[product.id]
        if (reviewState(product, entry) !== 'approved') continue
        setActiveId(product.id)
        try {
          const chars = await applyApproved(product.id, entry, jobRef.current.runId)
          updateProduct({ ...product, marketing_description: entry.after })
          change(product.id, { status: 'written', approved: false, landed: true, newChars: chars, error: '' })
        } catch (error) {
          change(product.id, { status: 'write_failed', approved: false, landed: false, error: error.message || String(error) })
        }
        if (!stopRef.current) await delay(800)
      }
      if (!stopRef.current) setProducts(await verifyTargets())
    } catch (error) { setLoadError(error.message) }
    finally { setActiveId(''); setBusy('') }
  }
  async function verify() {
    setBusy('verify')
    try { setProducts(await verifyTargets()); setLoadError(''); setNotice('Current catalogue re-read from server.') }
    catch (error) { setLoadError(error.message) }
    finally { setBusy('') }
  }
  const rows = products.map(product => {
    const entry = job.entries[product.id] || {}
    return { product, entry, state: reviewState(product, entry) }
  }).sort((a, b) => (a.product.name || a.product.id).localeCompare(b.product.name || b.product.id))
  const counts = Object.fromEntries(Object.keys(REVIEW_LABELS).map(key => [key, rows.filter(row => row.state === key).length]))
  const approved = rows.filter(({ product, entry, state }) => state === 'approved' && !previewIsStale(product, entry) && (entry.guidance || '').trim() === (entry.instructionsApplied || '')).length
  const missing = products.filter(p => !hasValidCopy(p.marketing_description)).length
  function downloadReport() {
    const results = rows.map(({ product, entry, state }) => ({ id: product.id, name: product.name, review_state: REVIEW_LABELS[state], status: entry.status || 'pending', previous_chars: entry.previousChars, new_chars: entry.newChars, write_landed: entry.landed === true, current_chars: (product.marketing_description || '').length, current_compliant: hasValidCopy(product.marketing_description), preview_stale: previewIsStale(product, entry), error: entry.error || '' }))
    const url = URL.createObjectURL(new Blob([JSON.stringify({ runId: job.runId, results }, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `marketing-copy-${job.runId}.json`; a.click(); URL.revokeObjectURL(url)
  }
  return <div className="p-6 max-w-6xl mx-auto space-y-5">
    <div>
      {!embedded && <Link to="/settings?tab=products&sub=marketing-copy" className="text-sm text-brand-600">← Settings · Products</Link>}
      <h1 className="text-2xl text-ink mt-2 break-words">Bulk marketing copy review</h1>
      <p className="text-sm text-ink-60">All {products.length} current Corp Gift products, including every status. New products appear automatically.</p>
      <p className="text-sm text-ink-60">Generate previews for empty or over-{MAX_COPY_CHARS}-character copy. Already compliant means non-empty and within the length limit; it does not certify content accuracy. Every replacement requires individual approval.</p>
    </div>
    <div className="card p-4 space-y-3">
      {loading && <p role="status">Loading current catalogue…</p>}
      {loadError && <p role="alert" className="text-red-700">Catalogue could not be refreshed: {loadError}. Review is paused until a successful refresh.</p>}
      <p className="text-sm">{products.length} products · {counts.awaiting} awaiting approval · {counts.approved} approved · {counts.compliant} already compliant · {counts.written} saved · {counts.failed} failed · {counts.pending} need copy</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary text-sm whitespace-normal" disabled={Boolean(busy) || loading || Boolean(loadError)} onClick={preview}>Generate missing / over-limit previews</button>
        <button className="btn-primary text-sm whitespace-normal" disabled={Boolean(busy) || loading || Boolean(loadError) || approved === 0} onClick={apply}>Save {approved} approved</button>
        <button className="btn-secondary text-sm whitespace-normal" disabled={Boolean(busy)} onClick={verify}>Refresh all products</button>
        <button className="btn-secondary text-sm whitespace-normal" onClick={downloadReport}>Download report</button>
        {busy && <button className="btn-secondary text-sm whitespace-normal" onClick={() => { stopRef.current = true }}>Stop after current item</button>}
      </div>
      {activeId && <p role="status" className="text-sm">{busy === 'apply' ? 'Saving' : 'Generating preview'}: {activeId}</p>}
      <p className="text-xs text-ink-60">Previews never write. Progress is saved in this browser. Saving backs up the previous text atomically in product_marketing_history. Keep this tab open during a run.</p>
      {!loading && !loadError && <p className="text-sm" role="status">{missing ? `${missing} products still have empty or over-limit saved copy.` : 'All current products have saved copy within the length limit.'} Pending approvals and failures are listed separately below.</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </div>
    <div className="flex flex-wrap gap-2" aria-label="Review filters">
      {Object.entries({ all: 'All products', ...REVIEW_LABELS }).map(([key, label]) => <button key={key} className="btn-secondary text-sm whitespace-normal" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label} ({key === 'all' ? rows.length : counts[key]})</button>)}
    </div>
    <div className="space-y-3">
      {rows.filter(row => filter === 'all' || row.state === filter).map(({ product, entry: e, state }) => {
        const id = product.id
        const stale = previewIsStale(product, e)
        const instructionsChanged = (e.guidance || '').trim() !== (e.instructionsApplied || '')
        const blocked = Boolean(busy) || Boolean(loadError) || loading
        return <div key={id} className="card p-4 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 break-words"><p className="text-sm font-medium">{product.name || id}</p><p className="text-xs text-ink-60">{id}</p></div>
            <span className={`text-sm ${state === 'failed' ? 'text-red-700' : 'text-ink-60'}`}>{REVIEW_LABELS[state]}</span>
          </div>
          <p className="text-xs">Saved copy: {(product.marketing_description || '').length} characters · {hasValidCopy(product.marketing_description) ? 'within limit' : product.marketing_description?.trim() ? 'OVER 300' : 'EMPTY'}</p>
          {e.status === 'written' && state === 'written' && <p className="text-sm text-green-700">Write landed; backup saved. {e.previousChars} → {e.newChars} characters.</p>}
          {e.status === 'previewed' ? <>
            <div className="grid md:grid-cols-2 gap-3 text-sm break-words">
              <div><p className="label">Before</p><p className="whitespace-pre-wrap bg-ivory-dark p-3">{e.before || '(empty)'}</p></div>
              <div><p className="label">After · {e.after?.length || 0} characters</p><p className="whitespace-pre-wrap bg-ivory-dark p-3">{e.after}</p></div>
            </div>
            {stale && <p className="text-sm text-red-700">Saved copy changed since this preview. Generate a fresh preview before approving.</p>}
            {instructionsChanged && <p className="text-sm text-amber-700">Instructions changed. Regenerate before approving.</p>}
            <label className="inline-flex items-center gap-2 min-h-[40px] text-sm"><input type="checkbox" checked={Boolean(e.approved) && !stale && !instructionsChanged} disabled={blocked || stale || instructionsChanged || Boolean(e.error)} onChange={event => change(id, { approved: event.target.checked })} />Approve replacement</label>
          </> : <p className="text-sm whitespace-pre-wrap break-words">{product.marketing_description || '(No saved copy)'}</p>}
          <div className="space-y-1">
            <label htmlFor={`guidance-${id}`} className="label">AI rewrite instructions (optional)</label>
            <textarea id={`guidance-${id}`} className="input" rows={2} value={e.guidance || ''} disabled={blocked} placeholder="E.g. Do not mention specific colours; colour is customisable." onChange={event => change(id, { guidance: event.target.value, approved: false })} />
            <button className="btn-secondary text-sm whitespace-normal" disabled={blocked} onClick={() => rewriteOne(id)}>{state === 'failed' ? 'Retry preview' : e.after ? 'Regenerate preview' : 'Generate preview'}</button>
          </div>
          {e.error && <p role="alert" className="text-sm text-red-700">{e.error}</p>}
          {e.status === 'write_failed' && <button className="btn-secondary text-sm whitespace-normal" disabled={blocked} onClick={() => change(id, { status: 'previewed', approved: false, error: '' })}>Return to review before retrying save</button>}
        </div>
      })}
      {!loading && !loadError && !rows.some(row => filter === 'all' || row.state === filter) && <p className="text-sm">No products in this review group. <button className="text-brand-700 underline" onClick={() => setFilter('all')}>View all products</button></p>}
    </div>
  </div>
}
