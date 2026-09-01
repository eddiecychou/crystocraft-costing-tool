import { useState, useEffect } from 'react'
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { Gem, Package, Mail, Download, Pencil, Trash2, X } from 'lucide-react'
import { fmtMoney } from '../currency'
import { exportEnquiryExcel } from '../enquiryExport'
import LoadingBar from '../components/LoadingBar'
import ConfirmDialog from '../components/ConfirmDialog'

const STATUS = {
  new:      { label: 'New',      cls: 'bg-amber-100 text-amber-700' },
  handled:  { label: 'Handled',  cls: 'bg-emerald-100 text-emerald-700' },
  archived: { label: 'Archived', cls: 'bg-gray-100 text-gray-500' },
}

export default function Enquiries({ embedded = false }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('new')
  const [editing, setEditing] = useState(null)     // enquiry being edited
  const [confirmDel, setConfirmDel] = useState(null) // enquiry to delete

  useEffect(() => {
    const q = query(collection(db, 'enquiries'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  const set = (id, status) => updateDoc(doc(db, 'enquiries', id), { status, updatedAt: serverTimestamp() })

  async function remove(id) {
    await deleteDoc(doc(db, 'enquiries', id))
    setConfirmDel(null)
  }

  const counts = {
    new: rows.filter(r => (r.status || 'new') === 'new').length,
    handled: rows.filter(r => r.status === 'handled').length,
    archived: rows.filter(r => r.status === 'archived').length,
  }
  const filtered = rows.filter(r => (r.status || 'new') === tab)

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      {!embedded && <h1 className="text-xl md:text-2xl mb-1">Enquiries</h1>}
      <p className="text-sm text-ink-60 mb-4">Customer requests for quotation from the wholesale catalogue.</p>

      <div className="inline-flex rounded-lg border border-ivory-dark overflow-hidden mb-5">
        {['new', 'handled', 'archived'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm border-l first:border-l-0 border-ivory-dark transition-colors capitalize
              ${tab === t ? 'bg-ink text-white' : 'bg-white text-ink-70 hover:bg-ivory'}`}>
            {t} <span className="opacity-60">{counts[t]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-ink-60">No {tab} enquiries.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <Card key={r.id} r={r} set={set} onEdit={() => setEditing(r)} onDelete={() => setConfirmDel(r)} />
          ))}
        </div>
      )}

      {editing && <EditModal r={editing} onClose={() => setEditing(null)} />}

      {confirmDel && (
        <ConfirmDialog
          message={`Delete the enquiry from ${confirmDel.company_name || confirmDel.email || 'this customer'}? This cannot be undone.`}
          onConfirm={() => remove(confirmDel.id)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

function Card({ r, set, onEdit, onDelete }) {
  const when = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : ''
  const st = STATUS[r.status || 'new']
  const cur = r.currency || r.base_currency || 'USD'
  const [exporting, setExporting] = useState(false)
  async function handleExport() {
    setExporting(true)
    try { await exportEnquiryExcel(r) }
    catch (e) { console.error('[Enquiries] Excel export failed:', e); alert(`Export failed: ${e.message}`) }
    finally { setExporting(false) }
  }
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-medium text-ink">{r.company_name || r.email || 'Unknown'}</p>
          <p className="text-xs text-ink-60">
            {r.contact_name ? `${r.contact_name} · ` : ''}
            <a href={`mailto:${r.email}`} className="text-brand-600 hover:underline inline-flex items-center gap-1">
              <Mail size={12} /> {r.email}
            </a>
            {r.base_currency ? ` · ${r.base_currency}` : ''}
          </p>
          {when && <p className="text-[11px] text-ink-60 mt-0.5">{when}</p>}
        </div>
        <span className={`badge ${st?.cls || ''}`}>{st?.label || r.status}</span>
      </div>

      {r.message && <p className="text-sm text-ink-70 mt-3 whitespace-pre-wrap bg-ivory rounded p-2">{r.message}</p>}

      <div className="mt-3 divide-y divide-ivory-dark border-y border-ivory-dark">
        {(r.items || []).map((i, idx) => {
          const Icon = i.type === 'figurine' ? Gem : Package
          return (
            <div key={idx} className="flex items-center gap-3 py-2">
              <div className="w-10 h-10 bg-white border border-ivory-dark rounded flex items-center justify-center overflow-hidden shrink-0">
                {i.image ? <img src={i.image} alt={i.name} className="w-full h-full object-contain" /> : <Icon size={16} className="text-gray-300" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate">{i.name}</p>
                <p className="text-[11px] text-ink-60">
                  {i.code ? `${i.code} · ` : ''}{i.type}
                  {i.finish ? ` · ${i.finish}` : ''}
                  {(i.color_name || i.color) ? ` · ${i.color_name || i.color}` : ''}
                  {i.note ? ` · ${i.note}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm text-ink-70">
                  {Number(i.qty || 1).toLocaleString()} pcs
                  {Number(i.pcs_per_carton) > 0 && Number(i.cartons) > 0 && <span className="text-ink-60"> · {i.cartons} ctn</span>}
                </p>
                {Number(i.moq) > 0 && Number(i.qty || 1) < Number(i.moq) &&
                  <p className="text-[10px] text-amber-700">below MOQ {Number(i.moq).toLocaleString()}</p>}
                {i.line_total != null
                  ? <p className="text-sm text-ink font-medium">{fmtMoney(i.line_total, cur)}</p>
                  : <p className="text-[11px] text-ink-60 italic">On enquiry</p>}
              </div>
            </div>
          )
        })}
      </div>

      {r.estimated_total != null && (
        <div className="mt-2 flex items-center justify-end gap-3 text-sm">
          <span className="text-ink-60">Estimated total ({cur})</span>
          <span className="font-medium text-ink">{fmtMoney(r.estimated_total, cur)}</span>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {(r.status || 'new') !== 'handled' && (
          <button onClick={() => set(r.id, 'handled')} className="btn-secondary text-sm">Mark handled</button>
        )}
        {(r.status || 'new') !== 'archived' && (
          <button onClick={() => set(r.id, 'archived')} className="text-xs text-ink-60 hover:text-ink">Archive</button>
        )}
        {(r.status || 'new') !== 'new' && (
          <button onClick={() => set(r.id, 'new')} className="text-xs text-ink-60 hover:text-ink">Reopen</button>
        )}
        <span className="flex-1" />
        <button onClick={handleExport} disabled={exporting} className="text-xs text-ink-60 hover:text-brand-600 inline-flex items-center gap-1 disabled:opacity-50">
          <Download size={13} /> {exporting ? 'Exporting…' : 'Export Excel'}
        </button>
        <button onClick={onEdit} className="text-xs text-ink-60 hover:text-brand-600 inline-flex items-center gap-1">
          <Pencil size={13} /> Edit
        </button>
        <button onClick={onDelete} className="text-xs text-ink-60 hover:text-red-600 inline-flex items-center gap-1">
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </div>
  )
}

// ── Edit modal ───────────────────────────────────────────────────────────────
// Lets admin adjust quantities, drop line items, edit the message and status.
// Line totals scale with quantity from the original per-unit price; the
// estimated total is recomputed from the kept items.
function EditModal({ r, onClose }) {
  const cur = r.currency || r.base_currency || 'USD'
  const [items, setItems] = useState(() =>
    (r.items || []).map(i => {
      const qty = Number(i.qty || 1)
      const unit = i.line_total != null && qty ? Number(i.line_total) / qty : null
      return { ...i, qty, _unit: unit }
    })
  )
  const [message, setMessage] = useState(r.message || '')
  const [status, setStatus] = useState(r.status || 'new')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const priced = items.map(i => ({
    ...i,
    line_total: i._unit != null ? Math.round(i._unit * Number(i.qty || 0) * 100) / 100 : i.line_total ?? null,
  }))
  const estimated = priced.some(i => i.line_total != null)
    ? priced.reduce((s, i) => s + (Number(i.line_total) || 0), 0)
    : null

  function setQty(idx, val) {
    const q = Math.max(0, Math.round(Number(val) || 0))
    setItems(arr => arr.map((it, j) => (j === idx ? { ...it, qty: q } : it)))
  }
  function removeItem(idx) {
    setItems(arr => arr.filter((_, j) => j !== idx))
  }

  async function save() {
    setSaving(true); setErr(null)
    try {
      const out = priced.map(({ _unit, ...rest }) => rest)
      await updateDoc(doc(db, 'enquiries', r.id), {
        items: out,
        estimated_total: estimated,
        message: message.trim() || null,
        status,
        updatedAt: serverTimestamp(),
      })
      onClose()
    } catch (e) {
      setErr(e?.message || 'Could not save')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg w-full max-w-xl max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-ivory-dark sticky top-0 bg-white">
          <h2 className="text-base font-semibold">Edit enquiry</h2>
          <button onClick={onClose} className="text-ink-60 hover:text-ink"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="font-medium text-ink">{r.company_name || r.email || 'Unknown'}</p>
            <p className="text-xs text-ink-60">{r.contact_name ? `${r.contact_name} · ` : ''}{r.email}</p>
          </div>

          <div className="space-y-2">
            {items.length === 0 && <p className="text-sm text-ink-60">No items left.</p>}
            {items.map((i, idx) => (
              <div key={idx} className="flex items-center gap-3 border border-ivory-dark rounded p-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">{i.name}</p>
                  <p className="text-[11px] text-ink-60">
                    {i.code ? `${i.code} · ` : ''}{i.type}
                    {i.finish ? ` · ${i.finish}` : ''}
                    {(i.color_name || i.color) ? ` · ${i.color_name || i.color}` : ''}
                  </p>
                </div>
                <input type="number" min="0" className="input py-1 w-24 text-right" value={i.qty}
                  onChange={e => setQty(idx, e.target.value)} />
                <span className="text-xs text-ink-60 w-8">pcs</span>
                <div className="w-24 text-right text-sm text-ink">
                  {priced[idx].line_total != null ? fmtMoney(priced[idx].line_total, cur) : '—'}
                </div>
                <button onClick={() => removeItem(idx)} className="text-ink-60 hover:text-red-600"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>

          {estimated != null && (
            <div className="flex items-center justify-end gap-3 text-sm">
              <span className="text-ink-60">Estimated total ({cur})</span>
              <span className="font-medium text-ink">{fmtMoney(estimated, cur)}</span>
            </div>
          )}

          <div>
            <label className="label">Message</label>
            <textarea className="input" rows={3} value={message} onChange={e => setMessage(e.target.value)} />
          </div>

          <div>
            <label className="label">Status</label>
            <select className="input w-40" value={status} onChange={e => setStatus(e.target.value)}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-ivory-dark sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
