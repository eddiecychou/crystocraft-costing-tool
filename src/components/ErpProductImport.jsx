import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { erpLookup } from '../erpApi'
import { previewErpProduct, applyErpProduct } from '../erpProductImport'
import { buildProductIndex, matchProductCode } from '../criticalComponents'
import { X, Search, Database, AlertTriangle, Check, Loader2 } from 'lucide-react'

// Import a figurine from the JES item master rather than re-typing it.
//
// Three steps on purpose — search, review, import. The review step is not
// ceremony: the ERP holds several variants per design with differing BOMs, so
// what actually gets created is a MERGE that no single ERP screen shows. Anyone
// importing should see the merged result, and which parts are already known to
// the app, before it is written.
export default function ErpProductImport({ products = [], initialCode = '', onClose }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [picked, setPicked] = useState(new Set())   // component codes to import
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  // Opened from a specific ERP row (the lookup's Import action) — skip the
  // search and go straight to the review, which is the step that matters.
  useEffect(() => {
    if (initialCode) choose(initialCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode])

  // Finished goods only — a figurine is an FG item. Debounced, because this
  // searches 44,467 items.
  useEffect(() => {
    const needle = q.trim()
    if (needle.length < 3) { setResults([]); return }
    let alive = true
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const rows = await erpLookup('item', { q: needle, limit: 40 })
        if (alive) setResults((rows || []).filter((r) => String(r.type).toUpperCase() === 'FG'))
      } catch (e) {
        if (alive) { setError(e.message); setResults([]) }
      } finally {
        if (alive) setSearching(false)
      }
    }, 350)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  async function choose(code) {
    setLoadingPreview(true); setError(''); setPreview(null)
    try {
      const p = await previewErpProduct(code)
      setPreview(p)
      // Everything selected by default — the common case is "take it all", and
      // unticking a part is easier than hunting for the ones you want.
      setPicked(new Set((p?.components || []).map((c) => c.code)))
    } catch (e) {
      setError(e.message || 'Could not read this item from the ERP.')
    } finally {
      setLoadingPreview(false)
    }
  }

  async function doImport() {
    setImporting(true); setError('')
    try {
      const res = await applyErpProduct(preview, { selectedCodes: [...picked] })
      onClose?.()
      navigate(`/range/${res.productId}`)
    } catch (e) {
      setError(e.message || 'Import failed.')
      setImporting(false)
    }
  }

  const toggle = (code) => setPicked((s) => {
    const n = new Set(s)
    n.has(code) ? n.delete(code) : n.add(code)
    return n
  })

  // A design already in the app is the one thing that should stop an import —
  // a second product for the same design would split its costing in two.
  //
  // Matched with the app's own matcher rather than a string compare: design_code
  // is not stored consistently (some rows hold "D0268", others "D0268-001"), and
  // matchProductCode already knows how to reconcile a full ERP variant code
  // against either shape. A naive compare would miss the duplicate exactly when
  // it matters.
  const already = preview
    ? matchProductCode(preview.base, buildProductIndex(products))
    : null

  const newCount = (preview?.components || []).filter((c) => !c.existing && picked.has(c.code)).length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-none shadow-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-warm-grey">
          <h2 className="text-base font-semibold text-ink inline-flex items-center gap-2">
            <Database size={16} className="text-teal-600" /> Import a figurine from the ERP
          </h2>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70"><X size={18} /></button>
        </div>

        <div className="p-5">
          {/* ── Step 1: find the item ── */}
          {!preview && (
            <>
              <label className="block mb-3">
                <span className="text-xs font-medium text-ink-60 uppercase tracking-wide">Item code or description</span>
                <div className="relative mt-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-60" />
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                    placeholder="e.g. D0268-001, or Zodiac Pisces"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-warm-grey rounded-none focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
                </div>
              </label>

              {q.trim().length > 0 && q.trim().length < 3 && (
                <p className="text-xs text-ink-60">Keep typing — at least 3 characters.</p>
              )}
              {searching && <p className="text-xs text-ink-60 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Searching the item master…</p>}
              {!searching && q.trim().length >= 3 && results.length === 0 && (
                <p className="text-xs text-ink-60">No finished-goods item matches. Only FG items can be imported as a figurine.</p>
              )}

              {results.length > 0 && (
                <ul className="border border-warm-grey rounded-none divide-y divide-warm-grey max-h-72 overflow-auto">
                  {results.map((r) => (
                    <li key={r.code}>
                      <button type="button" onClick={() => choose(r.code)}
                        className="w-full text-left px-3 py-2 hover:bg-ivory flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="font-mono text-xs text-ink">{r.code}</span>
                          <span className="block text-xs text-ink-60 truncate">{r.name || '—'}</span>
                        </span>
                        <span className="text-2xs text-teal-600 shrink-0">Review →</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {loadingPreview && (
            <p className="text-sm text-ink-60 inline-flex items-center gap-2 py-6">
              <Loader2 size={15} className="animate-spin" /> Reading every variant and merging their BOMs…
            </p>
          )}

          {/* ── Step 2: review the merge ── */}
          {preview && !loadingPreview && (
            <>
              <div className="mb-4">
                <div className="font-mono text-sm text-ink">{preview.base}</div>
                <div className="text-sm text-ink-70">{preview.name || '(no description in the ERP)'}</div>
                <div className="text-xs text-ink-60 mt-1">
                  Merged from {preview.variants.length} ERP variant{preview.variants.length === 1 ? '' : 's'}: {preview.variants.join(', ')}
                </div>
              </div>

              {already && (
                <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-none px-3 py-2 mb-3">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span>
                    The app already has a product for <strong>{preview.base}</strong>
                    {already.description ? ` — ${already.description}` : ''}. Importing again would create a
                    second one and split its costing.{' '}
                    {already.id && (
                      <button type="button" onClick={() => { onClose?.(); navigate(`/range/${already.id}`) }}
                              className="underline underline-offset-2 font-medium hover:text-red-900">
                        Open the existing product
                      </button>
                    )}
                  </span>
                </div>
              )}

              {preview.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-none px-3 py-2 mb-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" /> <span>{w}</span>
                </div>
              ))}

              {preview.components.length === 0 ? (
                <p className="text-sm text-ink-60 py-4">No FM components in the ERP BOM for this design — the product would be created with no parts.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-ink-60 uppercase tracking-wide">
                      Components ({picked.size} of {preview.components.length})
                    </span>
                    <button type="button"
                      onClick={() => setPicked(picked.size === preview.components.length ? new Set() : new Set(preview.components.map((c) => c.code)))}
                      className="text-xs text-teal-600 hover:underline">
                      {picked.size === preview.components.length ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <ul className="border border-warm-grey rounded-none divide-y divide-warm-grey max-h-64 overflow-auto mb-3">
                    {preview.components.map((c) => (
                      <li key={c.code} className="px-3 py-2 flex items-start gap-2.5 hover:bg-ivory">
                        <input type="checkbox" checked={picked.has(c.code)} onChange={() => toggle(c.code)}
                          className="mt-0.5 rounded-none border-warm-grey text-teal-600 focus:ring-teal-500" />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-xs text-ink">{c.code}</div>
                          {c.name && <div className="text-xs text-ink-60 truncate">{c.name}</div>}
                          <div className="flex flex-wrap gap-1.5 mt-0.5">
                            {c.existing
                              ? <span className="text-2xs px-1.5 py-0.5 rounded-none bg-ivory-dark text-ink-60">already in the app — will be linked, not changed</span>
                              : <span className="text-2xs px-1.5 py-0.5 rounded-none bg-emerald-50 text-emerald-700">new component</span>}
                            {/* Almost always a plating-specific part. Worth seeing
                                now rather than discovering it in a costing. */}
                            {c.partial && (
                              <span className="text-2xs px-1.5 py-0.5 rounded-none bg-amber-50 text-amber-700"
                                    title={`Only in: ${c.inVariants.join(', ')}`}>
                                in {c.inVariants.length} of {preview.variants.length} variants
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-ink-60 tabular-nums shrink-0">×{c.qty}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <p className="text-xs text-ink-60 mb-3">
                The product is created <strong>hidden</strong> — it will not appear in a catalogue or the shop until you tick
                “Visible in catalogue”. The ERP carries no costs, so components arrive uncosted.
              </p>
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-none px-3 py-2 mt-3">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 px-5 py-3 border-t border-warm-grey">
          <button onClick={() => (preview && !initialCode ? setPreview(null) : onClose())}
            className="px-3 py-1.5 text-sm text-ink-70 hover:bg-ivory-dark rounded-none">
            {preview && !initialCode ? '← Back to search' : 'Cancel'}
          </button>
          {preview && (
            <button onClick={doImport} disabled={importing || already}
              className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-40">
              {importing
                ? <><Loader2 size={14} className="animate-spin" /> Importing…</>
                : <><Check size={14} /> Create product{newCount ? ` + ${newCount} component${newCount === 1 ? '' : 's'}` : ''}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
