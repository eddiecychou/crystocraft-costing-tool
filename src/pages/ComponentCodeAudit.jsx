import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { AlertTriangle, CheckCircle2, Search, Puzzle } from 'lucide-react'
import { db } from '../firebase'
import LoadingBar from '../components/LoadingBar'
import { erpCodesExist, erpCodeAlternatives } from '../erpApi'

// Are the app's critical-component codes the ones the ERP actually builds with?
//
// A component's `code` is meant to BE the ERP item code — that is the join
// between the two systems, and everything crossing it (BOM checks, stock,
// purchase history, MRP) depends on it.
//
// EXISTENCE IS THE WEAK TEST. The codes were first assumed to be typos, then
// checked: all six on one product exist in the ERP. The real problem is that
// several are SUPERSEDED items — FM-K(32).03-C ("C-K-32 鋅合金件") exists and is
// used by ZERO current BOMs, while every BOM builds with FM-K(32)-C ("底座配件
// K-32 chrome", 526 BOMs). So this reports both: does the code exist, and does
// anything current use it.
//
// Candidates are fetched on demand from the ERP's OWN search, never guessed
// with edit distance — that was tried on the costing screen and kept pairing
// the wrong part (offering FM-K(21)-G for FM-K(32)-G). A human decides.
// Ranked replacements. The BOM count is the point — a part used by 526 BOMs is
// a far likelier replacement than one used by 4 — and `reason` says why each
// was offered, so a suggestion is never mistaken for a confirmed match.
function Suggestions({ hits }) {
  return (
    <>
      {hits.map((h, i) => (
        <div key={h.code} className={`text-xs ${i === 0 ? 'font-medium' : ''}`}>
          <span className="font-mono text-ink">{h.code}</span>
          <span className="text-ink-60"> · {h.bom_count} BOMs · {h.name || '—'}</span>
          {h.reason === 'same code without the .NN segment' && (
            <span className="ml-1 text-teal-600">· same code without “.NN”</span>
          )}
        </div>
      ))}
      <p className="text-xs text-ink-60 mt-1">
        Suggestions only — confirm which part is really meant before changing anything.
      </p>
    </>
  )
}

