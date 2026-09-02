import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { loadSeoState, listSeoSnapshots, loadSeoSnapshot } from '../seoCache'
import { downloadCsv } from '../exportCsv'
import { GitCompare, AlertTriangle, Check, Download, ExternalLink } from 'lucide-react'

// SEO control plane — Step 4: reconciliation. Diff the current live state
// (SEO State page's cache) against a baseline — a history snapshot ("has
// anything drifted since T?") or an executed batch ("did our approved
// changes land and stay?"). Same shape as WooStockReconcile.jsx.

const fmtTs = (d) => (d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const fmtWhen = (d) => {
  if (!d) return ''
  const m = Math.round((Date.now() - d.getTime()) / 60000)
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
const key = (r) => `${r.kind}:${r.id}`

// Fields we compare row-to-row for snapshot drift.
const SNAP_FIELDS = ['status', 'slug', 'seo_title_set', 'seo_desc_set', 'elementor_hash']

export default function SeoReconcile() {
  const [current, setCurrent] = useState(null)   // { rows, fetchedAt }
  const [mode, setMode] = useState('snapshot')   // 'snapshot' | 'batch'
  const [snapshots, setSnapshots] = useState([])
  const [batches, setBatches] = useState([])
  const [baseId, setBaseId] = useState('')
  const [baseSnap, setBaseSnap] = useState(null) // { rows } for snapshot mode
  const [err, setErr] = useState('')
  const [onlyDrift, setOnlyDrift] = useState(true)

  useEffect(() => {
    loadSeoState().then(setCurrent).catch(() => setErr('Could not load current SEO state — read it on the SEO State page first.'))
    listSeoSnapshots().then(setSnapshots)
    const q = query(collection(db, 'seo_batches'), orderBy('created_at', 'desc'), limit(50))
    const unsub = onSnapshot(q, s => setBatches(
      s.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => ['executed', 'partial'].includes(b.status)),
    ), e => setErr(e.message))
    return unsub
  }, [])

  useEffect(() => {
    if (mode === 'snapshot' && baseId) loadSeoSnapshot(baseId).then(setBaseSnap)
    else setBaseSnap(null)
  }, [mode, baseId])

  const selBatch = useMemo(() => batches.find(b => b.id === baseId) || null, [batches, baseId])

  // ── snapshot drift ───────────────────────────────────────────────────────
  const snapModel = useMemo(() => {
    if (mode !== 'snapshot' || !current?.rows || !baseSnap?.rows) return null
    const cur = new Map(current.rows.map(r => [key(r), r]))
    const base = new Map(baseSnap.rows.map(r => [key(r), r]))
    const rows = []
    for (const k of new Set([...cur.keys(), ...base.keys()])) {
      const c = cur.get(k), b = base.get(k)
      if (c && b) {
        const diffs = SNAP_FIELDS.filter(f => JSON.stringify(c[f]) !== JSON.stringify(b[f]))
          .map(f => ({ field: f, from: b[f], to: c[f] }))
        rows.push({ k, state: diffs.length ? 'changed' : 'unchanged', row: c, diffs })
      } else if (c) rows.push({ k, state: 'new', row: c, diffs: [] })
      else rows.push({ k, state: 'gone', row: b, diffs: [] })
    }
    const counts = ['unchanged', 'changed', 'new', 'gone'].reduce((m, s) => (m[s] = rows.filter(r => r.state === s).length, m), {})
    return { rows, counts }
  }, [mode, current, baseSnap])

  // ── batch verification ──────────────────────────────────────────────────
  const batchModel = useMemo(() => {
    if (mode !== 'batch' || !current?.rows || !selBatch) return null
    const cur = new Map(current.rows.map(r => [key(r), r]))
    const items = (selBatch.items || []).filter(it => it.decision === 'approve')
    const rows = items.map(it => {
      const c = cur.get(`${it.kind}:${it.id}`)
      const after = it.result?.after || {}
      const notes = []
      if (it.result && !it.result.ok) notes.push({ field: 'execution', detail: it.result.error || 'write failed / drift at execution time' })
      if (!c) { notes.push({ field: 'lookup', detail: 'not found in current state (refresh SEO State?)' }) }
      else {
        if (after.slug != null && c.slug !== after.slug) notes.push({ field: 'slug', from: after.slug, to: c.slug, detail: 'changed since execution' })
        if (after.status != null && c.status !== after.status) notes.push({ field: 'status', from: after.status, to: c.status, detail: 'changed since execution' })
        // Only compare the layout hash when the current state actually has one
        // (products in the state cache don't carry _elementor_data).
        const afterEd = after['meta._elementor_data']
        if (afterEd != null && c.elementor_hash != null && c.elementor_hash !== afterEd) {
          notes.push({ field: 'layout', from: afterEd, to: c.elementor_hash, detail: '_elementor_data changed since execution' })
        }
        // Yoast intent — support both meta.<key> (posts/pages) and meta_data[] (products).
        const p = it.payload || {}
        const wrote = (k) => !!p.meta?.[k] || (Array.isArray(p.meta_data) && p.meta_data.some(m => m.key === k && m.value))
        if (wrote('_yoast_wpseo_title') && !c.seo_title_set) notes.push({ field: 'seo_title', detail: 'we wrote a Yoast title — it is no longer set' })
        if (wrote('_yoast_wpseo_metadesc') && !c.seo_desc_set) notes.push({ field: 'seo_desc', detail: 'we wrote a meta description — it is no longer set' })
      }
      return { it, c, state: notes.length ? (it.result && !it.result.ok ? 'failed' : 'drifted') : 'held', notes }
    })
    const counts = ['held', 'drifted', 'failed'].reduce((m, s) => (m[s] = rows.filter(r => r.state === s).length, m), {})
    return { rows, counts }
  }, [mode, current, selBatch])

  const model = mode === 'snapshot' ? snapModel : batchModel
  const visibleRows = useMemo(() => {
    if (!model) return []
    if (mode === 'snapshot') return onlyDrift ? model.rows.filter(r => r.state !== 'unchanged') : model.rows
    return onlyDrift ? model.rows.filter(r => r.state !== 'held') : model.rows
  }, [model, mode, onlyDrift])

  function exportCsv() {
    if (mode === 'snapshot' && snapModel) {
      downloadCsv('seo-drift', [
        { label: 'Key', value: r => r.k }, { label: 'State', value: r => r.state },
        { label: 'Title', value: r => r.row?.title || '' }, { label: 'Lang', value: r => r.row?.lang || '' },
        { label: 'Changes', value: r => r.diffs.map(d => `${d.field}: ${d.from} → ${d.to}`).join('; ') },
        { label: 'URL', value: r => r.row?.link || '' },
      ], snapModel.rows.filter(r => r.state !== 'unchanged'))
    } else if (batchModel) {
      downloadCsv('seo-batch-verify', [
        { label: 'ID', value: r => r.it.id }, { label: 'Kind', value: r => r.it.kind }, { label: 'Lang', value: r => r.it.lang },
        { label: 'State', value: r => r.state },
        { label: 'Notes', value: r => r.notes.map(n => `${n.field}: ${n.detail || `${n.from} → ${n.to}`}`).join('; ') },
      ], batchModel.rows.filter(r => r.state !== 'held'))
    }
  }

  const S = ({ label, value, tone }) => (
    <div className="card p-3">
      <div className={`text-lg font-semibold tabular-nums ${tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-700' : 'text-ink'}`}>{value}</div>
      <div className="text-2xs uppercase tracking-wide text-ink-60">{label}</div>
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl mb-1 inline-flex items-center gap-2">
        <GitCompare size={20} className="text-brand-500" /> SEO Reconcile
      </h1>
      <p className="text-sm text-ink-60 mb-4">
        Diff the current live state against a history snapshot (has anything drifted since?) or an executed
        batch (did our approved changes land and stay?). Only as fresh as the last <strong>SEO State</strong> read
        {current?.fetchedAt ? ` — ${fmtWhen(current.fetchedAt)}.` : ' — read it first.'}
      </p>

      {err && <div className="card p-3 mb-4 text-sm text-amber-700 bg-amber-50 inline-flex items-center gap-2"><AlertTriangle size={15} /> {err}</div>}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 bg-ivory-dark p-0.5">
          {['snapshot', 'batch'].map(m => (
            <button key={m} onClick={() => { setMode(m); setBaseId('') }}
              className={`text-sm px-3 py-1 ${mode === m ? 'bg-white shadow-sm text-ink' : 'text-ink-60'}`}>
              vs {m === 'snapshot' ? 'Snapshot' : 'Batch'}
            </button>
          ))}
        </div>
        <select className="input text-sm w-auto max-w-sm" value={baseId} onChange={e => setBaseId(e.target.value)}>
          <option value="">Choose a {mode === 'snapshot' ? 'snapshot' : 'batch'}…</option>
          {mode === 'snapshot'
            ? snapshots.map(s => <option key={s.id} value={s.id}>{fmtTs(s.takenAt)} · {s.rowCount} rows{s.note ? ` · ${s.note}` : ''}</option>)
            : batches.map(b => <option key={b.id} value={b.id}>{fmtTs(b.executed_at?.toDate?.() || b.created_at?.toDate?.())} · {b.status} · {b.note || `${b.item_count} items`}</option>)}
        </select>
        {model && <button onClick={exportCsv} className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1"><Download size={13} /> CSV</button>}
        {model && (
          <label className="text-xs text-ink-60 inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={onlyDrift} onChange={e => setOnlyDrift(e.target.checked)} className="w-3.5 h-3.5 rounded-sm border-warm-grey text-brand-600" />
            {mode === 'snapshot' ? 'Drift only' : 'Not held only'}
          </label>
        )}
      </div>

      {!model && <div className="card p-6 text-sm text-ink-60">Pick a baseline to compare against.</div>}

      {model && mode === 'snapshot' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <S label="Unchanged" value={snapModel.counts.unchanged} />
          <S label="Changed" value={snapModel.counts.changed} tone={snapModel.counts.changed ? 'amber' : undefined} />
          <S label="New" value={snapModel.counts.new} />
          <S label="Gone" value={snapModel.counts.gone} tone={snapModel.counts.gone ? 'red' : undefined} />
        </div>
      )}
      {model && mode === 'batch' && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <S label="Held" value={batchModel.counts.held} tone="green" />
          <S label="Drifted" value={batchModel.counts.drifted} tone={batchModel.counts.drifted ? 'amber' : undefined} />
          <S label="Failed" value={batchModel.counts.failed} tone={batchModel.counts.failed ? 'red' : undefined} />
        </div>
      )}

      {model && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-2xs uppercase tracking-wide text-ink-60 border-b border-ivory-dark">
                  <th className="px-3 py-2 text-left">{mode === 'snapshot' ? 'Content' : 'Item'}</th>
                  <th className="px-3 py-2 text-left">State</th>
                  <th className="px-3 py-2 text-left">What changed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-grey">
                {mode === 'snapshot' && visibleRows.map(r => (
                  <tr key={r.k} className={r.state === 'changed' ? 'bg-amber-50/40' : r.state === 'gone' ? 'bg-red-50/30' : 'hover:bg-ivory/40'}>
                    <td className="px-3 py-2 max-w-[280px]">
                      <span className="text-ink truncate inline-block max-w-full align-middle">{r.row?.title || r.k}</span>
                      {r.row?.link && <a href={r.row.link} target="_blank" rel="noreferrer" className="ml-1 text-platinum hover:text-brand-600 inline-block align-middle"><ExternalLink size={11} /></a>}
                      <span className="text-2xs text-ink-60 ml-1">{r.row?.kind} · {r.row?.lang}</span>
                    </td>
                    <td className="px-3 py-2"><span className={`text-2xs px-1.5 py-0.5 rounded-full ${r.state === 'changed' ? 'bg-amber-50 text-amber-700' : r.state === 'gone' ? 'bg-red-50 text-red-600' : r.state === 'new' ? 'bg-sky-50 text-sky-700' : 'bg-ivory text-ink-70'}`}>{r.state}</span></td>
                    <td className="px-3 py-2 text-xs text-ink-70">
                      {r.diffs.length
                        ? r.diffs.map((d, i) => <div key={i}><span className="font-mono text-2xs text-ink-60">{d.field}</span> <span className="text-platinum">{String(d.from)}</span> → <span className="text-ink">{String(d.to)}</span></div>)
                        : (r.state === 'gone' ? 'not in current state' : r.state === 'new' ? 'not in snapshot' : '—')}
                    </td>
                  </tr>
                ))}
                {mode === 'batch' && visibleRows.map(r => (
                  <tr key={`${r.it.kind}:${r.it.id}:${r.it.index}`} className={r.state === 'failed' ? 'bg-red-50/30' : r.state === 'drifted' ? 'bg-amber-50/40' : 'hover:bg-ivory/40'}>
                    <td className="px-3 py-2 max-w-[280px]">
                      <span className="text-ink truncate inline-block max-w-full align-middle">{r.it.summary || r.it.endpoint}</span>
                      <span className="text-2xs text-ink-60 ml-1">{r.it.kind} · {r.it.lang} · #{r.it.id}</span>
                    </td>
                    <td className="px-3 py-2"><span className={`text-2xs px-1.5 py-0.5 rounded-full ${r.state === 'held' ? 'bg-green-50 text-green-700' : r.state === 'failed' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>{r.state}</span></td>
                    <td className="px-3 py-2 text-xs text-ink-70">
                      {r.notes.length ? r.notes.map((n, i) => <div key={i}><span className="font-mono text-2xs text-ink-60">{n.field}</span> {n.detail || <><span className="text-platinum">{String(n.from)}</span> → <span className="text-ink">{String(n.to)}</span></>}</div>) : 'still matches what we wrote'}
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-4 text-center text-xs text-ink-60">{mode === 'snapshot' ? 'No drift.' : 'All approved items held.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
