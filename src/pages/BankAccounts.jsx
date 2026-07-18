import { useEffect, useState } from 'react'
import { Banknote, Plus, AlertCircle, History, Star, X } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import {
  listBankAccounts, createBankAccount, updateBankAccount, bankAccountAudit,
} from '../bankAccounts'

// Crystocraft's own accounts for receiving customer payments. One default per
// currency (enforced by the database), so a document can pick the right account
// for its invoice currency instead of someone pasting one in.

const BLANK = {
  currency: '', label: '', bank_name: '', bank_address: '', beneficiary: '',
  account_no: '', swift: '', iban: '', intermediary: '', notes: '',
  is_default: false, active: true,
}

const FIELDS = [
  ['currency', 'Currency', 'e.g. USD', true],
  ['label', 'Label', 'e.g. Main USD', false],
  ['bank_name', 'Bank name', 'e.g. HSBC', true],
  ['beneficiary', 'Beneficiary', 'Account holder exactly as the bank has it', true],
  ['account_no', 'Account no.', '', false],
  ['swift', 'SWIFT / BIC', '8 or 11 characters', false],
  ['iban', 'IBAN', 'Checked against its checksum', false],
  ['intermediary', 'Intermediary bank', 'If the bank requires one', false],
  ['bank_address', 'Bank address', '', false],
  ['notes', 'Notes', '', false],
]

function AccountForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="border border-teal-200 rounded-xl bg-teal-50/30 p-5 space-y-4 mb-6">
      <h3 className="text-sm font-semibold text-gray-800">
        {initial.id ? 'Edit account' : 'Add bank account'}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map(([k, label, placeholder, required]) => (
          <div key={k} className={k === 'bank_address' || k === 'notes' ? 'sm:col-span-2' : ''}>
            <label className="block text-xs text-gray-500 mb-1">
              {label}{required && <span className="text-red-500"> *</span>}
            </label>
            <input
              value={form[k] || ''}
              onChange={(e) => set(k, e.target.value)}
              placeholder={placeholder}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-600 select-none">
          <input type="checkbox" checked={!!form.is_default} onChange={(e) => set('is_default', e.target.checked)}
                 className="rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
          Default for this currency
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600 select-none">
          <input type="checkbox" checked={!!form.active} onChange={(e) => set('active', e.target.checked)}
                 className="rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
          Active
        </label>
      </div>
      <p className="text-xs text-gray-500">
        Enter these once, from a bank document — not copied from an old invoice.
        Hong Kong account numbers have no checksum, so nothing can verify the digits for you.
      </p>
      <div className="flex gap-2">
        <button onClick={() => onSave(form)} disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </div>
  )
}

function AuditModal({ account, rows, loading, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">
            Change history — {account.currency} {account.label || account.bank_name}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="px-5 py-4">
          {loading && <p className="text-sm text-gray-400">Loading…</p>}
          {!loading && !rows.length && <p className="text-sm text-gray-400">No changes recorded.</p>}
          <ul className="space-y-3">
            {rows.map((r) => {
              // Show only what actually changed — a full jsonb dump is unreadable.
              const before = r.before || {}, after = r.after || {}
              const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
                .filter((k) => !['updated_at', 'created_at'].includes(k) && before[k] !== after[k])
              return (
                <li key={r.id} className="text-sm border-b border-gray-100 pb-2 last:border-0">
                  <div className="text-xs text-gray-500">
                    {String(r.changed_at).slice(0, 19).replace('T', ' ')} · {r.action}
                    {r.changed_by ? ` · ${r.changed_by}` : ''}
                  </div>
                  {keys.map((k) => (
                    <div key={k} className="text-xs mt-0.5">
                      <span className="text-gray-500">{k}: </span>
                      <span className="line-through text-red-600 font-mono">{String(before[k] ?? '—')}</span>
                      {' → '}
                      <span className="text-green-700 font-mono">{String(after[k] ?? '—')}</span>
                    </div>
                  ))}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default function BankAccounts() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)   // BLANK-shaped object | null
  const [saving, setSaving] = useState(false)
  const [audit, setAudit] = useState(null)       // { account, rows, loading }

  async function load() {
    setLoading(true); setError('')
    try { setRows(await listBankAccounts()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function save(form) {
    setSaving(true); setError('')
    try {
      const { id, ...data } = form
      if (id) await updateBankAccount(id, data)
      else await createBankAccount(data)
      setEditing(null)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function openAudit(account) {
    setAudit({ account, rows: [], loading: true })
    try {
      const r = await bankAccountAudit(account.id)
      setAudit({ account, rows: r, loading: false })
    } catch (e) {
      setError(e.message); setAudit(null)
    }
  }

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Banknote size={22} className="text-teal-600" /> Bank Accounts
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Our accounts for receiving customer payments. Documents pick the account matching
            the invoice currency — no more pasting.
          </p>
        </div>
        {!editing && (
          <button onClick={() => setEditing({ ...BLANK })}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-teal-600 text-white hover:bg-teal-700">
            <Plus size={15} /> Add account
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {editing && (
        <AccountForm initial={editing} onSave={save} onCancel={() => setEditing(null)} saving={saving} />
      )}

      <div className="space-y-3">
        {rows.map((a) => (
          <div key={a.id} className={`bg-white border rounded-lg px-4 py-3 ${a.active ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{a.currency}</span>
                  {a.label && <span className="text-sm text-gray-500">{a.label}</span>}
                  {a.is_default && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-teal-100 text-teal-700">
                      <Star size={11} /> Default
                    </span>
                  )}
                  {!a.active && <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">Inactive</span>}
                </div>
                <div className="text-sm text-gray-700 mt-1">{a.bank_name}</div>
                <div className="text-xs text-gray-500 font-mono mt-0.5 break-words">
                  {[a.beneficiary, a.account_no && `A/C ${a.account_no}`, a.iban && `IBAN ${a.iban}`,
                    a.swift && `SWIFT ${a.swift}`].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => openAudit(a)} title="Change history"
                        className="text-gray-400 hover:text-gray-600 p-1"><History size={16} /></button>
                <button onClick={() => setEditing(a)}
                        className="text-sm text-teal-600 hover:underline">Edit</button>
              </div>
            </div>
          </div>
        ))}
        {!loading && !rows.length && !editing && (
          <div className="bg-white border border-dashed border-gray-200 rounded-lg px-4 py-10 text-center text-gray-400 text-sm">
            No accounts yet. Add your HKD, USD, EUR and GBP receiving accounts.
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Every change is recorded (who, when, old → new). Supplier payment accounts are
        deliberately not stored here.
      </p>

      {audit && (
        <AuditModal account={audit.account} rows={audit.rows} loading={audit.loading}
                    onClose={() => setAudit(null)} />
      )}
    </div>
  )
}
