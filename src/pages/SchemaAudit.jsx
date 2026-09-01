import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, getDoc, doc, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import LoadingBar from '../components/LoadingBar'
import { AlertTriangle, AlertCircle, Info, CheckCircle2, RefreshCw, Copy, ChevronDown, ChevronRight, Eraser } from 'lucide-react'
import { validateCustomer } from '../domain/customer'
import { validateComponent, validateCriticalRefs, buildProductIndex } from '../criticalComponents'
import { looksLikeFigurineCode } from '../mrp'
import { validateOrder } from '../shipping'
import { allIssues } from '../domain/validation'
import { brandLetter, designNumber } from '../constants'

// Read-only schema audit. Scans the main collections against the canonical shapes
// in the product-manager guardrail spec and reports problems by severity:
//   error   — breaks correctness / blocks a workflow (missing key, orphan ref)
//   warning — risky / non-canonical (legacy field, odd value)
//   info    — soft default applies (no MOQ / lead time set)
// Nothing is written; this is a diagnostics surface only.
//
// The customer / component / critical-ref / order checks call the SAME validators
// the write path uses (domain/customer, criticalComponents, shipping), so audit
// and save can never drift. Entities without a domain module yet (customer-account
// logins, range-product top-level fields, corp products) keep inline checks here.

const num = v => (v === '' || v == null ? NaN : Number(v))
const isNum = v => Number.isFinite(num(v))

// Severity weight for sorting
const SEV = { error: 0, warning: 1, info: 2 }

// Group → top-level category, for the audit's tab navigation.
const CATEGORY_ORDER = ['Range Products', 'Range Components', 'Customers', 'Accounts', 'Corp Gifts', 'Orders', 'Other']
const categoryOf = name =>
  name.startsWith('Range —') ? 'Range Products'
    : /component/i.test(name) ? 'Range Components'
    : name.startsWith('Customer Accounts') ? 'Accounts'
    : name.startsWith('Customers') ? 'Customers'
    : name.startsWith('Corp') ? 'Corp Gifts'
    : name.startsWith('Orders') ? 'Orders'
    : 'Other'

