import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCan } from '../access'
import { CRYSTAL_UNITS, crystalVariantDescription } from '../domain/crystalProducts'
import { componentCostAtQty } from '../rangeCosting'
import { setPreferredQuote } from '../criticalComponents'
import { loadCrystalCostings, listCrystalCostingCandidates, inspectCrystalCostingComponent, linkCrystalCosting, createCrystalCostingComponent, crystalQuoteUrl, crystalCostingContext } from '../crystalSupplierCosting'

const missing = value => value == null || typeof value === 'string' && !value.trim()
const amount = (value, currency) => {
  if (missing(value) || !Number.isFinite(Number(value))) return 'Not confirmed'
  const formatted = Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:20})
  return missing(currency) ? `${formatted} (currency not confirmed)` : `${String(currency).trim()} ${formatted}`
}
const known = value => missing(value) ? 'Not confirmed' : String(value)
const costPreview = (quote, qty) => {
  const tier = quote.volume_tiers?.filter(t => t.min_qty <= qty).sort((a,b) => b.min_qty-a.min_qty)[0]
  return missing(quote.unit_cost) || tier && missing(tier.unit_cost) ? null : componentCostAtQty(quote,qty)
}

export default function CrystalSupplierCosting({ product }) {
  const can = useCan(), supply = can('supply')
  return supply ? <SupplierCosting key={product.id} product={product} /> : null
}

