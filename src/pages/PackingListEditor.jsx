import { useState, useEffect, useMemo } from 'react'
import { CheckCircle2, AlertTriangle, Plus, Trash2, RefreshCw, Package } from 'lucide-react'
import {
  PL_STATUSES, PACK_MODES,
  buildFullCartonPlan, calcPackedVsOrdered, derivedCbm,
  loadRangeProductsWithPacking,
  getPackingListByOrder, createPackingList, updatePackingList,
  saveCartonsWithContents, getCartonsWithContents,
} from '../packing'

// ── Helpers ───────────────────────────────────────────────────────────────────
function newCarton(seq = 1) {
  return {
    _localId: crypto.randomUUID(), id: null,
    carton_seq: seq, carton_count: 1,
    packaging_code: '',
    gw_kg_standard: null, gw_kg_actual: null,
    length_cm: null, width_cm: null, height_cm: null,
    cbm_per_carton: null, nw_kg: null,
    is_estimate: true, notes: '',
    contents: [],
  }
}

function newContent() {
  return { _localId: crypto.randomUUID(), id: null, item_code: '', description: '', qty: '', order_line_id: '' }
}

function nextSeq(cartons) {
  if (!cartons.length) return 1
  const last = cartons[cartons.length - 1]
  return (parseInt(last.carton_seq) || 1) + (parseInt(last.carton_count) || 1)
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const s = PL_STATUSES.find(x => x.value === status) || PL_STATUSES[0]
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.style}`}>{s.label}</span>
}

function PackedVsOrdered({ packableLines, cartons }) {
  const rows = useMemo(() => calcPackedVsOrdered(packableLines, cartons), [packableLines, cartons])
  if (!rows.length) return null
  const allOk = rows.every(r => r.packed === r.ordered)
  return (
    <div className={`rounded-lg border p-4 ${allOk ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-center gap-2 mb-3">
        {allOk
          ? <CheckCircle2 size={15} className="text-green-600" />
          : <AlertTriangle size={15} className="text-amber-600" />}
        <span className={`text-sm font-medium ${allOk ? 'text-green-700' : 'text-amber-700'}`}>
          {allOk ? 'All quantities reconciled' : 'Quantity mismatch — resolve before marking Final'}
        </span>
      </div>
      <div className="space-y-1">
        {rows.map(r => {
          const ok   = r.packed === r.ordered
          const diff = r.packed - r.ordered
          return (
            <div key={r.key} className="flex items-center justify-between text-xs gap-4">
              <span className="font-mono text-gray-600 shrink-0">{r.item_code}</span>
              <span className="text-gray-500 truncate flex-1">{r.description}</span>
              <span className={`shrink-0 font-medium ${ok ? 'text-green-700' : 'text-amber-700'}`}>
                {r.packed} / {r.ordered} {ok ? '✓' : diff > 0 ? `+${diff} over` : `${diff} short`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Full-carton mode row ──────────────────────────────────────────────────────
function FullCartonRow({ carton, idx, onChange, onRemove, packableLines }) {
  const c = carton
  const gw    = c.gw_kg_actual ?? c.gw_kg_standard ?? ''
  const isAct = c.gw_kg_actual !== null || !c.is_estimate
  const cbm   = derivedCbm(c)
  const seqEnd = parseInt(c.carton_seq) + parseInt(c.carton_count || 1) - 1
  const seqLabel = parseInt(c.carton_count) > 1 ? `${c.carton_seq}–${seqEnd}` : String(c.carton_seq)
  const content  = c.contents?.[0]
  const extraItems = Math.max(0, (c.contents?.length || 0) - 1)

  // Interim guard (pre P-1): the single-line view only manages contents[0], but
  // must NOT discard any further items a carton already holds (e.g. entered in
  // mixed mode). Patch the first content in place and keep the tail intact.
  function patchFirstContent(patch) {
    const list = c.contents?.length ? c.contents : [newContent()]
    onChange({ ...c, contents: list.map((it, i) => (i === 0 ? { ...it, ...patch } : it)) })
  }

  function patchDims(field, val) {
    const updated = { ...c, [field]: val === '' ? null : parseFloat(val) || null }
    const l = parseFloat(updated.length_cm), w = parseFloat(updated.width_cm), h = parseFloat(updated.height_cm)
    onChange({ ...updated, cbm_per_carton: l && w && h ? Math.round(l * w * h / 1e6 * 1e6) / 1e6 : c.cbm_per_carton, is_estimate: false })
  }
  function patchActualGw(val) {
    onChange({ ...c, gw_kg_actual: val === '' ? null : parseFloat(val) || null, is_estimate: false })
  }

  return (
    <tr className={`border-b border-gray-100 ${!c.is_estimate ? 'bg-green-50/30' : ''}`}>
      <td className="px-3 py-2 text-xs font-mono text-gray-500 whitespace-nowrap">{seqLabel}</td>
      <td className="px-3 py-2">
        <input
          className="input py-1 text-xs font-mono w-28"
          value={content?.item_code || ''}
          onChange={e => patchFirstContent({ item_code: e.target.value })}
          placeholder="Item code"
        />
        {extraItems > 0 && (
          <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700"
                title="This carton holds more items — switch to mixed mode to see them all">
            +{extraItems} more
          </span>
        )}
      </td>
      <td className="px-3 py-2 min-w-[140px]">
        <input
          className="input py-1 text-xs w-full"
          value={content?.description || ''}
          onChange={e => patchFirstContent({ description: e.target.value })}
          placeholder="Description"
        />
      </td>
      <td className="px-3 py-2">
        <input
          className="input py-1 text-xs w-16 text-right"
          type="number" min="1"
          value={content?.qty || ''}
          onChange={e => patchFirstContent({ qty: e.target.value })}
          placeholder="48"
        />
      </td>
      <td className="px-3 py-2">
        <input
          className="input py-1 text-xs w-16 text-right"
          type="number" min="1"
          value={c.carton_count || ''}
          onChange={e => onChange({ ...c, carton_count: parseInt(e.target.value) || 1 })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={`input py-1 text-xs w-20 text-right ${isAct ? 'border-green-400' : ''}`}
          type="number" step="0.1" min="0"
          value={c.gw_kg_actual ?? c.gw_kg_standard ?? ''}
          onChange={e => patchActualGw(e.target.value)}
          placeholder="kg"
          title={c.gw_kg_standard ? `Standard: ${c.gw_kg_standard} kg` : ''}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          {(['length_cm', 'width_cm', 'height_cm']).map(f => (
            <input
              key={f}
              className={`input py-1 text-xs w-14 text-right ${!c.is_estimate ? 'border-green-400' : ''}`}
              type="number" step="0.1" min="0"
              value={c[f] ?? ''}
              onChange={e => patchDims(f, e.target.value)}
              placeholder={f === 'length_cm' ? 'L' : f === 'width_cm' ? 'W' : 'H'}
            />
          ))}
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-right text-gray-600 whitespace-nowrap">
        {cbm ? cbm.toFixed(4) : '—'}
      </td>
      <td className="px-3 py-2 text-center">
        {c.is_estimate
          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">Est</span>
          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">Actual</span>}
      </td>
      <td className="px-3 py-2">
        <button type="button" onClick={onRemove} className="text-gray-300 hover:text-red-500">
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  )
}

// ── Mixed mode carton card ────────────────────────────────────────────────────
function MixedCartonCard({ carton, onChange, onRemove, packableLines }) {
  const c = carton
  const seqEnd = parseInt(c.carton_seq) + parseInt(c.carton_count || 1) - 1
  const seqLabel = parseInt(c.carton_count) > 1 ? `${c.carton_seq}–${seqEnd}` : `CTN ${c.carton_seq}`

  function patchDims(field, val) {
    const updated = { ...c, [field]: val === '' ? null : parseFloat(val) || null }
    const l = parseFloat(updated.length_cm), w = parseFloat(updated.width_cm), h = parseFloat(updated.height_cm)
    onChange({ ...updated, cbm_per_carton: l && w && h ? Math.round(l * w * h / 1e6 * 1e6) / 1e6 : c.cbm_per_carton, is_estimate: false })
  }
  const cbm = derivedCbm(c)

  function addItem() { onChange({ ...c, contents: [...(c.contents || []), newContent()] }) }
  function updateItem(i, patch) {
    onChange({ ...c, contents: c.contents.map((it, j) => j === i ? { ...it, ...patch } : it) })
  }
  function removeItem(i) { onChange({ ...c, contents: c.contents.filter((_, j) => j !== i) }) }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden mb-3">
      {/* Carton header */}
      <div className="bg-gray-50 px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-gray-700 min-w-[70px]">{seqLabel}</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500">GW</span>
            <input
              className={`input py-1 text-xs w-20 text-right ${c.gw_kg_actual !== null ? 'border-green-400' : ''}`}
              type="number" step="0.1" min="0" placeholder="kg"
              value={c.gw_kg_actual ?? c.gw_kg_standard ?? ''}
              onChange={e => onChange({ ...c, gw_kg_actual: e.target.value === '' ? null : parseFloat(e.target.value) || null, is_estimate: false })}
            />
            <span className="text-xs text-gray-400">kg</span>
          </div>
          <div className="flex items-center gap-1">
            {(['length_cm','width_cm','height_cm']).map(f => (
              <input
                key={f}
                className={`input py-1 text-xs w-14 text-right ${!c.is_estimate ? 'border-green-400' : ''}`}
                type="number" step="0.1" min="0" placeholder={f==='length_cm'?'L':f==='width_cm'?'W':'H'}
                value={c[f] ?? ''}
                onChange={e => patchDims(f, e.target.value)}
              />
            ))}
            <span className="text-xs text-gray-400">cm</span>
          </div>
          {cbm > 0 && <span className="text-xs text-gray-500">{cbm.toFixed(4)} CBM</span>}
          {c.is_estimate
            ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">Est</span>
            : <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">Actual</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500">× Ctns</span>
            <input
              className="input py-1 text-xs w-14 text-right"
              type="number" min="1"
              value={c.carton_count || 1}
              onChange={e => onChange({ ...c, carton_count: parseInt(e.target.value) || 1 })}
            />
          </div>
          <button type="button" onClick={onRemove} className="text-gray-300 hover:text-red-500 ml-2">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {/* Contents */}
      <div className="px-4 py-2 space-y-1.5">
        {(c.contents || []).map((item, i) => (
          <div key={item._localId || i} className="flex items-center gap-2">
            <input
              className="input py-1 text-xs font-mono w-28"
              value={item.item_code} placeholder="Item code"
              onChange={e => updateItem(i, { item_code: e.target.value })}
            />
            <input
              className="input py-1 text-xs flex-1"
              value={item.description} placeholder="Description"
              onChange={e => updateItem(i, { description: e.target.value })}
            />
            <input
              className="input py-1 text-xs w-20 text-right"
              type="number" min="0" value={item.qty} placeholder="Qty"
              onChange={e => updateItem(i, { qty: e.target.value })}
            />
            <span className="text-xs text-gray-400">pcs</span>
            <button type="button" onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="mt-1 flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800"
        >
          <Plus size={12} /> Add item
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PackingListEditor({ orderId, orderLines }) {
  const packableLines = useMemo(() => (orderLines || []).filter(l => l.packable), [orderLines])
  const unclassified  = useMemo(() => (orderLines || []).filter(l => !l.line_type).length, [orderLines])

  const [pl, setPl]             = useState(null)       // packing_list doc
  const [cartons, setCartons]   = useState([])          // carton rows with contents
  const [mode, setMode]         = useState('full_carton')
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [rangeProducts, setRangeProducts] = useState([])
  const [error, setError]       = useState('')

  // Load packing list + range products
  useEffect(() => {
    if (!orderId) return
    let alive = true
    ;(async () => {
      const [found, products] = await Promise.all([
        getPackingListByOrder(orderId),
        loadRangeProductsWithPacking(),
      ])
      if (!alive) return
      setRangeProducts(products)
      if (found) {
        setPl(found)
        setMode(found.mode || 'full_carton')
        setCartons(await getCartonsWithContents(found.id))
      }
      setLoading(false)
    })()
    return () => { alive = false }
  }, [orderId])

  // Re-sequence carton_seq across all cartons whenever carton_count changes
  function resequence(rows) {
    let seq = 1
    return rows.map(c => {
      const r = { ...c, carton_seq: seq }
      seq += parseInt(c.carton_count) || 1
      return r
    })
  }

  function updateCarton(localId, patch) {
    setCartons(prev => resequence(prev.map(c => c._localId === localId ? { ...c, ...patch } : c)))
  }
  function removeCarton(localId) {
    setCartons(prev => resequence(prev.filter(c => c._localId !== localId)))
  }
  function addCarton() {
    setCartons(prev => {
      const seq = nextSeq(prev)
      return [...prev, newCarton(seq)]
    })
  }

  async function generateFromStandard() {
    const plan = buildFullCartonPlan(packableLines, rangeProducts)
    setCartons(plan)
    setMode('full_carton')
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave(promoteToFinal = false) {
    setError('')
    if (promoteToFinal) {
      const pvO = calcPackedVsOrdered(packableLines, cartons)
      if (pvO.some(r => r.packed !== r.ordered)) {
        setError('Cannot mark Final — quantity mismatch. Resolve packed vs ordered first.')
        return
      }
      if (cartons.some(c => c.is_estimate)) {
        setError('Cannot mark Final — some cartons still have estimated dimensions. Enter actual measurements.')
        return
      }
    }
    setSaving(true)
    try {
      let plId = pl?.id
      if (!plId) {
        plId = await createPackingList(orderId, { mode })
        const found = await getPackingListByOrder(orderId)
        setPl(found)
      }
      if (mode !== pl?.mode || promoteToFinal !== (pl?.status === 'final')) {
        await updatePackingList(plId, {
          mode,
          status: promoteToFinal ? 'final' : (pl?.status || 'estimate'),
        })
        setPl(p => ({ ...p, mode, status: promoteToFinal ? 'final' : (p?.status || 'estimate') }))
      }
      await saveCartonsWithContents(plId, cartons)
      // Reload cartons to get Firestore IDs
      const fresh = await getCartonsWithContents(plId)
      setCartons(fresh)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  // ── Derived totals ────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let totalCartons = 0, totalCbm = 0, totalGw = 0
    for (const c of cartons) {
      const count = parseInt(c.carton_count) || 1
      totalCartons += count
      totalCbm += (derivedCbm(c) || 0) * count
      totalGw  += ((parseFloat(c.gw_kg_actual) ?? parseFloat(c.gw_kg_standard) ?? 0)) * count
    }
    return { totalCartons, totalCbm: Math.round(totalCbm * 1e4) / 1e4, totalGw: Math.round(totalGw * 10) / 10 }
  }, [cartons])

  const pvORows   = useMemo(() => calcPackedVsOrdered(packableLines, cartons), [packableLines, cartons])
  const pvOAllOk  = pvORows.every(r => r.packed === r.ordered)
  const allActual = cartons.length > 0 && cartons.every(c => !c.is_estimate)
  const canFinal  = pvOAllOk && allActual && cartons.length > 0

  // ── Render ────────────────────────────────────────────────────────────────
  if (unclassified > 0) {
    return (
      <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700 flex items-center gap-2">
        <AlertTriangle size={16} />
        Classify all order lines before building the packing list.
        ({unclassified} line{unclassified > 1 ? 's' : ''} need a type)
      </div>
    )
  }

  if (loading) return <div className="py-8 text-center text-sm text-gray-400">Loading packing list…</div>

  if (!pl && cartons.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center">
        <Package size={36} strokeWidth={1.25} className="mx-auto mb-3 text-gray-300" />
        <p className="text-gray-500 text-sm mb-1">No packing list yet for this shipment.</p>
        <p className="text-xs text-gray-400 mb-5">
          {packableLines.length} packable line{packableLines.length !== 1 ? 's' : ''} from the order will be included.
        </p>
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={generateFromStandard}
            className="btn-primary"
            disabled={!packableLines.length}
          >
            Generate from standard packing
          </button>
          <button
            type="button"
            onClick={() => { setCartons([newCarton(1)]); setMode('mixed') }}
            className="btn-secondary"
          >
            Start manually (mixed mode)
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {PACK_MODES.map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                mode === m.value
                  ? 'bg-ink text-white border-ink'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={generateFromStandard}
          className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-800 ml-1"
          title="Replace current cartons with standard-packing pre-fill"
        >
          <RefreshCw size={13} /> Re-generate from standard
        </button>
        <div className="ml-auto flex items-center gap-2">
          {pl?.status && <StatusBadge status={pl.status} />}
          <span className="text-xs text-gray-400">
            {totals.totalCartons} CTN · {totals.totalCbm} CBM · {totals.totalGw} kg GW
          </span>
        </div>
      </div>

      {/* ── Full-carton table ── */}
      {mode === 'full_carton' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-3 py-2 text-left">CTN No</th>
                <th className="px-3 py-2 text-left">Item Code</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Pcs/Ctn</th>
                <th className="px-3 py-2 text-right">Ctns</th>
                <th className="px-3 py-2 text-right">GW (kg)</th>
                <th className="px-3 py-2 text-left">L × W × H (cm)</th>
                <th className="px-3 py-2 text-right">CBM</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {cartons.map((c, i) => (
                <FullCartonRow
                  key={c._localId}
                  carton={c}
                  idx={i}
                  onChange={patch => updateCarton(c._localId, patch)}
                  onRemove={() => removeCarton(c._localId)}
                  packableLines={packableLines}
                />
              ))}
            </tbody>
            {cartons.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 text-xs font-medium text-gray-700">
                  <td colSpan={4} className="px-3 py-2" />
                  <td className="px-3 py-2 text-right">{totals.totalCartons}</td>
                  <td className="px-3 py-2 text-right">{totals.totalGw} kg</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right">{totals.totalCbm}</td>
                  <td colSpan={2} className="px-3 py-2" />
                </tr>
              </tfoot>
            )}
          </table>
          <div className="px-4 py-3 border-t border-gray-100">
            <button
              type="button"
              onClick={addCarton}
              className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800"
            >
              <Plus size={14} /> Add carton row
            </button>
          </div>
        </div>
      )}

      {/* ── Mixed mode cards ── */}
      {mode === 'mixed' && (
        <div>
          {cartons.map(c => (
            <MixedCartonCard
              key={c._localId}
              carton={c}
              onChange={patch => updateCarton(c._localId, patch)}
              onRemove={() => removeCarton(c._localId)}
              packableLines={packableLines}
            />
          ))}
          <button
            type="button"
            onClick={addCarton}
            className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-800 mt-2"
          >
            <Plus size={15} /> Add carton
          </button>
        </div>
      )}

      {/* ── Packed vs ordered ── */}
      {packableLines.length > 0 && cartons.length > 0 && (
        <PackedVsOrdered packableLines={packableLines} cartons={cartons} />
      )}

      {/* ── Actions ── */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => handleSave(false)}
          disabled={saving || cartons.length === 0}
          className="btn-primary disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save packing list'}
        </button>
        <button
          type="button"
          onClick={() => handleSave(true)}
          disabled={saving || !canFinal || pl?.status === 'final'}
          className={`btn-secondary disabled:opacity-40 ${canFinal && pl?.status !== 'final' ? 'border-green-500 text-green-700 hover:bg-green-50' : ''}`}
          title={
            !pvOAllOk ? 'Quantity mismatch — check packed vs ordered'
            : !allActual ? 'Enter actual dimensions for all cartons'
            : pl?.status === 'final' ? 'Already marked as Final'
            : 'Mark as Final'
          }
        >
          Mark as Final
        </button>
        {saved && <span className="text-xs text-green-600">Saved ✓</span>}
        {!canFinal && cartons.length > 0 && pl?.status !== 'final' && (
          <span className="text-xs text-gray-400">
            {!pvOAllOk ? 'Qty mismatch · ' : ''}{!allActual ? 'Enter actual dims to finalise' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