export default function SchemaAudit() {
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState([])
  const [ranAt, setRanAt] = useState(null)
  const [copied, setCopied] = useState(false)
  const [copiedGroup, setCopiedGroup] = useState(null)
  const [activeCat, setActiveCat] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [defaultLead, setDefaultLead] = useState(6)   // global parts-lead fallback (settings/productDefaults)
  const [clearingLead, setClearingLead] = useState(false)

  async function run() {
    setLoading(true)
    const [customers, users, rProducts, rComps, products, orders] = await Promise.all([
      getDocs(collection(db, 'customers')),
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'range_products')),
      getDocs(collection(db, 'range_components')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'orders')),
    ])

    // Order line items (one subcollection read per order) for the PI-vs-Range check.
    const orderLineSnaps = await Promise.all(
      orders.docs.map(d => getDocs(collection(db, 'orders', d.id, 'lines')))
    )

    // Global default parts-lead fallback — a component with no lead time already
    // resolves to this at costing/availability time (criticalComponents.makeLeadWeeks).
    const defSnap = await getDoc(doc(db, 'settings', 'productDefaults'))
    const defLead = Number(defSnap.data()?.default_parts_lead_weeks) || 6
    setDefaultLead(defLead)

    // Components library for orphan resolution (id + uppercased code).
    const lib = rComps.docs.map(d => ({ id: d.id, code: String(d.data().code || '').trim().toUpperCase() }))

    const out = []
    const grp = (name, total, issues, hint, extra) => out.push({ name, total, issues, hint, ...extra })
    const add = (issues, sev, id, label, msg, link) => issues.push({ sev, id, label, msg, link })
    // Map a shared validation result onto the audit's issue rows.
    const addResult = (issues, res, id, label, link) =>
      allIssues(res).forEach(it => issues.push({ sev: it.severity, id, label, msg: it.message, link }))

    // ── customers ─────────────────────────────────────────────────────────────
    {
      const issues = []
      customers.docs.forEach(d => {
        const c = d.data(), label = c.company_name || c.name || d.id
        addResult(issues, validateCustomer(c), d.id, label, `/customers/${d.id}`)
      })
      grp('Customers (CRM)', customers.size, issues, 'Canonical key is `company_name`, never `name`.')
    }

    // ── customer accounts (users) ───────────────────────────────────────────────
    {
      const issues = []
      users.docs.forEach(d => {
        const u = d.data()
        if (u.role === 'admin') return            // staff logins skip pricing checks
        const label = u.company_name || u.email || d.id
        if (!String(u.base_currency || '').trim()) add(issues, 'info', d.id, label, 'no base_currency set (defaults to USD)', '/portal')
        const ws = num(u.ws_discount_pct)
        if (u.ws_discount_pct != null && u.ws_discount_pct !== '' && (!Number.isFinite(ws) || ws <= 0))
          add(issues, 'warning', d.id, label, `ws_discount_pct = ${u.ws_discount_pct} (should be a positive % of list, e.g. 100)`, '/portal')
        if (u.fx_rate != null && u.fx_rate !== '' && num(u.fx_rate) < 0)
          add(issues, 'warning', d.id, label, `fx_rate = ${u.fx_rate} (must be ≥ 0)`, '/portal')
        if (!u.customer_id) add(issues, 'info', d.id, label, 'not linked to a CRM customer record', '/portal')
      })
      grp('Customer Accounts (logins)', users.size, issues, 'Pricing fields and CRM linkage.')
    }

    // ── range components ────────────────────────────────────────────────────────
    {
      const issues = []
      rComps.docs.forEach(d => {
        const c = d.data(), label = c.code || c.name || d.id
        addResult(issues, validateComponent(c), d.id, label, '/components')
      })
      grp('Range Components', rComps.size, issues,
        `\`code\` is the upsert key; plating lives here. A component with no lead time isn't broken — it automatically uses the default parts lead (${defLead} wk).`,
        { hintLink: { to: '/settings?tab=products&sub=defaults', label: 'Change the default (Settings → Products → Defaults)' } })
    }

    // ── range products — split by lifecycle so findings route to the right staff ──
    {
      const buckets = {
        mto:     { name: 'Range — Made to Order', hint: 'Made-to-order figurines: variants, MOQ/lead, BOM, and images.', total: 0, issues: [] },
        stock:   { name: 'Range — Retired Stock', hint: 'Retired Stock: components ARE the inventory — missing components shows the design SOLD OUT.', total: 0, issues: [] },
        concept: { name: 'Range — Concept',       hint: 'Concept figurines: in development (not tooled).', total: 0, issues: [] },
        retired: { name: 'Range — Retired',       hint: 'Retired figurines: sold out, excluded from the shops.', total: 0, issues: [] },
      }
      rProducts.docs.forEach(d => {
        const p = d.data(), label = p.design_no ? `${p.design_no}${p.format_code ? '-' + p.format_code : ''}` : (p.design_name || d.id)
        const st = String(p.status || '').trim()
        const bucket = buckets[st === 'stock' ? 'stock' : st === 'concept' ? 'concept' : st === 'retired' ? 'retired' : 'mto']
        bucket.total++
        const issues = bucket.issues
        const variants = Array.isArray(p.variants) ? p.variants : (Array.isArray(p.finishes) ? p.finishes : [])
        if (!String(p.design_no || '').trim() && !String(p.design_code || '').trim()) add(issues, 'error', d.id, label, 'missing design_no / design_code', `/range/${d.id}`)
        if (!variants.length) add(issues, 'error', d.id, label, 'no variants', `/range/${d.id}`)
        if (!isNum(p.moq) || num(p.moq) <= 0) add(issues, 'info', d.id, label, 'no MOQ set', `/range/${d.id}`)
        if (!isNum(p.lead_time_weeks) || num(p.lead_time_weeks) <= 0) add(issues, 'info', d.id, label, 'no assembly lead_time_weeks set', `/range/${d.id}`)
        const refs = Array.isArray(p.critical_components) ? p.critical_components : []
        addResult(issues, validateCriticalRefs(refs, lib), d.id, label, `/range/${d.id}`)
        // Missing components: for Retired Stock it means SOLD OUT (error); for MTO it
        // stays sellable at a default lead but can't be costed (warning).
        if (refs.length === 0 && st !== 'concept' && st !== 'retired') {
          if (st === 'stock')
            add(issues, 'error', d.id, label, 'no components — availability comes only from remaining part stock, so the shop shows it SOLD OUT. Add the components + their stock.', `/range/${d.id}`)
          else
            add(issues, 'warning', d.id, label, 'no components/BOM — still sellable at a default lead time, but can’t be costed and the lead time is only a generic estimate. Add the tooling/critical parts.', `/range/${d.id}`)
        }
        // No product images — the shop shows gallery[0] or a variant image.
        const hasImg = (Array.isArray(p.gallery) && p.gallery.length > 0) || variants.some(v => v && v.image)
        if (!hasImg && st !== 'retired') add(issues, 'warning', d.id, label, 'no product images (gallery empty)', `/range/${d.id}`)
      })
      // Always surface the two orderable types; show Concept/Retired only if present.
      grp(buckets.mto.name, buckets.mto.total, buckets.mto.issues, buckets.mto.hint)
      grp(buckets.stock.name, buckets.stock.total, buckets.stock.issues, buckets.stock.hint)
      if (buckets.concept.total) grp(buckets.concept.name, buckets.concept.total, buckets.concept.issues, buckets.concept.hint)
      if (buckets.retired.total) grp(buckets.retired.name, buckets.retired.total, buckets.retired.issues, buckets.retired.hint)
    }

    // ── last-stock-only components (review list) ────────────────────────────────
    {
      const issues = []
      // Resolve each critical-component ref to a component code, and record the
      // status of every product that references it.
      const libById = new Map(rComps.docs.map(d => [d.id, String(d.data().code || '').trim().toUpperCase()]))
      const compStatuses = new Map()   // code -> Set<product status>
      rProducts.docs.forEach(d => {
        const p = d.data()
        const st = String(p.status || '').trim() || 'active'
        const refs = Array.isArray(p.critical_components) ? p.critical_components : []
        refs.forEach(r => {
          const code = String(r.code || libById.get(r.id) || '').trim().toUpperCase()
          if (!code) return
          if (!compStatuses.has(code)) compStatuses.set(code, new Set())
          compStatuses.get(code).add(st)
        })
      })
      const NO_RERUN = new Set(['stock', 'retired'])   // last-stock lifecycle
      rComps.docs.forEach(d => {
        const c = d.data()
        const code = String(c.code || '').trim().toUpperCase()
        const sts = code ? compStatuses.get(code) : null
        if (!sts || sts.size === 0) return               // unused by any product — separate concern
        if (![...sts].every(s => NO_RERUN.has(s))) return // also used by MTO/concept — keep
        const stock = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
        const leadNum = Number(c.lead_time_weeks)
        const label = code || c.name || d.id
        // A lead time on a last-stock-only part is wrong: it can't be re-produced,
        // so promising a procurement lead is misleading. Flag it with a one-click
        // clear. Parts with no lead are just informational.
        if (leadNum > 0) {
          issues.push({
            sev: 'warning', id: d.id, label, link: '/components',
            msg: `used only by last-stock/retired designs but has a ${leadNum}wk lead time — it can't be re-produced, so the lead time should be cleared. Stock ${stock}.`,
            clearLead: { id: d.id, code: label, weeks: leadNum },
          })
        } else {
          add(issues, 'info', d.id, label, `used only by last-stock/retired designs — stock ${stock}, no lead time`, '/components')
        }
      })
      grp('Last-stock-only components', rComps.size, issues,
        'Components referenced only by Retired Stock designs. These can’t be re-produced, so they should carry no lead time. Deleting them makes those designs show SOLD OUT (retired-stock availability comes from component stock).')
    }

    // ── corp products ───────────────────────────────────────────────────────────
    {
      const issues = []
      products.docs.forEach(d => {
        const p = d.data(), label = p.name || d.id
        if (!String(p.name || '').trim()) add(issues, 'error', d.id, label, 'missing `name`', `/products/${d.id}`)
        if (!String(p.heroImage || '').trim()) add(issues, 'warning', d.id, label, 'no hero image — won’t show a photo in listings', `/products/${d.id}`)
      })
      grp('Corp Gift Products', products.size, issues, 'Name and a hero image are required to display.')
    }

    // ── orders ──────────────────────────────────────────────────────────────────
    {
      const issues = []
      orders.docs.forEach(d => {
        const o = d.data(), label = o.order_number || o.ordernumber || o.uc_no || o.erp_pi_no || d.id
        addResult(issues, validateOrder(o), d.id, label, '/shipping')
      })
      grp('Orders (PI)', orders.size, issues, 'Each order should link to a customer.')
    }

    // ── PI SKUs whose design+format isn't set up in the Range ────────────────────
    // Reconciliation (and the MRP matcher) resolve a line by DESIGN NUMBER only, so
    // a line can show "matched" while the exact format ordered was never created in
    // the Range. Here we probe the stricter design+format key (plating IGNORED, per
    // the agreed rule) and flag figurine lines whose design+format is absent.
    // Two cases are distinguished: the design exists but not this format, vs no
    // product for the design at all. Aggregated by design+format so plating variants
    // (…-GPI, …-GC1) collapse to one actionable row.
    {
      const issues = []
      const index = buildProductIndex(rProducts.docs.map(d => d.data()))
      const strip = d => (d || '').replace(/^[A-Z]/, '')     // drop only the brand letter, keep body letter
      const hasDesignFormat = (d, f) => !!(index[`${d}-${f}`] || (strip(d) && index[`${strip(d)}-${f}`]))
      const hasDesign = d => !!(index[d] || (strip(d) && index[strip(d)]))
      const agg = new Map()   // KEY(design[-format]) -> { key, missing, byOrder:Map(orderId->{...}) }
      orders.docs.forEach((od, i) => {
        const o = od.data()
        const olabel = o.order_number || o.ordernumber || o.uc_no || o.erp_pi_no || od.id
        const odate = o.order_date || o.date || o.createdAt || null
        orderLineSnaps[i].docs.forEach(ld => {
          const l = ld.data()
          const code = String(l.item_code || '').trim().toUpperCase()
          if (!code) return                                  // charge/remark line with no code
          if (!(looksLikeFigurineCode(code) || l.line_type === 'range')) return  // not a figurine line
          const parts = code.split('-')
          const design = parts[0] || '', format = parts[1] || ''
          // What's missing at the agreed granularity (design+format, plating ignored)?
          const missing = format
            ? (hasDesignFormat(design, format) ? null : (hasDesign(design) ? 'format' : 'design'))
            : (hasDesign(design) ? null : 'design')
          if (!missing) return                               // this design+format is set up — fine
          const key = format ? `${design}-${format}` : design
          let a = agg.get(key)
          if (!a) { a = { key, design, format, missing, byOrder: new Map() }; agg.set(key, a) }
          let ord = a.byOrder.get(od.id)
          if (!ord) { ord = { id: od.id, label: olabel, date: odate, qty: 0, desc: '', codes: new Set() }; a.byOrder.set(od.id, ord) }
          ord.codes.add(code)
          const q = num(l.qty_ordered); if (Number.isFinite(q)) ord.qty += q
          if (!ord.desc && l.description) ord.desc = String(l.description).trim()
        })
      })
      ;[...agg.values()].forEach(a => {
        const orderList = [...a.byOrder.values()].sort((x, y) => (y.date?.toMillis?.() ?? 0) - (x.date?.toMillis?.() ?? 0))
        const list = orderList.map(o => o.label)
        const where = list.slice(0, 4).join(', ') + (list.length > 4 ? ` +${list.length - 4} more` : '')
        const allCodes = new Set(orderList.flatMap(o => [...o.codes]))
        const totalQty = orderList.reduce((s, o) => s + o.qty, 0)
        const qtyTxt = totalQty > 0 ? `${totalQty} pcs` : 'qty n/a'
        const anyDesc = orderList.find(o => o.desc)?.desc || ''
        const descTxt = anyDesc ? ` — “${anyDesc}”` : ''
        const platings = [...allCodes].filter(c => c !== a.key)
        const platingTxt = platings.length ? ` [${platings.slice(0, 3).join(', ')}${platings.length > 3 ? '…' : ''}]` : ''
        const why = a.missing === 'format'
          ? `design exists but format ${a.key.split('-')[1]} is not set up`
          : 'no range product for this design'
        issues.push({
          sev: 'warning', id: a.key, label: a.key,
          msg: `not in Range — ${why}. On ${list.length} PI(s) (${where}), ${qtyTxt}${descTxt}${platingTxt}. Pick a PI below to add just that item — not every PI needs backfilling, only the ones still being supplied.`,
          link: '/range',
          notInRange: { design: a.design, format: a.format,
            orders: orderList.map(o => ({ id: o.id, label: o.label, qty: o.qty, desc: o.desc, codes: [...o.codes] })) },
        })
      })
      grp('Orders — PI SKUs not in Range', agg.size, issues,
        'Figurine PI lines whose exact design+format has no range_product (plating ignored). Reconciliation matches on design number only, so these can show “matched” on the PI while the ordered format was never created. Aggregated by design+format.')
    }

    out.forEach(g => g.issues.sort((a, b) => SEV[a.sev] - SEV[b.sev]))
    setGroups(out)
    setRanAt(new Date())
    setLoading(false)
  }

  useEffect(() => { run() }, [])

  const totals = groups.reduce((t, g) => {
    g.issues.forEach(i => { t[i.sev] = (t[i.sev] || 0) + 1 })
    return t
  }, {})
  const grandTotal = (totals.error || 0) + (totals.warning || 0) + (totals.info || 0)

  // Plain-text export so the list can be pasted into an email/message to a colleague.
  function copyReport() {
    const lines = [`Schema Audit — ${new Date().toLocaleString()}`, '']
    groups.forEach(g => {
      if (!g.issues.length) return
      lines.push(`## ${g.name} (${g.issues.length} issue${g.issues.length > 1 ? 's' : ''})`)
      g.issues.forEach(it => lines.push(`- [${it.sev}] ${it.label} — ${it.msg}`))
      lines.push('')
    })
    const text = lines.length > 2 ? lines.join('\n') : 'No issues found.'
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  // Copy one group's FULL list (all rows, not the on-screen 100-row cap).
  function copyGroup(g) {
    const lines = [`## ${g.name} (${g.issues.length} issue${g.issues.length > 1 ? 's' : ''})`]
    g.issues.forEach(it => lines.push(`- [${it.sev}] ${it.label} — ${it.msg}`))
    navigator.clipboard?.writeText(lines.join('\n')).then(() => {
      setCopiedGroup(g.name); setTimeout(() => setCopiedGroup(c => (c === g.name ? null : c)), 2000)
    }).catch(() => {})
  }

  const toggle = name => setExpanded(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })

  // Clear the lead time on one last-stock-only component, then re-scan so the
  // warning drops off. Lead is set to null = "no lead time" (never re-produced).
  async function clearLead(id) {
    await updateDoc(doc(db, 'range_components', id), { lead_time_weeks: null })
    await run()
  }
  // Clear the lead time on every flagged last-stock-only component in one batch.
  async function clearAllLeads(g) {
    const ids = g.issues.filter(it => it.clearLead).map(it => it.clearLead.id)
    if (!ids.length) return
    setClearingLead(true)
    try {
      for (let i = 0; i < ids.length; i += 400) {
        const batch = writeBatch(db)
        ids.slice(i, i + 400).forEach(id => batch.update(doc(db, 'range_components', id), { lead_time_weeks: null }))
        await batch.commit()
      }
      await run()
    } finally { setClearingLead(false) }
  }

  if (loading) return <LoadingBar />

  // Tab categories present, the active one, per-category issue counts, and the
  // groups shown under the active tab.
  const cats = CATEGORY_ORDER.filter(c => groups.some(g => categoryOf(g.name) === c))
  const active = cats.includes(activeCat) ? activeCat : cats[0]
  const catCounts = groups.reduce((m, g) => { const c = categoryOf(g.name); m[c] = (m[c] || 0) + g.issues.length; return m }, {})
  const visibleGroups = groups.filter(g => categoryOf(g.name) === active)

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl md:text-2xl">Schema Audit</h1>
        <div className="flex items-center gap-2">
          <button onClick={copyReport} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={grandTotal === 0}>
            <Copy size={14} /> {copied ? 'Copied ✓' : 'Copy report'}
          </button>
          <button onClick={run} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RefreshCw size={14} /> Re-run</button>
        </div>
      </div>
      <p className="text-sm text-ink-60 mb-4">
        Read-only check of every main collection against the canonical data shapes. Nothing is changed.
        {ranAt && <span className="text-ink-60"> · last run {ranAt.toLocaleTimeString()}</span>}
      </p>

      <div className="flex flex-wrap gap-2 mb-5">
        <Tally icon={AlertCircle} cls="text-red-600 bg-red-50 border-red-200" n={totals.error || 0} label="errors" />
        <Tally icon={AlertTriangle} cls="text-amber-700 bg-amber-50 border-amber-200" n={totals.warning || 0} label="warnings" />
        <Tally icon={Info} cls="text-sky-700 bg-sky-50 border-sky-200" n={totals.info || 0} label="info" />
      </div>

      {grandTotal === 0 && (
        <div className="card p-6 text-center text-green-700 flex items-center justify-center gap-2">
          <CheckCircle2 size={18} /> No schema issues found across all collections.
        </div>
      )}

      {cats.length > 0 && (
        <div className="flex gap-1 border-b border-ivory-dark mb-4 overflow-x-auto overflow-y-hidden whitespace-nowrap">
          {cats.map(c => (
            <button key={c} onClick={() => setActiveCat(c)}
              className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 shrink-0 transition-colors ${
                active === c ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-60 hover:text-ink-80'}`}>
              {c}
              {catCounts[c] > 0 && <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${active === c ? 'bg-brand-50 text-brand-700' : 'bg-ivory text-ink-60'}`}>{catCounts[c]}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {visibleGroups.map(g => {
          const open = expanded.has(g.name)
          const hasIssues = g.issues.length > 0
          return (
            <div key={g.name} className="card p-4">
              <div className="flex items-center justify-between gap-3">
                <button onClick={() => hasIssues && toggle(g.name)} className={`flex items-center gap-2 text-left min-w-0 ${hasIssues ? '' : 'cursor-default'}`}>
                  {hasIssues
                    ? (open ? <ChevronDown size={15} className="text-ink-60 shrink-0" /> : <ChevronRight size={15} className="text-ink-60 shrink-0" />)
                    : <span className="w-[15px] shrink-0" />}
                  <h2 className="text-sm font-semibold text-gray-700 truncate">{g.name} <span className="font-normal text-ink-60">· {g.total} records</span></h2>
                </button>
                <div className="flex items-center gap-3 shrink-0">
                  {hasIssues ? (
                    <>
                      <span className="text-xs text-ink-60">{g.issues.length} issue{g.issues.length > 1 ? 's' : ''}</span>
                      {g.issues.some(it => it.clearLead) && (
                        <button onClick={() => clearAllLeads(g)} disabled={clearingLead}
                          className="text-xs text-amber-700 hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                          title="Clear the lead time on every last-stock component listed here">
                          <Eraser size={12} /> {clearingLead ? 'Clearing…' : `Clear all lead times (${g.issues.filter(it => it.clearLead).length})`}
                        </button>
                      )}
                      <button onClick={() => copyGroup(g)} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1" title="Copy this list (all rows) to send to staff">
                        <Copy size={12} /> {copiedGroup === g.name ? 'Copied ✓' : 'Copy'}
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-green-600 inline-flex items-center gap-1"><CheckCircle2 size={13} /> clean</span>
                  )}
                </div>
              </div>
              {open && hasIssues && (
                <>
                  <p className="text-[11px] text-ink-60 mt-2 mb-1">
                    {g.hint}
                    {g.hintLink && <> · <Link to={g.hintLink.to} className="text-brand-600 hover:underline">{g.hintLink.label}</Link></>}
                  </p>
                  <div className="divide-y divide-gray-100">
                    {g.issues.slice(0, 100).map((it, i) => (
                      it.notInRange
                        ? <NotInRangeRow key={i} it={it} />
                        : it.clearLead
                        ? <ClearLeadRow key={i} it={it} onClear={clearLead} />
                        : (
                          <div key={i} className="py-1.5 flex items-start gap-2 text-sm">
                            <SevIcon sev={it.sev} />
                            <div className="min-w-0">
                              {it.link
                                ? <Link to={it.link} className="font-mono text-xs text-brand-600 hover:underline">{it.label}</Link>
                                : <span className="font-mono text-xs text-ink-70">{it.label}</span>}
                              <span className="text-ink-70"> — {it.msg}</span>
                            </div>
                          </div>
                        )
                    ))}
                    {g.issues.length > 100 && <p className="text-xs text-ink-60 pt-2">…and {g.issues.length - 100} more — use Copy for the full list.</p>}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Last-stock-only component that still carries a lead time — offers a one-click
// clear (a can't-be-re-produced part shouldn't promise a procurement lead).
function ClearLeadRow({ it, onClear }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="py-1.5 flex items-start gap-2 text-sm">
      <SevIcon sev={it.sev} />
      <div className="min-w-0 flex-1">
        {it.link
          ? <Link to={it.link} className="font-mono text-xs text-brand-600 hover:underline">{it.label}</Link>
          : <span className="font-mono text-xs text-ink-70">{it.label}</span>}
        <span className="text-ink-70"> — {it.msg}</span>
        <button
          onClick={async () => { setBusy(true); try { await onClear(it.clearLead.id) } finally { setBusy(false) } }}
          disabled={busy}
          className="ml-2 text-xs text-amber-700 hover:underline inline-flex items-center gap-1 disabled:opacity-50 align-baseline"
        >
          <Eraser size={12} /> {busy ? 'Clearing…' : 'Clear lead time'}
        </button>
      </div>
    </div>
  )
}

function Tally({ icon: Icon, cls, n, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border ${cls}`}>
      <Icon size={15} /> <span className="font-semibold">{n}</span> {label}
    </span>
  )
}

// "Orders — PI SKUs not in Range" row: lets staff pick ONE PI to base a new
// range product on, instead of a blanket "add the SKU" link. Most flagged
// design+formats sit on several PIs, many of them old/already-fulfilled —
// only the PI(s) still being supplied from stock need the item actually added.
function NotInRangeRow({ it }) {
  const { design, format, orders } = it.notInRange
  const [selId, setSelId] = useState(orders[0]?.id || '')
  const sel = orders.find(o => o.id === selId) || orders[0]
  const params = new URLSearchParams({
    brand_code: brandLetter(design) || 'D',
    design_no: designNumber(design),
    ...(format ? { format_code: format } : {}),
    ...(sel?.desc ? { description: sel.desc } : {}),
  })
  return (
    <div className="py-1.5 flex items-start gap-2 text-sm">
      <SevIcon sev={it.sev} />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-xs text-ink-70">{it.label}</span>
        <span className="text-ink-70"> — {it.msg}</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <select value={selId} onChange={e => setSelId(e.target.value)}
                  className="text-xs border border-ivory-dark rounded px-1.5 py-1 bg-white max-w-[220px]">
            {orders.map(o => (
              <option key={o.id} value={o.id}>
                {o.label}{o.qty ? ` (${o.qty} pcs)` : ''}
              </option>
            ))}
          </select>
          <Link to={`/shipments/${sel.id}`} className="text-xs text-ink-60 hover:underline">view PI</Link>
          <Link to={`/range/new?${params.toString()}`} className="text-xs text-brand-600 hover:underline font-medium">
            Add to Range from this PI →
          </Link>
        </div>
      </div>
    </div>
  )
}

function SevIcon({ sev }) {
  if (sev === 'error') return <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
  if (sev === 'warning') return <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
  return <Info size={14} className="text-sky-500 shrink-0 mt-0.5" />
}
