import { useState, useEffect, useCallback } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { loadCrystalColors, saveCrystalColors } from '../crystalColors'

const CURRENCIES = ['RMB', 'USD', 'EUR']
const LABELS = { RMB: 'RMB → HKD', USD: 'USD → HKD', EUR: 'EUR → HKD' }

export default function Settings() {
  const [rates, setRates]           = useState({ RMB: '', USD: '', EUR: '' })
  const [savedRates, setSavedRates] = useState(null)
  const [lastSaved, setLastSaved]   = useState(null)
  const [fxUpdatedAt, setFxUpdatedAt] = useState(null)

  const [fetching, setFetching]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [saveMsg, setSaveMsg]     = useState(null)

  // Load saved rates from Firestore on mount
  useEffect(() => {
    getDoc(doc(db, 'settings', 'exchange_rates')).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        const loaded = { RMB: d.RMB ?? '', USD: d.USD ?? '', EUR: d.EUR ?? '' }
        setRates(loaded)
        setSavedRates(loaded)
        setLastSaved(d.updatedAt?.toDate?.() || null)
      }
    })
  }, [])

  const fetchLiveRates = useCallback(async () => {
    setFetching(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/fx-rates')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setRates(r => ({
        RMB: data.RMB ?? r.RMB,
        USD: data.USD ?? r.USD,
        EUR: data.EUR ?? r.EUR,
      }))
      setFxUpdatedAt(data.updatedAt || null)
    } catch (e) {
      setFetchError('Could not fetch live rates: ' + e.message)
    } finally {
      setFetching(false)
    }
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    try {
      await setDoc(doc(db, 'settings', 'exchange_rates'), {
        RMB: Number(rates.RMB),
        USD: Number(rates.USD),
        EUR: Number(rates.EUR),
        updatedAt: serverTimestamp(),
      })
      setSavedRates({ ...rates })
      setLastSaved(new Date())
      setSaveMsg('Rates saved successfully.')
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (e) {
      setSaveMsg('Error saving: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const isDirty = !savedRates || CURRENCIES.some(c => String(rates[c]) !== String(savedRates[c]))

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Exchange Rates */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-700">Exchange Rates to HKD</h2>
          <button
            onClick={fetchLiveRates}
            disabled={fetching}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
          >
            {fetching ? <><Spinner /> Fetching…</> : '↻ Fetch Live Rates'}
          </button>
        </div>

        <p className="text-xs text-gray-400 mb-4">
          Used when creating new client quotes. Fetch live rates or enter manually.
        </p>

        {fxUpdatedAt && (
          <p className="text-xs text-blue-500 mb-3">Live rate as of: {fxUpdatedAt}</p>
        )}
        {fetchError && (
          <p className="text-xs text-red-500 mb-3">{fetchError}</p>
        )}

        <div className="space-y-3">
          {CURRENCIES.map(cur => (
            <div key={cur} className="flex items-center gap-3">
              <label className="w-28 text-sm text-gray-600 shrink-0">{LABELS[cur]}</label>
              <div className="relative flex-1">
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  className="input pr-16 text-right tabular-nums"
                  value={rates[cur]}
                  onChange={e => setRates(r => ({ ...r, [cur]: e.target.value }))}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                  HKD
                </span>
              </div>
              {savedRates && String(rates[cur]) !== String(savedRates[cur]) && (
                <span className="text-xs text-amber-500 shrink-0">unsaved</span>
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="btn-primary text-sm"
          >
            {saving ? 'Saving…' : 'Save Rates'}
          </button>
          {lastSaved && (
            <p className="text-xs text-gray-400">
              Last saved:{' '}
              {lastSaved.toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          )}
          {saveMsg && (
            <p className={`text-xs ${saveMsg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>
              {saveMsg}
            </p>
          )}
        </div>
      </div>

      {/* Crystal Colour Library */}
      <CrystalColorsCard />

      {/* Info card */}
      <div className="card p-5 text-sm text-gray-500 space-y-1.5">
        <p className="font-medium text-gray-700 mb-1">How exchange rates work</p>
        <p>• Rates are stored in Firestore and used when creating new quotes.</p>
        <p>• Each new quote pre-fills with these rates, which can be adjusted per-quote.</p>
        <p>
          • <strong>Fetch Live Rates</strong> pulls today's mid-market rate from{' '}
          <a href="https://open.er-api.com" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
            open.er-api.com
          </a>{' '}
          (free, no API key needed).
        </p>
        <p>• Existing quotes are not affected when you update rates here.</p>
      </div>
    </div>
  )
}

function CrystalColorsCard() {
  const [rows, setRows] = useState([])         // [{code,name,surcharge_usd}]
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    loadCrystalColors().then(c => {
      const r = c.map(x => ({ ...x, surcharge_usd: x.surcharge_usd ?? '' }))
      setRows(r); setSaved(r); setLoading(false)
    })
  }, [])

  const update = (i, key, val) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const addRow = () => setRows(rs => [...rs, { code: '', name: '', surcharge_usd: '' }])
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
      const r = clean.map(x => ({ ...x, surcharge_usd: x.surcharge_usd ?? '' }))
      setRows(r); setSaved(r)
      setMsg(`Saved ${r.length} colour${r.length === 1 ? '' : 's'}.`)
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setMsg('Error saving: ' + e.message)
    } finally { setSaving(false) }
  }

  return (
    <div className="card p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-700">Crystal Colour Library</h2>
        <button onClick={addRow} className="btn-secondary text-xs py-1.5 px-3">+ Add colour</button>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Shared list of crystal colours used as a selectable attribute on Figurine
        products. Colours don't create separate SKUs or stock — surcharge is optional
        (blank = same price as the plating's base).
      </p>

      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400">No colours yet — add one, or run “Collapse colours” on the Figurine Gifts page to import them from existing products.</p>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wide text-gray-400 px-1">
            <span className="w-16 shrink-0">Code</span>
            <span className="flex-1">Name</span>
            <span className="w-24 shrink-0">Surcharge $</span>
            <span className="w-16 shrink-0" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input text-xs font-mono uppercase w-16 shrink-0" value={r.code}
                     placeholder="BL" maxLength={6}
                     onChange={e => update(i, 'code', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
              <input className="input text-xs flex-1 min-w-0" value={r.name}
                     placeholder="Sapphire" onChange={e => update(i, 'name', e.target.value)} />
              <input className="input text-xs w-24 shrink-0 text-right tabular-nums" value={r.surcharge_usd}
                     inputMode="decimal" placeholder="0.00"
                     onChange={e => update(i, 'surcharge_usd', e.target.value.replace(/[^\d.]/g, ''))} />
              <div className="flex items-center gap-0.5 w-16 shrink-0 justify-end">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1" title="Move up">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1" title="Move down">↓</button>
                <button type="button" onClick={() => removeRow(i)}
                        className="text-red-400 hover:text-red-600 px-1 text-base leading-none" title="Remove">×</button>
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

function Spinner() {
  return (
    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}
