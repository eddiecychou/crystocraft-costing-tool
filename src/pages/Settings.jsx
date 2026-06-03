import { useState, useEffect, useCallback } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

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

  const isDirty = savedRates && CURRENCIES.some(c => String(rates[c]) !== String(savedRates[c]))

  return (
    <div className="p-4 md:p-6 max-w-xl">
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

function Spinner() {
  return (
    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}
