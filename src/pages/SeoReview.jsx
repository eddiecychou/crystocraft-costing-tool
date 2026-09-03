import { useState, useEffect, useMemo } from 'react'
import { collection, doc, onSnapshot, query, orderBy, limit, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { ClipboardCheck, Check, X, AlertTriangle, CircleSlash, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

// SEO control plane — Step 2: the review queue. DSH posts a batch of intended
// WordPress writes (via /api/seo-batch); the human approves/rejects per item
// here against a real before→after diff; "Send to DSH" flips the batch to
// `approved` so DSH's poll picks it up and executes it. See
// docs/skills/SEO-CONTROL-PLANE.md.

const STATUS_BADGE = {
  pending_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-sky-50 text-sky-700',
  rejected: 'bg-ivory text-ink-70',
  executed: 'bg-green-50 text-green-700',
  partial: 'bg-red-50 text-red-600',
}
const fmtTs = (t) => {
  const d = t?.toDate?.() || (t instanceof Date ? t : null)
  return d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
}
const short = (v, n = 140) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s == null) return '—'
  return s.length > n ? `${s.slice(0, n)}… (${s.length})` : s
}

// Flatten a write payload to {key: value}, expanding a `meta` object one level.
function flatten(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === 'meta' && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [mk, mv] of Object.entries(v)) out[`meta.${mk}`] = mv
    } else out[k] = v
  }
  return out
}
function cell(key, val) {
  if (val == null || val === '') return <span className="text-platinum">—</span>
  if (/_elementor_data$/.test(key)) {
    const s = String(val)
    return <span className="font-mono text-2xs">len {s.length}</span>
  }
  return <span className="text-xs break-all whitespace-pre-wrap">{short(val)}</span>
}