function SupplierCosting({ product }) {
  const [variantId, setVariantId] = useState(product.primary_variant_id || product.variants[0]?.id || '')
  const [components, setComponents] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [picker, setPicker] = useState(null), [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null), [quoteId, setQuoteId] = useState(''), [reviewed, setReviewed] = useState(false)
  const [qty, setQty] = useState('1'), [notice, setNotice] = useState('')
  const alive = useRef(true), running = useRef(false), selection = useRef(0), generation = useRef(0)
  const variant = product.variants.find(v => v.id === variantId)
  const linked = components.filter(c => c.crystal_variant_id === variantId)
  const orphaned = components.filter(c => !product.variants.some(v => v.id === c.crystal_variant_id))
  async function reload() {
    const request = ++generation.current
    setLoading(true); setError('')
    try { const next = await loadCrystalCostings(product.id); if (alive.current && request === generation.current) setComponents(next) }
    catch(e) { if (alive.current && request === generation.current) setError(e.message || 'Costing could not be loaded. Please retry.') }
    finally { if (alive.current && request === generation.current) setLoading(false) }
  }
  useEffect(() => { alive.current = true; reload(); return () => { alive.current = false; selection.current++; generation.current++ } }, [product.id])
  async function action(work) {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setNotice('')
    try { await work() }
    catch(e) { if (alive.current) setError(e.message || 'Costing could not be saved. Your selection is retained.') }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }
  function selectVariant(id) {
    selection.current++; setVariantId(id); setSelected(null); setQuoteId(''); setReviewed(false); setNotice(''); setError('')
  }
  async function openPicker() {
    const request = ++selection.current
    await action(async () => { const rows = await listCrystalCostingCandidates(); if (alive.current && request === selection.current) setPicker(rows) })
  }
  async function inspect(id) {
    const request = ++selection.current
    setSelected(null); setQuoteId(''); setReviewed(false)
    if (!id) return
    await action(async () => {
      const c = await inspectCrystalCostingComponent(id)
      if (alive.current && request === selection.current) { setSelected(c); setQuoteId(c.quotes.find(q => q.is_preferred)?.id || c.quotes[0]?.id || '') }
    })
  }
  const matches = (picker || []).filter(c => (!c.crystal_product_id || c.crystal_product_id === product.id && c.crystal_variant_id === variantId) &&
    [c.code,c.name].join(' ').toLowerCase().includes(search.toLowerCase()))
  return <section className="card p-4 md:p-6 space-y-4" aria-label="Supplier quotes and costing">
    <header className="space-y-2"><h2 className="eyebrow">Supplier quotes &amp; costing</h2><p className="text-sm text-ink-60">Internal · supplier costs and source files stay out of the customer catalogue. Link the existing cost component for this exact size and colour.</p></header>
    {!product.variants.length ? <p className="text-sm text-ink-60">Add an actual variant first, then link its supplier quotations.</p> : <>
      <label className="block"><span className="label">Costing variant</span><select aria-label="Costing variant" className="input" value={variantId} disabled={busy} onChange={e => selectVariant(e.target.value)}><option value="">Choose size / colour</option>{product.variants.map(v => <option key={v.id} value={v.id}>{v.code} · {crystalVariantDescription(v)}</option>)}</select></label>
      {variant && <p className="text-xs text-ink-60 break-words">{crystalVariantDescription(variant)} · costs per {CRYSTAL_UNITS[variant.unit] || variant.unit}. Linking does not change stock, publication or the preferred supplier.</p>}
      {loading && <p role="status" className="text-sm text-ink-60">Loading supplier quotes…</p>}
      {error && <div role="alert" className="space-y-2 text-sm text-brand-700"><p className="break-words">{error}</p><button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={reload}>Reload costing</button></div>}
      {notice && <p role="status" className="text-sm text-ink-60">{notice}</p>}
      {!!orphaned.length && <p className="text-sm text-brand-700">{orphaned.length} internal link(s) reference a missing variant and need review. No quote has been reassigned.</p>}
      {variant && !loading && <>
        {!linked.length && <p className="text-sm text-ink-60">No internal cost component linked to this variant yet. Reuse an existing component and its quotations before creating one.</p>}
        {linked.length > 1 && <p className="text-sm text-brand-700">Multiple existing cost components are linked. Review these sources; their costs are not added together.</p>}
        {linked.map(c => <article key={c.id} className="border-t border-warm-grey pt-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 break-words"><h3 className="text-sm">{c.code} · {c.name}</h3><Link className="text-xs text-brand-600 underline min-h-11 inline-flex items-center" to={`/components/critical/${c.id}`}>Internal cost component</Link></div>{c.crystal_catalogue_unit === variant.unit && <Link className="btn-secondary min-h-11" to={crystalQuoteUrl(product.id,variant.id,c.id)}>Add supplier quote</Link>}</div>
          {c.crystal_catalogue_unit !== variant.unit ? <p role="alert" className="text-sm text-brand-700">The variant unit changed. Review the association before editing or selecting supplier costs.</p> : <>
            {!c.quotes.length && <p className="text-sm text-ink-60">No quotations saved. Add the supplier's confirmed terms; unknown MOQ and lead times can remain blank.</p>}
            {c.quotes.map(q => <div key={q.id} className="bg-ivory p-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 break-words"><p className="text-sm">{q.supplier_id ? <Link className="text-brand-600 underline" to={`/suppliers/${q.supplier_id}`}>{q.supplier_name || 'Open supplier'}</Link> : 'Supplier needs review'}{q.is_preferred && <span className="tag ml-2">Preferred</span>}</p><p className="text-sm mt-1">{amount(q.unit_cost,q.unit_cost_currency)} / {CRYSTAL_UNITS[variant.unit] || variant.unit}</p></div><Link className="btn-secondary min-h-11" to={crystalQuoteUrl(product.id,variant.id,c.id,q.id)}>Edit quote</Link></div>
              <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-xs"><div><dt className="text-ink-60">MOQ</dt><dd>{known(q.moq)}</dd></div><div><dt className="text-ink-60">Tooling / samples · one time</dt><dd>{amount(q.tooling_sample_cost,q.tooling_sample_cost_currency)}</dd></div><div><dt className="text-ink-60">Sampling / tooling / production days</dt><dd>{[q.sampling_lead_time_days,q.tooling_lead_time_days,q.production_lead_time_days].map(known).join(' / ')}</dd></div></dl>
              {!!q.volume_tiers?.length && <p className="text-xs break-words">Quantity tiers: {q.volume_tiers.map(t => `${t.min_qty}+ · ${amount(t.unit_cost,q.unit_cost_currency)}`).join(' / ')}</p>}
              {q.notes && <p className="text-sm whitespace-pre-wrap break-words">{q.notes}</p>}
              {!!q.attachments?.length && <div className="flex flex-wrap gap-2">{q.attachments.map((a,i) => <a key={i} className="btn-ghost text-xs min-h-11 break-all" href={a.file_url} target="_blank" rel="noreferrer">{a.file_name || 'Open source attachment'} ↗</a>)}</div>}
              {!q.is_preferred && <button type="button" className="btn-ghost min-h-11 text-xs" disabled={busy} onClick={() => action(async () => { await setPreferredQuote(c.id,q.id,crystalCostingContext(product.id,variant.id)); if (alive.current) await reload() })}>Use as preferred quote</button>}
            </div>)}
            {c.quotes.some(q => q.is_preferred) && <div className="flex flex-wrap items-end gap-3"><label><span className="label">Cost preview quantity</span><input className="input w-40" type="number" min="1" step="1" value={qty} onChange={e => setQty(e.target.value)}/></label><p className="text-sm pb-3">{Number(qty)>0 ? amount(costPreview(c.quotes.find(q => q.is_preferred),Number(qty)),c.quotes.find(q => q.is_preferred)?.unit_cost_currency) : 'Enter a positive quantity'} / {CRYSTAL_UNITS[variant.unit] || variant.unit} · tooling/samples separate</p></div>}
          </>}
        </article>)}
        <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={openPicker}>Link existing cost component</button>{!linked.length && <button type="button" className="btn-ghost min-h-11" disabled={busy || !!error} onClick={() => action(async () => { await createCrystalCostingComponent(product,variant); if (alive.current) { await reload(); setNotice('Internal cost component ready. Add its supplier quote below.') } })}>Create internal cost component</button>}</div>
        {picker && <div className="border border-warm-grey p-4 space-y-3">
          <h3 className="eyebrow">Review existing records</h3><label className="block"><span className="label">Find component code or name</span><input className="input" value={search} disabled={busy} onChange={e => setSearch(e.target.value)} /></label>
          <label className="block"><span className="label">Existing internal cost component</span><select aria-label="Existing internal cost component" className="input" disabled={busy} value={selected?.id || ''} onChange={e => inspect(e.target.value)}><option value="">Choose one of {matches.length} matching records</option>{matches.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
          {selected && <><p className="text-sm break-words">Link {selected.code} to {variant.code}. All quotations on this internal component apply to this exact variant. Existing quotes, photographs, stock and preferred pricing will be preserved.</p>
            {!!selected.quotes.length && <label className="block"><span className="label">Existing quotation to verify</span><select aria-label="Existing quotation to verify" className="input" value={quoteId} disabled={busy} onChange={e => {setQuoteId(e.target.value);setReviewed(false)}}>{selected.quotes.map(q => <option key={q.id} value={q.id}>{q.supplier_name} · {amount(q.unit_cost,q.unit_cost_currency)} · {q.attachments?.length || 0} attachment(s)</option>)}</select></label>}
            {selected.quotes.find(q => q.id === quoteId)?.attachments?.map((a,i) => <a key={i} href={a.file_url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 underline inline-flex min-h-11 items-center break-all">{a.file_name || 'Open source attachment'} ↗</a>)}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={reviewed} onChange={e => setReviewed(e.target.checked)}/><span>I checked this component's exact size, colour and quotation unit against the selected catalogue variant.</span></label>
            <button type="button" className="btn-secondary min-h-11" disabled={busy || !reviewed} onClick={() => action(async () => { await linkCrystalCosting({productId:product.id,variantId:variant.id,componentId:selected.id,quoteId,expectedLink:{product:selected.crystal_product_id || '',variant:selected.crystal_variant_id || '',unit:selected.crystal_catalogue_unit || ''}}); if (alive.current) {setPicker(null);setSelected(null);setReviewed(false);await reload();setNotice('Existing cost component linked. Quotations and attachments were reused.')} })}>{busy ? 'Linking…' : 'Confirm link'}</button>
          </>}
          <button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={() => {selection.current++;setPicker(null);setSelected(null);setReviewed(false)}}>Close review</button>
        </div>}
      </>}
    </>}
  </section>
}
