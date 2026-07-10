import { useState, useEffect, useCallback } from 'react'
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, writeBatch } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { RefreshCw } from 'lucide-react'
import CatalogueBand from './CatalogueBand'
import ImportImages from './ImportImages'
import BulkCategoryEditor from '../components/BulkCategoryEditor'
import BulkVideoEditor from '../components/BulkVideoEditor'
import SchemaAudit from './SchemaAudit'

const CURRENCIES = ['RMB', 'USD', 'EUR']
const LABELS = { RMB: 'RMB → HKD', USD: 'USD → HKD', EUR: 'EUR → HKD' }

const TABS = [
  { v: 'fx',       label: 'Exchange Rates' },
  { v: 'products', label: 'Products' },
  { v: 'quotes',   label: 'Quote Branding' },
  { v: 'audit',    label: 'Schema Audit' },
]
const PRODUCT_TABS = [
  { v: 'band',       label: 'Catalogue Band' },
  { v: 'images',     label: 'Import Images' },
  { v: 'categories', label: 'Bulk Categories' },
  { v: 'video',      label: 'Bulk Video' },
  { v: 'defaults',   label: 'Defaults' },
]

export default function Settings() {
  const [tab, setTab] = useState('fx')
  const [productTab, setProductTab] = useState('band')

  return (
    <div>
      {/* Page header + top-level tabs */}
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-0 border-b border-ivory-dark">
        <h1 className="text-xl md:text-2xl mb-4">Settings</h1>
        <div className="flex gap-0">
          {TABS.map(t => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.v
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-ink-60 hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'fx' && <ExchangeRatesPanel />}

      {tab === 'quotes' && <QuoteBrandingPanel />}

      {tab === 'audit' && <SchemaAudit />}

      {tab === 'products' && (
        <div>
          {/* Products sub-tabs */}
          <div className="px-4 md:px-6 pt-4 flex gap-1 flex-wrap">
            {PRODUCT_TABS.map(t => (
              <button
                key={t.v}
                onClick={() => setProductTab(t.v)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  productTab === t.v
                    ? 'bg-ink text-white'
                    : 'bg-ivory text-ink-70 hover:bg-ivory-dark'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-2">
            {productTab === 'band'       && <CatalogueBand />}
            {productTab === 'images'     && <ImportImages />}
            {productTab === 'categories' && (
              <div className="p-4 md:p-6">
                <h2 className="text-lg font-semibold mb-1">Bulk Categories</h2>
                <BulkCategoryEditor />
              </div>
            )}
            {productTab === 'video' && (
              <div className="p-4 md:p-6">
                <h2 className="text-lg font-semibold mb-1">Bulk Video</h2>
                <BulkVideoEditor />
              </div>
            )}
            {productTab === 'defaults' && <ProductDefaults />}
          </div>
        </div>
      )}
    </div>
  )
}

function ProductDefaults() {
  // Global: parts lead time for products with no components tracked (saved live to Firestore)
  const [partsLead, setPartsLead] = useState('6')
  const [partsLeadSaved, setPartsLeadSaved] = useState(false)
  const [partsLeadBusy, setPartsLeadBusy] = useState(false)

  // Batch: bulk-apply assembly lead + MOQ to products missing them
  const [leadTime, setLeadTime] = useState('3')
  const [moq, setMoq] = useState('100')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')

  // Load saved parts lead time from Firestore on mount
  useEffect(() => {
    getDoc(doc(db, 'settings', 'productDefaults')).then(snap => {
      if (snap.exists() && snap.data().default_parts_lead_weeks) {
        setPartsLead(String(snap.data().default_parts_lead_weeks))
      }
    })
  }, [])

  async function savePartsLead() {
    const v = Number(partsLead)
    if (!v || v < 1) return
    setPartsLeadBusy(true)
    try {
      await setDoc(doc(db, 'settings', 'productDefaults'), { default_parts_lead_weeks: v }, { merge: true })
      setPartsLeadSaved(true)
      setTimeout(() => setPartsLeadSaved(false), 2000)
    } catch (e) { alert('Error: ' + e.message) }
    finally { setPartsLeadBusy(false) }
  }

  async function apply() {
    const lt = Number(leadTime)
    const mq = Number(moq)
    if (!lt || !mq) { setLog('Please enter valid values for both fields.'); return }
    if (!window.confirm(
      `Set assembly lead time = ${lt} weeks and MOQ = ${mq} pcs on all products that do not already have these values?\n\nYou can override individual products afterward.`
    )) return
    setBusy(true); setLog('')
    try {
      const snap = await getDocs(collection(db, 'range_products'))
      const toUpdate = snap.docs.filter(d => !(Number(d.data().lead_time_weeks) > 0) || !(Number(d.data().moq) > 0))
      for (let i = 0; i < toUpdate.length; i += 500) {
        const batch = writeBatch(db)
        for (const d of toUpdate.slice(i, i + 500)) {
          const data = {}
          if (!(Number(d.data().lead_time_weeks) > 0)) data.lead_time_weeks = lt
          if (!(Number(d.data().moq) > 0)) data.moq = mq
          batch.update(doc(db, 'range_products', d.id), data)
        }
        await batch.commit()
      }
      setLog(`Done — updated ${toUpdate.length} product${toUpdate.length !== 1 ? 's' : ''}.`)
    } catch (e) { setLog('Error: ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="p-4 md:p-6 max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Product Defaults</h2>
        <p className="text-sm text-ink-60">Global settings that apply across all figurine products.</p>
      </div>

      {/* Global: parts lead time for products with no components */}
      <div className="card p-5 space-y-3">
        <div>
          <h3 className="font-medium text-sm mb-0.5">Default parts lead time</h3>
          <p className="text-[12px] text-ink-60">
            When a product has no critical components listed, this is the assumed time to source parts.
            Total lead time shown to customers = parts lead + per-product assembly lead. Applies immediately to all products without tracked components.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div className="w-32">
            <label className="label">Weeks</label>
            <input className="input" type="number" min="1" value={partsLead}
                   onChange={e => { setPartsLead(e.target.value); setPartsLeadSaved(false) }} />
          </div>
          <button onClick={savePartsLead} disabled={partsLeadBusy} className="btn-primary text-sm mb-0.5">
            {partsLeadBusy ? 'Saving…' : partsLeadSaved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>

      {/* Batch: apply assembly lead + MOQ to products missing them */}
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="font-medium text-sm mb-0.5">Bulk-apply assembly lead time &amp; MOQ</h3>
          <p className="text-[12px] text-ink-60">
            Set assembly lead time and MOQ on all products that do not already have these values.
            Products with existing values are left untouched — override them individually in the product editor.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Assembly lead time <span className="text-ink-60 font-normal">(weeks)</span></label>
            <input className="input" type="number" min="1" value={leadTime}
                   onChange={e => setLeadTime(e.target.value)} placeholder="3" />
            <p className="text-[11px] text-ink-50 mt-1">Weeks to assemble when components are on hand</p>
          </div>
          <div>
            <label className="label">MOQ <span className="text-ink-60 font-normal">(pcs)</span></label>
            <input className="input" type="number" min="1" value={moq}
                   onChange={e => setMoq(e.target.value)} placeholder="100" />
            <p className="text-[11px] text-ink-50 mt-1">Minimum order quantity for made-to-order</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={apply} disabled={busy} className="btn-primary text-sm">
            {busy ? 'Applying…' : 'Apply to products without values'}
          </button>
          {log && <p className={`text-sm ${log.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{log}</p>}
        </div>
      </div>
    </div>
  )
}

// Upload once — the stamp/signature is embedded automatically in the "Issued
// By" block of every quote PDF from then on (see QuoteExport.jsx / QuotePDF.jsx).
// No per-quote attaching. PNG with a transparent background looks best since it
// sits directly over the signature line.
function QuoteBrandingPanel() {
  const [stampUrl, setStampUrl] = useState(null)   // null = loading
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getDoc(doc(db, 'settings', 'quote_branding'))
      .then(snap => setStampUrl(snap.exists() ? (snap.data().stamp_url || '') : ''))
      .catch(() => setStampUrl(''))
  }, [])

  async function handleUpload(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setUploading(true); setMsg('')
    try {
      const path = `settings/quote_stamp_${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`
      await uploadBytes(storageRef(storage, path), file)
      const url = await getDownloadURL(storageRef(storage, path))
      await setDoc(doc(db, 'settings', 'quote_branding'), { stamp_url: url, updatedAt: serverTimestamp() }, { merge: true })
      setStampUrl(url)
      setMsg('Saved — it will appear on every new quote PDF.')
      setTimeout(() => setMsg(''), 4000)
    } catch (err) {
      setMsg('Upload failed: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove() {
    await setDoc(doc(db, 'settings', 'quote_branding'), { stamp_url: '' }, { merge: true })
    setStampUrl('')
  }

  if (stampUrl === null) return <div className="p-4 md:p-6 text-sm text-ink-50">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <h2 className="text-lg font-semibold mb-1">Quote Stamp &amp; Signature</h2>
      <p className="text-sm text-ink-60 mb-4">
        Upload a company chop / signature image once — it's embedded automatically over the
        "Issued By" line on every quote PDF. A PNG with a transparent background works best.
      </p>

      {stampUrl ? (
        <div className="inline-block border border-ivory-dark rounded-md p-3 bg-white mb-4">
          <img src={stampUrl} alt="Quote stamp" className="max-h-24 max-w-xs object-contain" />
        </div>
      ) : (
        <p className="text-sm text-ink-50 mb-4">No stamp uploaded yet — quote PDFs will show a blank signature line.</p>
      )}

      <div className="flex items-center gap-3">
        <label className="btn-secondary text-sm cursor-pointer">
          {uploading ? 'Uploading…' : stampUrl ? 'Replace' : 'Upload image'}
          <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
        {stampUrl && <button onClick={handleRemove} className="text-sm text-red-500 hover:underline">Remove</button>}
      </div>
      {msg && <p className={`text-xs mt-2 ${msg.startsWith('Upload failed') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>}
    </div>
  )
}

function ExchangeRatesPanel() {
  const [rates, setRates]           = useState({ RMB: '', USD: '', EUR: '' })
  const [savedRates, setSavedRates] = useState(null)
  const [lastSaved, setLastSaved]   = useState(null)
  const [fxUpdatedAt, setFxUpdatedAt] = useState(null)
  const [fetching, setFetching]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [saveMsg, setSaveMsg]       = useState(null)

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
      setRates(r => ({ RMB: data.RMB ?? r.RMB, USD: data.USD ?? r.USD, EUR: data.EUR ?? r.EUR }))
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
        RMB: Number(rates.RMB), USD: Number(rates.USD), EUR: Number(rates.EUR),
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
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-700">Exchange Rates to HKD</h2>
          <button onClick={fetchLiveRates} disabled={fetching}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
            {fetching ? <><Spinner /> Fetching…</> : <span className="inline-flex items-center gap-1.5"><RefreshCw size={14} />Fetch Live Rates</span>}
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">Used when creating new client quotes. Fetch live rates or enter manually.</p>
        {fxUpdatedAt && <p className="text-xs text-blue-500 mb-3">Live rate as of: {fxUpdatedAt}</p>}
        {fetchError  && <p className="text-xs text-red-500 mb-3">{fetchError}</p>}
        <div className="space-y-3">
          {CURRENCIES.map(cur => (
            <div key={cur} className="flex items-center gap-3">
              <label className="w-28 text-sm text-gray-600 shrink-0">{LABELS[cur]}</label>
              <div className="relative flex-1">
                <input type="number" step="0.0001" min="0" className="input pr-16 text-right tabular-nums"
                  value={rates[cur]} onChange={e => setRates(r => ({ ...r, [cur]: e.target.value }))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">HKD</span>
              </div>
              {savedRates && String(rates[cur]) !== String(savedRates[cur]) && (
                <span className="text-xs text-amber-500 shrink-0">unsaved</span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <button onClick={handleSave} disabled={saving || !isDirty} className="btn-primary text-sm">
            {saving ? 'Saving…' : 'Save Rates'}
          </button>
          {lastSaved && (
            <p className="text-xs text-gray-400">
              Last saved: {lastSaved.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          {saveMsg && <p className={`text-xs ${saveMsg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{saveMsg}</p>}
        </div>
      </div>

      <div className="card p-5 text-sm text-gray-500 space-y-1.5">
        <p className="font-medium text-gray-700 mb-1">How exchange rates work</p>
        <p>• Rates are stored in Firestore and used when creating new quotes.</p>
        <p>• Each new quote pre-fills with these rates, which can be adjusted per-quote.</p>
        <p>• <strong>Fetch Live Rates</strong> pulls today's mid-market rate from{' '}
          <a href="https://open.er-api.com" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">open.er-api.com</a> (free, no API key needed).</p>
        <p>• Existing quotes are not affected when you update rates here.</p>
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
