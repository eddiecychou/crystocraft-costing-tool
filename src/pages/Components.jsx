import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useComponents, bulkCreateComponents } from '../criticalComponents'
import { loadCrystalColors, saveCrystalColors } from '../crystalColors'
import { RANGE_COMPONENT_CATEGORIES } from '../constants'
import { Puzzle, ArrowUp, ArrowDown, X } from 'lucide-react'

export default function Components() {
  const [tab, setTab] = useState('critical')
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl font-semibold mb-1">Components</h1>
      <p className="text-sm text-ink-60 mb-4">
        Shared libraries for the Figurine range — the critical parts that drive the production
        promise, and the crystal colours used as a product attribute.
      </p>

      <div className="flex gap-1 border-b border-ivory-dark mb-5">
        {[['critical', 'Critical Components'], ['colours', 'Crystal Colours']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-60 hover:text-ink-80'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'critical' ? <CriticalComponents /> : <CrystalColours />}
    </div>
  )
}

// ── Critical Components tab ──────────────────────────────────────────────────

function CriticalComponents() {
  const { components, loading } = useComponents()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const [importing, setImporting] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return components.filter(c => {
      if (cat && c.category !== cat) return false
      if (!q) return true
      return [c.code, c.name, c.category, c.supplierName].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [components, search, cat])

  const cats = useMemo(() => {
    const used = new Set(components.map(c => c.category).filter(Boolean))
    return RANGE_COMPONENT_CATEGORIES.filter(c => used.has(c))
  }, [components])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input className="input text-sm flex-1 min-w-[180px]" placeholder="Search code, name, supplier…"
               value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input text-sm w-auto" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => setImporting(true)} className="btn-secondary text-sm">Import CSV</button>
        <Link to="/components/critical/new" className="btn-primary text-sm">+ New</Link>
      </div>

      <p className="text-xs text-ink-50 mb-2">
        {loading ? 'Loading…' : `${filtered.length} of ${components.length} component${components.length === 1 ? '' : 's'}`}
      </p>

      {!loading && components.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-60">
          No components yet. Add your long-lead / tooling parts, or <button onClick={() => setImporting(true)} className="text-brand-600 hover:underline">import from CSV</button>.
        </div>
      ) : (
        <div className="card divide-y divide-ivory-dark overflow-hidden">
          {filtered.map(c => (
            <Link key={c.id} to={`/components/critical/${c.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-ivory/50 transition-colors">
              <div className="w-11 h-11 shrink-0 bg-white border border-ivory-dark rounded flex items-center justify-center overflow-hidden">
                {c.images[0] ? <img src={c.images[0]} alt="" className="w-full h-full object-contain p-0.5" /> : <Puzzle size={18} className="text-gray-300" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-ink-90 truncate">{c.code}</span>
                  {c.category && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ivory text-ink-60 shrink-0">{c.category}</span>}
                </div>
                <p className="text-xs text-ink-60 truncate">{c.name || '—'}{c.supplierName ? ` · ${c.supplierName}` : ''}</p>
              </div>
              <div className="text-right shrink-0 tabular-nums">
                <p className="text-sm text-ink-90">{c.stock_qty ?? 0} <span className="text-ink-40 text-xs">pcs</span></p>
                <p className="text-[11px] text-ink-50">{c.lead_time_weeks != null ? `${c.lead_time_weeks} wk lead` : '—'}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  )
}

// Simple CSV importer — paste rows: code,name,category,stock,lead,notes
function ImportModal({ onClose }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const parsed = useMemo(() => parseCsv(text), [text])

  async function run() {
    setBusy(true)
    try {
      const n = await bulkCreateComponents(parsed)
      setResult(`Imported ${n} component${n === 1 ? '' : 's'}.`)
    } catch (e) { setResult('Error: ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-md shadow-lg w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold mb-1">Import components from CSV</h2>
        <p className="text-xs text-ink-60 mb-3">
          One row per component. Columns: <code className="text-ink-80">code, name, category, stock, lead_weeks, notes</code>.
          A header row is auto-detected and skipped. Paste straight from Excel (tabs or commas).
        </p>
        <textarea className="input min-h-[160px] font-mono text-xs" value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={'U0002-BODY,Owl body,Figurine Body,120,8,\nMB-18,18-note movement,Music Box,40,10,'} />
        <p className="text-xs text-ink-50 mt-1">{parsed.length} valid row{parsed.length === 1 ? '' : 's'} detected.</p>
        {result && <p className={`text-sm mt-2 ${result.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{result}</p>}
        <div className="flex items-center gap-3 mt-4">
          <button onClick={run} disabled={busy || !parsed.length} className="btn-primary text-sm">
            {busy ? 'Importing…' : `Import ${parsed.length || ''}`}
          </button>
          <button onClick={onClose} className="btn-secondary text-sm">{result ? 'Done' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  )
}

function parseCsv(text) {
  const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(/\t|,/).map(s => s.trim())
    const code = (cells[0] || '').toUpperCase()
    if (!code) continue
    if (i === 0 && /^(code|item)/i.test(code)) continue   // skip header row
    out.push({
      code, name: cells[1] || '', category: cells[2] || '',
      stock_qty: cells[3] || '', lead_time_weeks: cells[4] || '', notes: cells[5] || '',
    })
  }
  return out
}

// ── Crystal Colours tab ─────────────────────────────────────────────────────

function CrystalColours() {
  const [rows, setRows] = useState([])
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    loadCrystalColors().then(c => { setRows(c); setSaved(c); setLoading(false) })
  }, [])

  const update = (i, key, val) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const addRow = () => setRows(rs => [...rs, { code: '', name: '' }])
  const removeRow = i => setRows(rs => rs.filter((_, j) => j !== i))
  const move = (i, dir) => setRows(rs => {
    const j = i + dir
    if (j < 0 || j >= rs.length) return rs
    const out = [...rs]; [out[i], out[j]] = [out[j], out[i]]; return out
  })

  const dirty = JSON.stringify(rows) !== JSON.stringify(saved)

  async function handleSave() {
    setSaving(true); setMsg(null)
    try {
      const clean = await saveCrystalColors(rows)
      setRows(clean); setSaved(clean)
      setMsg(`Saved ${clean.length} colour${clean.length === 1 ? '' : 's'}.`)
      setTimeout(() => setMsg(null), 3000)
    } catch (e) { setMsg('Error saving: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-ink-80">Crystal Colour Library</h2>
        <button onClick={addRow} className="btn-secondary text-xs py-1.5 px-3">+ Add colour</button>
      </div>
      <p className="text-xs text-ink-50 mb-4">
        Selectable colour attribute on Figurine products. Colours don't create separate SKUs, stock,
        or price changes. For a colour that costs more, add a separate variation with its own price.
      </p>

      {loading ? (
        <p className="text-xs text-ink-50">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink-50">No colours yet — add one.</p>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-40 px-1">
            <span className="w-16 shrink-0">Code</span>
            <span className="flex-1">Name</span>
            <span className="w-16 shrink-0" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input text-xs font-mono uppercase w-16 shrink-0" value={r.code}
                     placeholder="BL" maxLength={6}
                     onChange={e => update(i, 'code', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
              <input className="input text-xs flex-1 min-w-0" value={r.name}
                     placeholder="Sapphire" onChange={e => update(i, 'name', e.target.value)} />
              <div className="flex items-center gap-0.5 w-16 shrink-0 justify-end">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                        className="text-ink-40 hover:text-ink-70 disabled:opacity-30 px-1" title="Move up"><ArrowUp size={14} /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                        className="text-ink-40 hover:text-ink-70 disabled:opacity-30 px-1" title="Move down"><ArrowDown size={14} /></button>
                <button type="button" onClick={() => removeRow(i)}
                        className="text-red-400 hover:text-red-600 px-1 leading-none" title="Remove"><X size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <button onClick={handleSave} disabled={saving || !dirty} className="btn-primary text-sm">
          {saving ? 'Saving…' : 'Save Colours'}
        </button>
        {dirty && <span className="text-xs text-amber-500">unsaved changes</span>}
        {msg && <p className={`text-xs ${msg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>}
      </div>
    </div>
  )
}