export default function ComponentCodeAudit() {
  const [rows, setRows] = useState([])       // [{ id, code, name, exists, bomCount }]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [candidates, setCandidates] = useState({})   // code -> [erp rows] | 'loading' | 'none'

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const snap = await getDocs(collection(db, 'range_components'))
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(c => (c.code || '').trim())
          .map(c => ({ id: c.id, code: c.code.trim(), name: c.name || '' }))
          .sort((a, b) => a.code.localeCompare(b.code))

        const { found, usage } = await erpCodesExist(list.map(c => c.code))
        if (!alive) return
        setRows(list.map(c => ({
          ...c, exists: found.has(c.code), bomCount: usage[c.code] ?? 0,
        })))
      } catch (e) {
        if (alive) setError(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // What do current BOMs use instead? Ranked server-side among components the
  // BOMs actually use. On demand, so auditing hundreds isn't hundreds of calls.
  async function findCandidates(code) {
    setCandidates(c => ({ ...c, [code]: 'loading' }))
    try {
      const hits = await erpCodeAlternatives(code)
      setCandidates(c => ({ ...c, [code]: hits.length ? hits : 'none' }))
    } catch (e) {
      setError(e.message)
      setCandidates(c => ({ ...c, [code]: 'none' }))
    }
  }

  // Three states, in descending severity. "Exists but no current BOM uses it"
  // is the interesting one: the code is real, so an existence check passes, but
  // nothing is built from it — it's a superseded item.
  const missing = rows.filter(r => !r.exists)
  const unused = rows.filter(r => r.exists && !r.bomCount)
  const ok = rows.filter(r => r.exists && r.bomCount > 0)

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}

      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold text-ink flex items-center gap-2">
          <Puzzle size={22} className="text-teal-600" /> Component Code Audit
        </h1>
        <p className="text-sm text-ink-60 mt-0.5">
          A component's code is meant to be the ERP item code — that's the join between the two
          systems. This checks which codes actually exist in the ERP item master.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-none px-3 py-2 mb-4">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {!loading && !error && (
        <div className={`rounded-none border px-4 py-3 mb-5 text-sm ${
          missing.length || unused.length ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'
        }`}>
          {missing.length || unused.length ? (
            <span className="text-amber-900">
              <AlertTriangle size={15} className="inline mb-0.5 mr-1" />
              Of {rows.length} component code{rows.length === 1 ? '' : 's'}:{' '}
              <strong>{missing.length}</strong> don't exist in the ERP, and{' '}
              <strong>{unused.length}</strong> exist but no current BOM uses them — those are
              most likely superseded items. Anything joining the two systems on these codes
              — BOM checks, stock, purchase history — won't match what's actually built.
            </span>
          ) : (
            <span className="text-green-800">
              <CheckCircle2 size={15} className="inline mb-0.5 mr-1" />
              All {rows.length} component codes exist in the ERP and are used by current BOMs.
            </span>
          )}
        </div>
      )}

      {missing.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-ink-80 mb-2">Not found in the ERP</h2>
          <div className="bg-white border border-warm-grey rounded-none divide-y divide-warm-grey mb-6">
            {missing.map(r => (
              <div key={r.id} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm">{r.code}</div>
                    {r.name && <div className="text-xs text-ink-60">{r.name}</div>}
                  </div>
                  <button
                    onClick={() => findCandidates(r.code)}
                    disabled={candidates[r.code] === 'loading'}
                    className="shrink-0 inline-flex items-center gap-1 text-xs text-teal-600 hover:underline disabled:opacity-50"
                  >
                    <Search size={12} />
                    {candidates[r.code] === 'loading' ? 'Searching…' : 'Find in ERP'}
                  </button>
                </div>

                {Array.isArray(candidates[r.code]) && (
                  <div className="mt-2 pl-3 border-l-2 border-warm-grey">
                    <p className="text-xs text-ink-60 mb-1">What current BOMs use instead:</p>
                    <Suggestions hits={candidates[r.code]} />
                  </div>
                )}
                {candidates[r.code] === 'none' && (
                  <p className="mt-1 pl-3 text-xs text-ink-60">
                    Nothing similar found — this may be a part the ERP never had.
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {unused.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-ink-80 mb-2">
            Exists in the ERP, but no current BOM uses it
          </h2>
          <p className="text-xs text-ink-60 mb-2">
            The code is real, so it isn't a typo — but nothing is built from it. Usually this
            means the part was superseded and the BOMs moved to a different code.
          </p>
          <div className="bg-white border border-warm-grey rounded-none divide-y divide-warm-grey mb-6">
            {unused.map(r => (
              <div key={r.id} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm">{r.code}</div>
                    {r.name && <div className="text-xs text-ink-60">{r.name}</div>}
                  </div>
                  <button
                    onClick={() => findCandidates(r.code)}
                    disabled={candidates[r.code] === 'loading'}
                    className="shrink-0 inline-flex items-center gap-1 text-xs text-teal-600 hover:underline disabled:opacity-50"
                  >
                    <Search size={12} />
                    {candidates[r.code] === 'loading' ? 'Searching…' : 'What do the BOMs use?'}
                  </button>
                </div>
                {Array.isArray(candidates[r.code]) && (
                  <div className="mt-2 pl-3 border-l-2 border-warm-grey">
                    <p className="text-xs text-ink-60 mb-1">What current BOMs use instead:</p>
                    <Suggestions hits={candidates[r.code]} />
                  </div>
                )}
                {candidates[r.code] === 'none' && (
                  <p className="mt-1 pl-3 text-xs text-ink-60">Nothing similar found.</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {ok.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-70">
            {ok.length} code{ok.length === 1 ? '' : 's'} exist and are used by current BOMs
          </summary>
          <div className="mt-2 bg-white border border-warm-grey rounded-none divide-y divide-warm-grey">
            {ok.map(r => (
              <div key={r.id} className="px-3 py-1.5 flex justify-between gap-3">
                <span className="font-mono text-xs">{r.code}</span>
                <span className="text-xs text-ink-60 shrink-0">{r.bomCount} BOMs</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="text-xs text-ink-60 mt-4">
        Read-only. Fixing a code is a decision about which part is really meant, so it's done in{' '}
        Components, not here.
      </p>
    </div>
  )
}
