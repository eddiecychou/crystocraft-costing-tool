import { Gem, Plus, X, AlertTriangle, Sparkles } from 'lucide-react'
import { SHAPES, parseCrystalCode, totalStones, isMixCode } from '../crystalBom'

// Editor for a product's crystal BOM.
//
// Two halves, because crystals work in two layers:
//
//   Positions  how many stones of each shape and size the model takes, whatever
//              colour it is made in. A Fan-Out Peacock is always 13 octagon/14
//              and 9 chaton/18 — the ERP agreed across 185 job orders spanning
//              twenty years.
//   Mixes      how those stones split across colours for a mix code. Only mixes
//              need this: a mono colourway is every position in one colour,
//              which is a rule rather than data.
//
// Most of this was derived from the ERP, so the job here is correcting the
// handful that are wrong and filling the ones nobody ever ordered — not typing
// it all in.

const shapeLabel = { octagon: 'Octagon', chaton: 'Chaton', heart: 'Heart' }

export default function CrystalBomEditor({ bom, onChange, crystals = [], mixCodes = [] }) {
  const positions = bom?.positions || []
  const mixes = bom?.mixes || {}
  const byCode = new Map(crystals.map(c => [String(c.code || '').toUpperCase(), c]))

  const set = patch => onChange({ ...bom, ...patch, source: 'manual' })

  const setPosition = (i, key, value) =>
    set({ positions: positions.map((p, j) => (j === i ? { ...p, [key]: value } : p)) })
  const addPosition = () => set({ positions: [...positions, { shape: 'octagon', size: '', qty: 1 }] })
  const removePosition = i => set({ positions: positions.filter((_, j) => j !== i) })

  const setMixLine = (code, i, key, value) =>
    set({ mixes: { ...mixes, [code]: mixes[code].map((l, j) => (j === i ? { ...l, [key]: value } : l)) } })
  const addMixLine = code => set({ mixes: { ...mixes, [code]: [...(mixes[code] || []), { code: '', qty: 1 }] } })
  const removeMixLine = (code, i) =>
    set({ mixes: { ...mixes, [code]: mixes[code].filter((_, j) => j !== i) } })
  const addMix = code => set({ mixes: { ...mixes, [code]: [] } })
  const removeMix = code => {
    const next = { ...mixes }; delete next[code]; set({ mixes: next })
  }

  const total = totalStones(bom)
  const addable = mixCodes.filter(c => !(c in mixes))

  // A mix should account for exactly as many stones as the model has positions.
  // Anything else is a recipe that will over- or under-order.
  const mixTotal = code => (mixes[code] || []).reduce((n, l) => n + (Number(l.qty) || 0), 0)

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base flex items-center gap-2">
          <Gem size={18} className="text-brand-500" />Crystal BOM
        </h2>
        {bom?.source === 'erp' && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-ivory text-ink-60 inline-flex items-center gap-1">
            <Sparkles size={11} />derived from ERP
          </span>
        )}
      </div>
      <p className="text-xs text-ink-60 mb-4">
        How many stones this model takes, and how a mix splits them across colours.
        A plain colour needs no recipe — every position is that colour. Plating does
        not affect crystals, so this is shared across all variations.
      </p>

      {/* ---- positions ---- */}
      <div className="flex items-baseline justify-between">
        <label className="text-[11px] uppercase tracking-wide text-ink-50">Stones per unit</label>
        <span className="text-[11px] text-ink-50 tabular-nums">{total} total</span>
      </div>

      <div className="mt-2 space-y-2">
        {positions.length === 0 && (
          <p className="text-xs text-ink-50">No positions yet — add one below.</p>
        )}
        {positions.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <select className="input text-xs py-1 w-32 shrink-0" value={p.shape}
                    onChange={e => setPosition(i, 'shape', e.target.value)}>
              {SHAPES.map(s => <option key={s} value={s}>{shapeLabel[s] || s}</option>)}
            </select>
            <input className="input text-xs py-1 w-24 shrink-0" placeholder="size" value={p.size}
                   onChange={e => setPosition(i, 'size', e.target.value)}
                   title="Stone size as the ERP writes it — 14, 18, 26, SS29" />
            <input type="number" min="0" step="1" className="input text-xs py-1 w-20 shrink-0 tabular-nums"
                   value={p.qty} onChange={e => setPosition(i, 'qty', Number(e.target.value) || 0)} />
            <span className="text-ink-50">per unit</span>
            <button type="button" onClick={() => removePosition(i)}
                    className="ml-auto text-red-400 hover:text-red-600" title="Remove position">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addPosition}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-50 hover:text-brand-600">
        <Plus size={12} />Add position
      </button>

      {/* ---- mixes ---- */}
      <div className="mt-5 pt-4 border-t border-ivory-dark">
        <label className="text-[11px] uppercase tracking-wide text-ink-50">Mix recipes</label>
        <p className="text-[11px] text-ink-50 mt-0.5 mb-2">
          Only for mix codes (MX, M1, AX, GX…). Each line is a real crystal code and how
          many of it go into one unit.
        </p>

        <div className="space-y-3">
          {Object.keys(mixes).length === 0 && (
            <p className="text-xs text-ink-50">No mix recipes. Add one below if this model is sold in a mix.</p>
          )}
          {Object.entries(mixes).map(([code, lines]) => {
            const sum = mixTotal(code)
            const mismatch = total > 0 && sum !== total
            return (
              <div key={code} className="border border-ink-10 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-ink-80">{code}</span>
                    <span className={`text-[11px] tabular-nums ${mismatch ? 'text-amber-600' : 'text-ink-50'}`}>
                      {sum} of {total} stones
                    </span>
                    {mismatch && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-600" title="This recipe does not add up to the model's stone count">
                        <AlertTriangle size={12} />doesn't add up
                      </span>
                    )}
                  </div>
                  <button type="button" onClick={() => removeMix(code)}
                          className="text-red-400 hover:text-red-600" title="Remove this recipe"><X size={15} /></button>
                </div>

                <div className="space-y-1.5">
                  {lines.length === 0 && (
                    <p className="text-[11px] text-ink-50">Empty — nobody has ordered this mix yet. Add the crystals it uses.</p>
                  )}
                  {lines.map((l, i) => {
                    const known = byCode.get(String(l.code || '').toUpperCase())
                    const parsed = parseCrystalCode(l.code)
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <input
                          className={`input text-xs py-1 font-mono w-52 shrink-0 ${!known && l.code ? 'border-amber-400' : ''}`}
                          placeholder="C01-1028-18-002" value={l.code}
                          onChange={e => setMixLine(code, i, 'code', e.target.value.toUpperCase())} />
                        <input type="number" min="0" step="1"
                               className="input text-xs py-1 w-16 shrink-0 tabular-nums"
                               value={l.qty} onChange={e => setMixLine(code, i, 'qty', Number(e.target.value) || 0)} />
                        <span className="flex-1 min-w-0 truncate text-ink-60" title={known?.name || ''}>
                          {known
                            ? known.name
                            : l.code
                              ? <span className="text-amber-600 inline-flex items-center gap-1">
                                  <AlertTriangle size={11} />not in crystal stock
                                </span>
                              : ''}
                        </span>
                        {parsed?.shape && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ivory text-ink-50 shrink-0">
                            {shapeLabel[parsed.shape] || parsed.shape} {parsed.size}
                          </span>
                        )}
                        <button type="button" onClick={() => removeMixLine(code, i)}
                                className="text-red-400 hover:text-red-600" title="Remove"><X size={13} /></button>
                      </div>
                    )
                  })}
                </div>
                <button type="button" onClick={() => addMixLine(code)}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-50 hover:text-brand-600">
                  <Plus size={12} />Add crystal
                </button>
              </div>
            )
          })}
        </div>

        {addable.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 items-center">
            <span className="text-[11px] uppercase tracking-wide text-ink-40 mr-1">Add recipe:</span>
            {addable.map(mc => (
              <button type="button" key={mc} onClick={() => addMix(mc)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-ink-10 text-ink-50 hover:border-brand-300 hover:text-brand-600">
                <Plus size={11} /><span className="font-mono">{mc}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export { isMixCode }
