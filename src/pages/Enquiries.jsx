import { useState, useEffect } from 'react'
import { collection, query, orderBy, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { Gem, Package, Mail } from 'lucide-react'
import { fmtMoney } from '../currency'
import LoadingBar from '../components/LoadingBar'

const STATUS = {
  new:      { label: 'New',      cls: 'bg-amber-100 text-amber-700' },
  handled:  { label: 'Handled',  cls: 'bg-emerald-100 text-emerald-700' },
  archived: { label: 'Archived', cls: 'bg-gray-100 text-gray-500' },
}

export default function Enquiries() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('new')

  useEffect(() => {
    const q = query(collection(db, 'enquiries'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  const set = (id, status) => updateDoc(doc(db, 'enquiries', id), { status, updatedAt: serverTimestamp() })

  const counts = {
    new: rows.filter(r => (r.status || 'new') === 'new').length,
    handled: rows.filter(r => r.status === 'handled').length,
    archived: rows.filter(r => r.status === 'archived').length,
  }
  const filtered = rows.filter(r => (r.status || 'new') === tab)

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      <h1 className="text-xl md:text-2xl mb-1">Enquiries</h1>
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
          {filtered.map(r => <Card key={r.id} r={r} set={set} />)}
        </div>
      )}
    </div>
  )
}

function Card({ r, set }) {
  const when = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : ''
  const st = STATUS[r.status || 'new']
  const cur = r.currency || r.base_currency || 'USD'
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
          {when && <p className="text-[11px] text-ink-40 mt-0.5">{when}</p>}
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
                <p className="text-[11px] text-ink-50">
                  {i.code ? `${i.code} · ` : ''}{i.type}
                  {i.finish ? ` · ${i.finish}` : ''}
                  {(i.color_name || i.color) ? ` · ${i.color_name || i.color}` : ''}
                  {i.note ? ` · ${i.note}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm text-ink-70">
                  {Number(i.qty || 1).toLocaleString()} pcs
                  {Number(i.pcs_per_carton) > 0 && Number(i.cartons) > 0 && <span className="text-ink-40"> · {i.cartons} ctn</span>}
                </p>
                {Number(i.moq) > 0 && Number(i.qty || 1) < Number(i.moq) &&
                  <p className="text-[10px] text-amber-700">below MOQ {Number(i.moq).toLocaleString()}</p>}
                {i.line_total != null
                  ? <p className="text-sm text-ink font-medium">{fmtMoney(i.line_total, cur)}</p>
                  : <p className="text-[11px] text-ink-40 italic">On enquiry</p>}
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

      <div className="mt-3 flex items-center gap-2">
        {(r.status || 'new') !== 'handled' && (
          <button onClick={() => set(r.id, 'handled')} className="btn-secondary text-sm">Mark handled</button>
        )}
        {(r.status || 'new') !== 'archived' && (
          <button onClick={() => set(r.id, 'archived')} className="text-xs text-ink-50 hover:text-ink">Archive</button>
        )}
        {(r.status || 'new') !== 'new' && (
          <button onClick={() => set(r.id, 'new')} className="text-xs text-ink-50 hover:text-ink">Reopen</button>
        )}
      </div>
    </div>
  )
}
