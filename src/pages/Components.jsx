import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useComponents, bulkCreateComponents, saveComponent } from '../criticalComponents'
import { loadCrystalColors, saveCrystalColors } from '../crystalColors'
import { RANGE_COMPONENT_CATEGORIES, RANGE_FORMAT_CODES } from '../constants'
import { Puzzle, ArrowUp, ArrowDown, X, Minus, Plus, Check } from 'lucide-react'

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
        {[['critical', 'Critical Components'], ['colours', 'Crystal Colours'], ['formatmoq', 'Format MOQs'], ['pricegroups', 'Pricing Groups']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-60 hover:text-ink-80'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'critical' ? <CriticalComponents /> : tab === 'colours' ? <CrystalColours /> : tab === 'formatmoq' ? <FormatMoqs /> : <PricingGroups />}
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
            <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-ivory/50 transition-colors">
              <Link to={`/components/critical/${c.id}`} className="flex items-center gap-3 min-w-0 flex-1">
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
              </Link>
              <StockEditor component={c} />
            </div>
          ))}
        </div>
      )}

      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  )
}

// Inline stock editor — type a new qty (or use −/+) and it auto-saves on blur,
// so stock can be reconciled straight from the list without opening each part.
function StockEditor({ component: c }) {
  const current = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
  const [val, setVal]       = useState(String(current))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  // Re-sync when the live snapshot changes (e.g. edited elsewhere).
  useEffect(() => { setVal(String(Number.isFinite(c.stock_qty) ? c.stock_qty : 0)) }, [c.stock_qty])

  async function commit(next) {
    const n = Math.max(0, Math.round(Number(next)))
    const safe = Number.isFinite(n) ? n : 0
    setVal(String(safe))
    if (safe === current) return
    setSaving(true)
    try {
      await saveComponent(c.id, { ...c, stock_qty: safe })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  function step(delta) {
    const next = Math.max(0, (Math.round(Number(val)) || 0) + delta)
    commit(next)
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => step(-1)} title="−1"
                className="w-6 h-6 rounded border border-ivory-dark text-ink-50 hover:bg-ivory flex items-center justify-center"><Minus size={13} /></button>
        <input
          type="number" inputMode="numeric" min="0"
          className="input text-sm text-right tabular-nums w-16 px-2 py-1"
          value={val}
          onChange={e => setVal(e.target.value)}
          onFocus={e => e.target.select()}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.target.blur()
            if (e.key === 'Escape') { setVal(String(current)); e.target.blur() }
          }}
        />
        <button type="button" onClick={() => step(1)} title="+1"
                className="w-6 h-6 rounded border border-ivory-dark text-ink-50 hover:bg-ivory flex items-center justify-center"><Plus size={13} /></button>
      </div>
      <div className="w-12 text-right leading-tight">
        <p className="text-[10px] text-ink-40">pcs</p>
        {saving
          ? <p className="text-[10px] text-ink-40">saving…</p>
          : saved
            ? <p className="inline-flex items-center gap-0.5 text-[10px] text-green-600"><Check size={11} />saved</p>
            : <p className="text-[10px] text-ink-50">{c.lead_time_weeks != null ? `${c.lead_time_weeks}wk lead` : '—'}</p>}
      </div>
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
  const addRow = () => setRows(rs => [...rs, { code: '', name: '', swatch: '' }])
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
            <span className="w-14 shrink-0">Swatch</span>
            <span className="w-16 shrink-0" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input text-xs font-mono uppercase w-16 shrink-0" value={r.code}
                     placeholder="BL" maxLength={6}
                     onChange={e => update(i, 'code', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
              <input className="input text-xs flex-1 min-w-0" value={r.name}
                     placeholder="Sapphire" onChange={e => update(i, 'name', e.target.value)} />
              <div className="w-14 shrink-0 flex items-center gap-1">
                <input type="color" className="h-7 w-7 rounded cursor-pointer border border-ink-10 bg-white p-0.5"
                       value={r.swatch || '#cccccc'} title={r.swatch || 'No colour set'}
                       onChange={e => update(i, 'swatch', e.target.value)} />
                {r.swatch && (
                  <button type="button" onClick={() => update(i, 'swatch', '')}
                          className="text-ink-30 hover:text-ink-60 leading-none" title="Clear swatch"><X size={12} /></button>
                )}
              </div>
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

// ── Format MOQs tab ─────────────────────────────────────────────────────────

function FormatMoqs() {
  const [rows, setRows] = useState([])     // [{ code, label, moq }]  (all strings)
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'format_moq')).then(snap => {
      const d = snap.exists() ? snap.data() : {}
      let next
      if (Array.isArray(d.formats) && d.formats.length) {
        // Canonical, editable list (lets deletes stick).
        next = d.formats.map(f => ({
          code: String(f.code || ''),
          label: String(f.label || ''),
          moq: f.moq != null && f.moq !== '' ? String(f.moq) : '',
        }))
      } else {
        // First load: seed from legacy moq map + the built-in format codes.
        const legacyMoq = d.moq || {}
        const legacyLabels = d.labels || {}
        const codes = [...new Set([...RANGE_FORMAT_CODES.map(f => f.code), ...Object.keys(legacyMoq)])]
        next = codes.map(c => ({
          code: c,
          label: legacyLabels[c] || RANGE_FORMAT_CODES.find(f => f.code === c)?.label || '',
          moq: legacyMoq[c] != null ? String(legacyMoq[c]) : '',
        }))
      }
      setRows(next); setSaved(next); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const update = (i, key, val) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const addRow = () => setRows(rs => [...rs, { code: '', label: '', moq: '' }])
  const removeRow = i => setRows(rs => rs.filter((_, j) => j !== i))
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved)

  async function save() {
    setSaving(true); setMsg(null)
    try {
      // Keep only rows with a code; de-dupe by code (last one wins).
      const byCode = {}
      for (const r of rows) {
        const code = r.code.trim()
        if (!code) continue
        byCode[code] = { code, label: r.label.trim(), moq: r.moq }
      }
      const clean = Object.values(byCode)
      // Storefront-facing maps (only positive minimums / non-empty labels).
      const moq = {}, labels = {}
      const formats = clean.map(r => {
        const n = Number(r.moq)
        const has = r.moq !== '' && n > 0
        if (has) moq[r.code] = n
        if (r.label) labels[r.code] = r.label
        return { code: r.code, label: r.label, moq: has ? n : 0 }
      })
      await setDoc(doc(db, 'settings', 'format_moq'), { formats, moq, labels, updatedAt: serverTimestamp() })
      const asRows = formats.map(f => ({ code: f.code, label: f.label, moq: f.moq > 0 ? String(f.moq) : '' }))
      setRows(asRows); setSaved(asRows)
      setMsg('Format MOQs saved.')
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setMsg('Error saving: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-ink-80">Format Minimum Order Quantities</h2>
        <button onClick={addRow} className="btn-secondary text-xs py-1.5 px-3">+ Add format</button>
      </div>
      <p className="text-xs text-ink-50 mb-4">
        Minimum run for each format base component (music box, freestand, bible…). On a customer
        enquiry these pool across every design sharing the format, so the customer is told to combine
        designs to reach the minimum. Leave the MOQ blank for no format minimum.
      </p>

      {loading ? (
        <p className="text-xs text-ink-50">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink-50">No formats yet — add one.</p>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-40 px-1">
            <span className="w-20 shrink-0">Code</span>
            <span className="flex-1">Name</span>
            <span className="w-28 shrink-0">MOQ (pcs)</span>
            <span className="w-6 shrink-0" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input text-sm font-mono w-20 shrink-0" value={r.code}
                     placeholder="236" maxLength={4}
                     onChange={e => update(i, 'code', e.target.value.replace(/[^\d]/g, '').slice(0, 4))} />
              <input className="input text-sm flex-1 min-w-0" value={r.label}
                     placeholder="Music Box" onChange={e => update(i, 'label', e.target.value)} />
              <div className="relative w-28 shrink-0">
                <input type="number" min="0" step="1"
                       className="input pr-9 text-right tabular-nums"
                       value={r.moq}
                       onChange={e => update(i, 'moq', e.target.value.replace(/[^\d]/g, ''))} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-40 pointer-events-none">pcs</span>
              </div>
              <button type="button" onClick={() => removeRow(i)}
                      className="text-red-400 hover:text-red-600 px-1 leading-none shrink-0" title="Remove"><X size={15} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <button onClick={save} disabled={saving || !dirty} className="btn-primary text-sm">
          {saving ? 'Saving…' : 'Save Format MOQs'}
        </button>
        {dirty && <span className="text-xs text-amber-500">unsaved changes</span>}
        {msg && <p className={`text-xs ${msg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>}
      </div>
    </div>
  )
}

// ── Pricing Groups tab ───────────────────────────────────────────────────────
// Customer pricing strategies for corporate gifts. Each group has a markup
// (cost × markup = sell price). Customers are assigned a group in Customer
// Accounts; a per-customer override can still beat the group. Prices are
// recomputed per customer when an admin publishes on a product's Pricing page.

const slugify = s => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function PricingGroups() {
  const [rows, setRows] = useState([])   // [{ id, name, markup }]  (markup string)
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'pricing_groups')).then(snap => {
      const d = snap.exists() ? snap.data() : {}
      const next = (Array.isArray(d.groups) ? d.groups : []).map(g => ({
        id: String(g.id || ''),
        name: String(g.name || ''),
        markup: g.markup != null && g.markup !== '' ? String(g.markup) : '',
      }))
      setRows(next); setSaved(next); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const update = (i, key, val) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const addRow = () => setRows(rs => [...rs, { id: '', name: '', markup: '' }])
  const removeRow = i => setRows(rs => rs.filter((_, j) => j !== i))
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved)

  async function save() {
    setSaving(true); setMsg(null)
    try {
      // Keep rows with a name + positive markup; assign a stable id (slug of name,
      // de-duplicated) so customer assignments survive renames of the label.
      const used = new Set()
      const groups = []
      for (const r of rows) {
        const name = r.name.trim()
        const markup = Number(r.markup)
        if (!name || !(markup > 0)) continue
        let id = r.id && r.id.trim() ? r.id.trim() : slugify(name)
        if (!id) id = 'group'
        let unique = id, n = 2
        while (used.has(unique)) unique = `${id}-${n++}`
        used.add(unique)
        groups.push({ id: unique, name, markup })
      }
      await setDoc(doc(db, 'settings', 'pricing_groups'), { groups, updatedAt: serverTimestamp() })
      const asRows = groups.map(g => ({ id: g.id, name: g.name, markup: String(g.markup) }))
      setRows(asRows); setSaved(asRows)
      setMsg(`Saved ${groups.length} group${groups.length === 1 ? '' : 's'}.`)
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setMsg('Error saving: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-ink-80">Customer Pricing Groups</h2>
        <button onClick={addRow} className="btn-secondary text-xs py-1.5 px-3">+ Add group</button>
      </div>
      <p className="text-xs text-ink-50 mb-4">
        Pricing strategies for corporate gifts. The markup multiplies the product's all-in cost to set
        the customer's price (e.g. 2.0× = cost doubled). Assign each customer a group in Customer
        Accounts; a per-customer override can beat the group. After changing markups, open a product's
        Pricing page and Publish to push new prices.
      </p>

      {loading ? (
        <p className="text-xs text-ink-50">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink-50">No groups yet — add one (e.g. Standard 2.0×, Preferred 1.7×, VIP 1.5×).</p>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-40 px-1">
            <span className="flex-1">Group name</span>
            <span className="w-28 shrink-0">Markup (×)</span>
            <span className="w-6 shrink-0" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input text-sm flex-1 min-w-0" value={r.name}
                     placeholder="e.g. Preferred" onChange={e => update(i, 'name', e.target.value)} />
              <div className="relative w-28 shrink-0">
                <input type="number" min="1" step="0.05"
                       className="input pr-7 text-right tabular-nums"
                       value={r.markup} placeholder="2.0"
                       onChange={e => update(i, 'markup', e.target.value)} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-40 pointer-events-none">×</span>
              </div>
              <button type="button" onClick={() => removeRow(i)}
                      className="text-red-400 hover:text-red-600 px-1 leading-none shrink-0" title="Remove"><X size={15} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <button onClick={save} disabled={saving || !dirty} className="btn-primary text-sm">
          {saving ? 'Saving…' : 'Save Pricing Groups'}
        </button>
        {dirty && <span className="text-xs text-amber-500">unsaved changes</span>}
        {msg && <p className={`text-xs ${msg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>}
      </div>
    </div>
  )
}
