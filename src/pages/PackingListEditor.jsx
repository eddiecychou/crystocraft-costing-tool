import { useState, useEffect, useMemo } from 'react'
import { CheckCircle2, AlertTriangle, Plus, Trash2, RefreshCw, Package, Star, Pencil, Copy, FileText } from 'lucide-react'
import {
  PL_STATUSES, CARTON_MODES,
  buildFullCartonPlan, calcPackedVsOrdered, derivedCbm,
  loadRangeProductsWithPacking,
  getPackingScenariosByOrder, createPackingList, updatePackingList,
  selectScenario, deleteScenario,
  saveCartonsWithContents, getCartonsWithContents,
  PALLET_WEIGHT_KG, palletDimCbm, palletisedTotals,
} from '../packing'

// ── Helpers ───────────────────────────────────────────────────────────────────
function newCarton(seq = 1, pack_mode = 'single') {
  return {
    _localId: crypto.randomUUID(), id: null,
    carton_seq: seq, carton_count: 1,
    pallet_no: 1,
    pack_mode,
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

// ── Per-carton card ───────────────────────────────────────────────────────────
function LinePicker({ packableLines, orderLineId, itemCode, onSelect }) {
  if (!packableLines?.length) return null
  const matchedId = orderLineId ||
    packableLines.find(l => l.item_code && l.item_code === itemCode)?.id || ''
  return (
    <select
      className="input py-1 text-xs w-44 shrink-0"
      value={matchedId}
      onChange={e => {
        const line = packableLines.find(l => l.id === e.target.value)
        onSelect(line || null)
      }}
      title="Pick from order lines — auto-fills code & description"
    >
      <option value="">– free text –</option>
      {packableLines.map(l => (
        <option key={l.id} value={l.id}>
          {[l.item_code, l.description].filter(Boolean).join(' · ')}
        </option>
      ))}
    </select>
  )
}

function CartonCard({ carton, packableLines, palletCount, onChange, onRemove }) {
  const c = carton
  const mode = c.pack_mode === 'mixed' ? 'mixed' : 'single'
  const seqEnd = parseInt(c.carton_seq) + parseInt(c.carton_count || 1) - 1
  const seqLabel = parseInt(c.carton_count) > 1 ? `CTN ${c.carton_seq}–${seqEnd}` : `CTN ${c.carton_seq}`
  const cbm = derivedCbm(c)
  const contents = c.contents?.length ? c.contents : [newContent()]
  const extraItems = Math.max(0, contents.length - 1)

  function patchDims(field, val) {
    const updated = { ...c, [field]: val === '' ? null : parseFloat(val) || null }
    const l = parseFloat(updated.length_cm), w = parseFloat(updated.width_cm), h = parseFloat(updated.height_cm)
    onChange({ ...updated, cbm_per_carton: l && w && h ? Math.round(l * w * h / 1e6 * 1e6) / 1e6 : c.cbm_per_carton, is_estimate: false })
  }
  function patchFirstContent(patch) {
    onChange({ ...c, contents: contents.map((it, i) => (i === 0 ? { ...it, ...patch } : it)) })
  }
  function setMode(next) {
    onChange({ ...c, pack_mode: next, contents: c.contents?.length ? c.contents : [newContent()] })
  }
  function addItem() { onChange({ ...c, contents: [...contents, newContent()] }) }
  function updateItem(i, patch) { onChange({ ...c, contents: contents.map((it, j) => (j === i ? { ...it, ...patch } : it)) }) }
  function removeItem(i) {
    const next = contents.filter((_, j) => j !== i)
    onChange({ ...c, contents: next.length ? next : [newContent()] })
  }

  // Build pallet number options: at least 1..current, plus up to palletCount
  const maxPallet = Math.max(palletCount, parseInt(c.pallet_no) || 1)
  const palletOptions = Array.from({ length: maxPallet }, (_, i) => i + 1)

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden mb-3">
      {/* Carton header */}
      <div className="bg-gray-50 px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-gray-700 min-w-[78px]">{seqLabel}</span>

        {/* Pallet assignment */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Plt</span>
          <select
            className="input py-1 text-xs w-14"
            value={c.pallet_no || 1}
            onChange={e => onChange({ ...c, pallet_no: parseInt(e.target.value) || 1 })}
            title="Pallet number"
          >
            {palletOptions.map(n => <option key={n} value={n}>{n}</option>)}
            <option value={maxPallet + 1}>+ new</option>
          </select>
        </div>

        {/* Per-carton mode toggle */}
        <div className="flex rounded-md border border-gray-200 overflow-hidden text-[11px]">
          {CARTON_MODES.map(m => (
            <button key={m.value} type="button" onClick={() => setMode(m.value)} title={m.desc}
              className={`px-2 py-1 font-medium transition-colors ${mode === m.value ? 'bg-ink text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500">GW</span>
            <input
              className={`input py-1 text-xs w-20 text-right ${c.gw_kg_actual !== null ? 'border-green-400' : ''}`}
              type="number" step="0.1" min="0" placeholder="kg"
              value={c.gw_kg_actual ?? c.gw_kg_standard ?? ''}
              onChange={e => onChange({ ...c, gw_kg_actual: e.target.value === '' ? null : parseFloat(e.target.value) || null, is_estimate: false })}
              title={c.gw_kg_standard ? `Standard: ${c.gw_kg_standard} kg` : ''}
            />
            <span className="text-xs text-gray-400">kg</span>
          </div>
          <div className="flex items-center gap-1">
            {(['length_cm','width_cm','height_cm']).map(f => (
              <input
                key={f}
                className={`input py-1 text-xs w-14 text-right ${!c.is_estimate ? 'border-green-400' : ''}`}
                type="number" step="0.1" min="0" placeholder={f === 'length_cm' ? 'L' : f === 'width_cm' ? 'W' : 'H'}
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
      {mode === 'single' ? (
        <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap">
          <LinePicker
            packableLines={packableLines}
            orderLineId={contents[0]?.order_line_id}
            itemCode={contents[0]?.item_code}
            onSelect={line => patchFirstContent(line
              ? { item_code: line.item_code || '', description: line.description || '', order_line_id: line.id }
              : { order_line_id: '' }
            )}
          />
          <input
            className="input py-1 text-xs font-mono w-32"
            value={contents[0]?.item_code || ''} placeholder="Item code"
            onChange={e => patchFirstContent({ item_code: e.target.value })}
          />
          <input
            className="input py-1 text-xs flex-1 min-w-[120px]"
            value={contents[0]?.description || ''} placeholder="Description"
            onChange={e => patchFirstContent({ description: e.target.value })}
          />
          <input
            className="input py-1 text-xs w-20 text-right"
            type="number" min="0" value={contents[0]?.qty || ''} placeholder="Pcs/ctn"
            onChange={e => patchFirstContent({ qty: e.target.value })}
          />
          <span className="text-xs text-gray-400">pcs</span>
          {extraItems > 0 && (
            <button type="button" onClick={() => setMode('mixed')}
              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200"
              title="This carton holds more items — switch to mixed to see them all">
              +{extraItems} more — show
            </button>
          )}
        </div>
      ) : (
        <div className="px-4 py-2 space-y-1.5">
          {contents.map((item, i) => (
            <div key={item._localId || i} className="flex items-center gap-2 flex-wrap">
              <LinePicker
                packableLines={packableLines}
                orderLineId={item.order_line_id}
                itemCode={item.item_code}
                onSelect={line => updateItem(i, line
                  ? { item_code: line.item_code || '', description: line.description || '', order_line_id: line.id }
                  : { order_line_id: '' }
                )}
              />
              <input
                className="input py-1 text-xs font-mono w-32"
                value={item.item_code} placeholder="Item code"
                onChange={e => updateItem(i, { item_code: e.target.value })}
              />
              <input
                className="input py-1 text-xs flex-1 min-w-[120px]"
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
          <button type="button" onClick={addItem} className="mt-1 flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800">
            <Plus size={12} /> Add item
          </button>
        </div>
      )}
    </div>
  )
}

// ── Pallets dimensions editor ─────────────────────────────────────────────────
function PalletsEditor({ pallets, onChange }) {
  // pallets: [{ pallet_no, length_m, width_m, height_m }]
  function update(no, field, val) {
    const exists = pallets.find(p => p.pallet_no === no)
    if (exists) {
      onChange(pallets.map(p => p.pallet_no === no ? { ...p, [field]: val } : p))
    } else {
      onChange([...pallets, { pallet_no: no, length_m: '', width_m: '', height_m: '', [field]: val }])
    }
  }
  function get(no, field) {
    return pallets.find(p => p.pallet_no === no)?.[field] ?? ''
  }

  return { update, get }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PackingListEditor({ orderId, orderLines }) {
  const packableLines = useMemo(() => (orderLines || []).filter(l => l.packable), [orderLines])
  const unclassified  = useMemo(() => (orderLines || []).filter(l => !l.line_type).length, [orderLines])

  const [scenarios, setScenarios] = useState([])
  const [activeId, setActiveId]   = useState(null)
  const [cartons, setCartons]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [rangeProducts, setRangeProducts] = useState([])
  const [error, setError]         = useState('')

  // Per-scenario header fields
  const [shippedPer, setShippedPer] = useState('')
  const [pallets, setPallets]       = useState([])   // [{ pallet_no, length_m, width_m, height_m }]

  const pl = useMemo(() => scenarios.find(s => s.id === activeId) || null, [scenarios, activeId])

  // Unique pallet numbers in use
  const palletNums = useMemo(() => {
    const nums = new Set(cartons.map(c => parseInt(c.pallet_no) || 1))
    return Array.from(nums).sort((a, b) => a - b)
  }, [cartons])

  // Load all scenarios + range products
  useEffect(() => {
    if (!orderId) return
    let alive = true
    ;(async () => {
      const [rows, products] = await Promise.all([
        getPackingScenariosByOrder(orderId),
        loadRangeProductsWithPacking(),
      ])
      if (!alive) return
      setRangeProducts(products)
      setScenarios(rows)
      if (rows.length) {
        const active = rows.find(r => r.selected) || rows[0]
        setActiveId(active.id)
        setShippedPer(active.shipped_per || '')
        setPallets(active.pallets || [])
        setCartons(await getCartonsWithContents(active.id))
      }
      setLoading(false)
    })()
    return () => { alive = false }
  }, [orderId])

  async function switchScenario(id) {
    if (id === activeId) return
    setActiveId(id)
    setError(''); setSaved(false)
    const scenario = scenarios.find(s => s.id === id)
    setShippedPer(scenario?.shipped_per || '')
    setPallets(scenario?.pallets || [])
    setCartons(await getCartonsWithContents(id))
  }

  async function createScenario(label, startCartons = []) {
    const selected = scenarios.length === 0
    const id = await createPackingList(orderId, { label, selected })
    const rows = await getPackingScenariosByOrder(orderId)
    setScenarios(rows)
    setActiveId(id)
    setShippedPer('')
    setPallets([])
    setCartons(startCartons)
    return id
  }

  async function duplicateScenario() {
    if (!pl) return
    const copyCartons = cartons.map(c => ({
      ...c, _localId: crypto.randomUUID(), id: null,
      contents: (c.contents || []).map(it => ({ ...it, _localId: crypto.randomUUID(), id: null })),
    }))
    await createScenario(`${pl.label} copy`, copyCartons)
  }

  async function renameScenario(id, label) {
    await updatePackingList(id, { label })
    setScenarios(prev => prev.map(s => (s.id === id ? { ...s, label } : s)))
  }

  async function chooseScenario(id) {
    await selectScenario(orderId, id)
    setScenarios(prev => prev.map(s => ({ ...s, selected: s.id === id })))
  }

  async function removeScenario(id) {
    if (!confirm('Delete this packing scenario and all its cartons? This cannot be undone.')) return
    await deleteScenario(id)
    const rows = await getPackingScenariosByOrder(orderId)
    setScenarios(rows)
    if (id === activeId) {
      if (rows.length) {
        setActiveId(rows[0].id)
        setShippedPer(rows[0].shipped_per || '')
        setPallets(rows[0].pallets || [])
        setCartons(await getCartonsWithContents(rows[0].id))
      } else {
        setActiveId(null); setCartons([])
        setShippedPer(''); setPallets([])
      }
    }
  }

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
      const lastPallet = prev.length ? (parseInt(prev[prev.length - 1].pallet_no) || 1) : 1
      return [...prev, { ...newCarton(seq), pallet_no: lastPallet }]
    })
  }

  async function generateFromStandard() {
    const plan = buildFullCartonPlan(packableLines, rangeProducts).map(c => ({ ...c, pack_mode: 'single', pallet_no: 1 }))
    if (!activeId) await createScenario('Standard carton', plan)
    else setCartons(plan)
  }

  // ── Pallet helpers ────────────────────────────────────────────────────────
  const { update: updatePallet, get: getPallet } = PalletsEditor({ pallets, onChange: setPallets })

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
      let plId = activeId
      if (!plId) plId = await createScenario(pl?.label || 'Standard carton', cartons)
      const status = promoteToFinal ? 'final' : (pl?.status || 'estimate')
      await updatePackingList(plId, {
        status,
        shipped_per: shippedPer,
        pallets,
        totals: { carton_count: totals.totalCartons, cbm: totals.totalCbm, chargeable_weight_kg: totals.totalGw },
      })
      await saveCartonsWithContents(plId, cartons)
      const [fresh, rows] = await Promise.all([getCartonsWithContents(plId), getPackingScenariosByOrder(orderId)])
      setCartons(fresh)
      setScenarios(rows)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  // ── Derived totals ────────────────────────────────────────────────────────
  // Palletised: a pallet with L×W×H entered ships at that wrapped volume (not the
  // loose carton sum) and adds one pallet's timber weight (8kg). Shared with the
  // printed PDF so the editor and the document always agree.
  const totals = useMemo(() => palletisedTotals(cartons, pallets), [cartons, pallets])

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

  if (!scenarios.length && cartons.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center">
        <Package size={36} strokeWidth={1.25} className="mx-auto mb-3 text-gray-300" />
        <p className="text-gray-500 text-sm mb-1">No packing scenario yet for this shipment.</p>
        <p className="text-xs text-gray-400 mb-5">
          {packableLines.length} packable line{packableLines.length !== 1 ? 's' : ''} from the order will be included.
          You can pack it more than one way (e.g. Standard carton vs Flat pack) and compare.
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
            onClick={() => createScenario('Standard carton', [newCarton(1, 'mixed')])}
            className="btn-secondary"
          >
            Start manually (mixed carton)
          </button>
        </div>
      </div>
    )
  }

  const SOFT_CAP = 3

  return (
    <div className="space-y-5">
      {/* Scenario switcher */}
      <div className="flex flex-wrap items-center gap-2">
        {scenarios.map(s => {
          const isActive = s.id === activeId
          return (
            <div key={s.id}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                isActive ? 'border-ink bg-ink/5' : 'border-gray-200 hover:border-gray-400'}`}>
              <button type="button" onClick={() => chooseScenario(s.id)}
                title={s.selected ? 'Selected plan (used for export/shipment)' : 'Use this scenario as the selected plan'}
                className={s.selected ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}>
                <Star size={14} className={s.selected ? 'fill-current' : ''} />
              </button>
              <button type="button" onClick={() => switchScenario(s.id)} className="font-medium text-gray-700">
                {s.label}
              </button>
              <button type="button" onClick={() => { const l = prompt('Rename scenario', s.label); if (l && l.trim()) renameScenario(s.id, l.trim()) }}
                className="text-gray-300 hover:text-brand-600" title="Rename"><Pencil size={12} /></button>
              {scenarios.length > 1 && (
                <button type="button" onClick={() => removeScenario(s.id)} className="text-gray-300 hover:text-red-500" title="Delete scenario"><Trash2 size={12} /></button>
              )}
            </div>
          )
        })}
        {scenarios.length < SOFT_CAP && (
          <button type="button" onClick={() => createScenario(`Scenario ${scenarios.length + 1}`, [newCarton(1)])}
            className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-2.5 py-1.5 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600">
            <Plus size={13} /> New scenario
          </button>
        )}
        {pl && (
          <button type="button" onClick={duplicateScenario}
            className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800" title="Duplicate this scenario as a starting point">
            <Copy size={12} /> Duplicate
          </button>
        )}
        {scenarios.length >= SOFT_CAP && (
          <span className="text-[11px] text-gray-400">Keep scenarios to a few for a clean comparison.</span>
        )}
      </div>

      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={generateFromStandard}
          className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-800"
          title="Replace current cartons with standard-packing pre-fill"
        >
          <RefreshCw size={13} /> Re-generate from standard
        </button>
        <div className="ml-auto flex items-center gap-2">
          {pl?.status && <StatusBadge status={pl.status} />}
          <span className="text-xs text-gray-400">
            {totals.totalCartons} CTN
            {totals.palletCount > 0
              ? <> · cartons {totals.cartonCbm}/pallet {totals.totalCbm} CBM · {totals.totalGw} kg GW <span className="text-gray-300">(incl. {totals.palletCount}×{PALLET_WEIGHT_KG}kg pallet)</span></>
              : <> · {totals.totalCbm} CBM · {totals.totalGw} kg GW</>}
          </span>
        </div>
      </div>

      {/* Shipped Per (vessel / carrier) */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 whitespace-nowrap">Shipped per (vessel / carrier)</label>
        <input
          className="input py-1 text-sm flex-1 max-w-xs"
          value={shippedPer}
          onChange={e => setShippedPer(e.target.value)}
          placeholder="e.g. CMA CGM MARCO POLO"
        />
      </div>

      {/* ── Cartons (per-carton single/mixed mode) ── */}
      <div>
        {cartons.map(c => (
          <CartonCard
            key={c._localId}
            carton={c}
            packableLines={packableLines}
            palletCount={palletNums.length}
            onChange={patch => updateCarton(c._localId, patch)}
            onRemove={() => removeCarton(c._localId)}
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

      {/* ── Pallet dimensions ── */}
      {palletNums.length > 0 && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">Pallet dimensions</p>
          <div className="space-y-2">
            {palletNums.map(no => {
              const palletCartons = cartons.filter(c => (parseInt(c.pallet_no) || 1) === no)
              const firstSeq = palletCartons[0]?.carton_seq ?? '—'
              const lastCarton = palletCartons[palletCartons.length - 1]
              const lastSeq = lastCarton
                ? (parseInt(lastCarton.carton_seq) || 0) + (parseInt(lastCarton.carton_count) || 1) - 1
                : '—'
              const palletCbm = palletCartons.reduce((s, c) => s + (derivedCbm(c) || 0) * (parseInt(c.carton_count) || 1), 0)
              const palletCtns = palletCartons.reduce((s, c) => s + (parseInt(c.carton_count) || 1), 0)
              const dimCbm = palletDimCbm(pallets.find(p => (parseInt(p.pallet_no) || 1) === no))
              return (
                <div key={no} className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-gray-600 w-20 shrink-0">Pallet {no}</span>
                  <span className="text-xs text-gray-400 w-44 shrink-0">
                    CTN {firstSeq}–{lastSeq} ({palletCtns} ctns)
                    {dimCbm != null
                      ? <> · <span className="text-gray-600 font-medium">{dimCbm.toFixed(4)} CBM</span> <span className="text-gray-300 line-through">{palletCbm.toFixed(4)}</span></>
                      : <> · {palletCbm.toFixed(4)} CBM</>}
                  </span>
                  <div className="flex items-center gap-1">
                    {(['length_m','width_m','height_m']).map((f, fi) => (
                      <input
                        key={f}
                        className="input py-1 text-xs w-16 text-right"
                        type="number" step="0.01" min="0"
                        placeholder={['L','W','H'][fi]}
                        value={getPallet(no, f)}
                        onChange={e => updatePallet(no, f, e.target.value)}
                      />
                    ))}
                    <span className="text-xs text-gray-400">m</span>
                  </div>
                  {getPallet(no, 'length_m') && getPallet(no, 'width_m') && getPallet(no, 'height_m') && (
                    <span className="text-xs text-gray-500">
                      {getPallet(no, 'length_m')} × {getPallet(no, 'width_m')} × {getPallet(no, 'height_m')} m
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-gray-400">Pallet dimensions print on the exported PDF.</p>
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
        {activeId && (
          <button
            type="button"
            onClick={() => window.open(`/packing/${activeId}/print`, '_blank')}
            className="flex items-center gap-1.5 btn-secondary"
            title="Export as PDF"
          >
            <FileText size={14} /> Export PDF
          </button>
        )}
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