export default function SeoReview() {
  const [batches, setBatches] = useState([])
  const [selId, setSelId] = useState(null)
  const [listOpen, setListOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'seo_batches'), orderBy('created_at', 'desc'), limit(50))
    return onSnapshot(q,
      snap => setBatches(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => setErr(e.message || 'Could not load batches.'))
  }, [])

  const sel = useMemo(() => batches.find(b => b.id === selId) || batches[0] || null, [batches, selId])
  const editable = sel?.status === 'pending_review'

  async function setItems(items, extra = {}) {
    if (!sel) return
    setBusy(true); setErr('')
    try { await updateDoc(doc(db, 'seo_batches', sel.id), { items, ...extra }) }
    catch (e) { setErr(e.message || 'Write failed.') }
    finally { setBusy(false) }
  }

  const decide = (index, decision) =>
    setItems(sel.items.map(it => (it.index === index ? { ...it, decision } : it)))

  const bulk = (decision, onlyPassing = false) =>
    setItems(sel.items.map(it =>
      (onlyPassing && it.validation?.passed !== true) ? it : { ...it, decision }))

  const sendToDsh = () => {
    const anyApproved = sel.items.some(it => it.decision === 'approve')
    setItems(sel.items, { status: anyApproved ? 'approved' : 'rejected' })
  }

  const counts = sel ? {
    approve: sel.items.filter(i => i.decision === 'approve').length,
    reject: sel.items.filter(i => i.decision === 'reject').length,
    pending: sel.items.filter(i => i.decision === 'pending').length,
    failed: sel.items.filter(i => i.validation?.passed === false).length,
  } : null

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl mb-1 inline-flex items-center gap-2">
        <ClipboardCheck size={20} className="text-brand-500" /> SEO Review Queue
      </h1>
      <p className="text-sm text-ink-60 mb-4">
        Change batches prepared by the DeepSeek Workbench. Approve or reject each item against its
        before → after diff, then <strong>Send to DSH</strong> to release the approved items for execution.
      </p>

      {err && (
        <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 inline-flex items-center gap-2">
          <AlertTriangle size={15} /> {err}
        </div>
      )}

      {batches.length === 0 ? (
        <div className="card p-6 text-sm text-ink-60">No batches yet. DSH posts them to <code className="font-mono text-xs">/api/seo-batch</code>.</div>
      ) : (
        <div className={`grid grid-cols-1 gap-4 ${listOpen ? 'lg:grid-cols-[240px_1fr]' : 'lg:grid-cols-1'}`}>
          {/* batch list */}
          <div className={`space-y-1.5 ${listOpen ? '' : 'hidden'}`}>
            <button onClick={() => setListOpen(false)}
              className="w-full inline-flex items-center justify-center gap-1.5 text-2xs text-ink-60 hover:text-ink py-1">
              <PanelLeftClose size={13} /> Hide list
            </button>
            {batches.map(b => (
              <button key={b.id} onClick={() => setSelId(b.id)}
                className={`w-full text-left card p-3 ${sel?.id === b.id ? 'border-brand-400' : 'hover:border-ink-60'} transition-colors`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-70 tabular-nums">{fmtTs(b.created_at)}</span>
                  <span className={`text-2xs px-1.5 py-0.5 rounded-full ${STATUS_BADGE[b.status] || 'bg-ivory text-ink-70'}`}>{b.status}</span>
                </div>
                <p className="text-xs text-ink-60 mt-1 truncate">{b.note || `${b.item_count} item${b.item_count === 1 ? '' : 's'}`}</p>
              </button>
            ))}
          </div>

          {/* selected batch */}
          {sel && (
            <div className="min-w-0">
              {!listOpen && (
                <button onClick={() => setListOpen(true)}
                  className="mb-3 inline-flex items-center gap-1.5 text-xs text-ink-60 hover:text-ink border border-ivory-dark hover:border-ink-60 px-2 py-1 transition-colors">
                  <PanelLeftOpen size={14} /> Show batches ({batches.length})
                </button>
              )}
              <div className="card p-3 mb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm text-ink">{sel.note || 'Untitled batch'}</p>
                    <p className="text-xs text-ink-60 mt-0.5">
                      {sel.item_count} items · {fmtTs(sel.created_at)}
                      {counts && <> · <span className="text-green-700">{counts.approve} approve</span> · <span className="text-ink-60">{counts.reject} reject</span> · {counts.pending} pending{counts.failed > 0 && <> · <span className="text-red-600">{counts.failed} failed validation</span></>}</>}
                    </p>
                  </div>
                  <span className={`text-2xs px-2 py-1 rounded-full ${STATUS_BADGE[sel.status] || 'bg-ivory text-ink-70'}`}>{sel.status}</span>
                </div>
                {editable && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button onClick={() => bulk('approve', true)} disabled={busy}
                      className="btn-secondary text-xs py-1 px-2.5">Approve all passing</button>
                    <button onClick={() => bulk('reject')} disabled={busy}
                      className="btn-secondary text-xs py-1 px-2.5">Reject all</button>
                    <button onClick={sendToDsh} disabled={busy || counts.pending > 0}
                      className="btn-primary text-xs py-1 px-2.5 disabled:opacity-50"
                      title={counts.pending > 0 ? 'Decide every item first' : ''}>
                      Send to DSH ({counts.approve} approved)
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {sel.items.map(it => {
                  const before = it.before || {}
                  const flat = flatten(it.payload || {})
                  const keys = Object.keys(flat)
                  const v = it.validation || {}
                  return (
                    <div key={it.index} className={`card p-3 ${it.decision === 'reject' ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-ink truncate">{it.summary || it.endpoint}</p>
                          <p className="text-2xs text-ink-60 mt-0.5 font-mono">
                            {it.endpoint}{it.kind ? ` · ${it.kind}` : ''}{it.lang ? ` · ${it.lang}` : ''}{it.id ? ` · #${it.id}` : ''}
                          </p>
                        </div>
                        {editable ? (
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => decide(it.index, 'approve')} disabled={busy}
                              className={`text-2xs px-2 py-1 rounded-none inline-flex items-center gap-1 ${it.decision === 'approve' ? 'bg-green-600 text-white' : 'bg-ivory-dark text-ink-70 hover:bg-green-50'}`}>
                              <Check size={11} /> Approve
                            </button>
                            <button onClick={() => decide(it.index, 'reject')} disabled={busy}
                              className={`text-2xs px-2 py-1 rounded-none inline-flex items-center gap-1 ${it.decision === 'reject' ? 'bg-ink text-white' : 'bg-ivory-dark text-ink-70 hover:bg-red-50'}`}>
                              <X size={11} /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className={`text-2xs px-2 py-1 rounded-full shrink-0 ${it.decision === 'approve' ? 'bg-green-50 text-green-700' : it.decision === 'reject' ? 'bg-ivory text-ink-70' : 'bg-amber-50 text-amber-700'}`}>{it.decision}</span>
                        )}
                      </div>

                      {/* validation */}
                      <div className="mt-2">
                        {v.passed === true && <p className="text-2xs text-green-700 inline-flex items-center gap-1"><Check size={11} /> validation passed{v.checks?.length ? ` (${v.checks.length} checks)` : ''}</p>}
                        {v.passed === false && <p className="text-2xs text-red-600 inline-flex items-center gap-1"><AlertTriangle size={11} /> validation FAILED: {(v.checks || []).filter(c => c.ok === false).map(c => c.name || c).join(', ') || 'see batch'}</p>}
                        {v.passed == null && <p className="text-2xs text-ink-60 inline-flex items-center gap-1"><CircleSlash size={11} /> not validated</p>}
                      </div>

                      {/* diff */}
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full table-fixed text-xs">
                          <colgroup>
                            <col className="w-28 sm:w-40" />
                            <col className="w-1/2" />
                            <col className="w-1/2" />
                          </colgroup>
                          <thead>
                            <tr className="text-2xs uppercase tracking-wide text-ink-60 border-b border-ivory-dark">
                              <th className="py-1 pr-3 text-left">Field</th>
                              <th className="py-1 pr-3 text-left">Before</th>
                              <th className="py-1 text-left">After</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-warm-grey">
                            {keys.map(k => {
                              const b = k.startsWith('meta.') ? (before.meta || {})[k.slice(5)] : before[k]
                              return (
                                <tr key={k}>
                                  <td className="py-1 pr-3 font-mono text-2xs text-ink-70 align-top break-all">{k}</td>
                                  <td className="py-1 pr-3 align-top break-all">{cell(k, b)}</td>
                                  <td className="py-1 align-top break-all">{cell(k, flat[k])}</td>
                                </tr>
                              )
                            })}
                            {keys.length === 0 && <tr><td colSpan={3} className="py-2 text-ink-60">(empty payload)</td></tr>}
                          </tbody>
                        </table>
                      </div>

                      {it.result && (
                        <p className={`mt-2 text-2xs ${it.result.ok ? 'text-green-700' : 'text-red-600'}`}>
                          {it.result.ok ? '✓ executed' : '✗ failed'}{it.result.verified ? ' · verified' : ''}{it.result.error ? ` — ${it.result.error}` : ''}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
