import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import LoadingBar from '../components/LoadingBar'
import { AlertTriangle, AlertCircle, Info, CheckCircle2, RefreshCw, Copy, ChevronDown, ChevronRight } from 'lucide-react'
import { validateCustomer } from '../domain/customer'
import { validateComponent, validateCriticalRefs } from '../criticalComponents'
import { validateOrder } from '../shipping'
import { allIssues } from '../domain/validation'

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

    // Components library for orphan resolution (id + uppercased code).
    const lib = rComps.docs.map(d => ({ id: d.id, code: String(d.data().code || '').trim().toUpperCase() }))

    const out = []
    const grp = (name, total, issues, hint) => out.push({ name, total, issues, hint })
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
      grp('Range Components', rComps.size, issues, '`code` is the upsert key; plating lives here.')
    }

    // ── range products — split by lifecycle so findings route to the right staff ──
    {
      const buckets = {
        mto:     { name: 'Range — Made to Order', hint: 'Made-to-order figurines: variants, MOQ/lead, BOM, and images.', total: 0, issues: [] },
        stock:   { name: 'Range — Last Stock',    hint: 'Last Stock: components ARE the inventory — missing components shows the design SOLD OUT.', total: 0, issues: [] },
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
        // Missing components: for Last Stock it means SOLD OUT (error); for MTO it
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
        const lead = (c.lead_time_weeks != null && c.lead_time_weeks !== '') ? `${c.lead_time_weeks}wk lead` : 'no lead time'
        add(issues, 'info', d.id, code || c.name || d.id, `used only by last-stock/retired designs — stock ${stock}, ${lead}`, '/components')
      })
      grp('Last-stock-only components', rComps.size, issues,
        'Components referenced only by Last Stock / Retired designs — review only. Deleting these makes those designs show SOLD OUT (last-stock availability comes from component stock).')
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
        const o = d.data(), label = o.order_number || o.ordernumber || o.erp_pi_no || d.id
        addResult(issues, validateOrder(o), d.id, label, '/shipping')
      })
      grp('Orders (PI)', orders.size, issues, 'Each order should link to a customer.')
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
        {ranAt && <span className="text-ink-40"> · last run {ranAt.toLocaleTimeString()}</span>}
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
              {catCounts[c] > 0 && <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${active === c ? 'bg-brand-50 text-brand-700' : 'bg-ivory text-ink-50'}`}>{catCounts[c]}</span>}
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
                    ? (open ? <ChevronDown size={15} className="text-ink-40 shrink-0" /> : <ChevronRight size={15} className="text-ink-40 shrink-0" />)
                    : <span className="w-[15px] shrink-0" />}
                  <h2 className="text-sm font-semibold text-gray-700 truncate">{g.name} <span className="font-normal text-ink-40">· {g.total} records</span></h2>
                </button>
                <div className="flex items-center gap-3 shrink-0">
                  {hasIssues ? (
                    <>
                      <span className="text-xs text-ink-50">{g.issues.length} issue{g.issues.length > 1 ? 's' : ''}</span>
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
                  <p className="text-[11px] text-ink-40 mt-2 mb-1">{g.hint}</p>
                  <div className="divide-y divide-gray-100">
                    {g.issues.slice(0, 100).map((it, i) => (
                      <div key={i} className="py-1.5 flex items-start gap-2 text-sm">
                        <SevIcon sev={it.sev} />
                        <div className="min-w-0">
                          {it.link
                            ? <Link to={it.link} className="font-mono text-xs text-brand-600 hover:underline">{it.label}</Link>
                            : <span className="font-mono text-xs text-ink-70">{it.label}</span>}
                          <span className="text-ink-70"> — {it.msg}</span>
                        </div>
                      </div>
                    ))}
                    {g.issues.length > 100 && <p className="text-xs text-ink-40 pt-2">…and {g.issues.length - 100} more — use Copy for the full list.</p>}
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

function Tally({ icon: Icon, cls, n, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border ${cls}`}>
      <Icon size={15} /> <span className="font-semibold">{n}</span> {label}
    </span>
  )
}

function SevIcon({ sev }) {
  if (sev === 'error') return <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
  if (sev === 'warning') return <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
  return <Info size={14} className="text-sky-500 shrink-0 mt-0.5" />
}
