import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import LoadingBar from '../components/LoadingBar'
import { AlertTriangle, AlertCircle, Info, CheckCircle2, RefreshCw, Copy } from 'lucide-react'
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

export default function SchemaAudit() {
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState([])
  const [ranAt, setRanAt] = useState(null)
  const [copied, setCopied] = useState(false)

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

    // ── range products ──────────────────────────────────────────────────────────
    {
      const issues = []
      rProducts.docs.forEach(d => {
        const p = d.data(), label = p.design_no ? `${p.design_no}${p.format_code ? '-' + p.format_code : ''}` : (p.design_name || d.id)
        const variants = Array.isArray(p.variants) ? p.variants : (Array.isArray(p.finishes) ? p.finishes : [])
        if (!String(p.design_no || '').trim() && !String(p.design_code || '').trim()) add(issues, 'error', d.id, label, 'missing design_no / design_code', `/range/${d.id}`)
        if (!variants.length) add(issues, 'error', d.id, label, 'no variants', `/range/${d.id}`)
        if (!isNum(p.moq) || num(p.moq) <= 0) add(issues, 'info', d.id, label, 'no MOQ set', `/range/${d.id}`)
        if (!isNum(p.lead_time_weeks) || num(p.lead_time_weeks) <= 0) add(issues, 'info', d.id, label, 'no assembly lead_time_weeks set', `/range/${d.id}`)
        const refs = Array.isArray(p.critical_components) ? p.critical_components : []
        addResult(issues, validateCriticalRefs(refs, lib), d.id, label, `/range/${d.id}`)
        // Pre-launch: an orderable product (Last Stock or Made to Order) with no
        // components can't compute buildable stock / lead / cost. Concept and
        // retired products are exempt (not tooled / sold out).
        const st = String(p.status || '').trim()
        if (st !== 'concept' && st !== 'retired' && refs.length === 0) {
          const lastStock = st === 'stock'
          add(issues, lastStock ? 'error' : 'warning', d.id, label,
            `${lastStock ? 'Last Stock' : 'Made to Order'} product has no critical components entered — ${lastStock ? 'buildable stock' : 'cost & lead time'} can’t be computed`,
            `/range/${d.id}`)
        }
      })
      grp('Range Products (figurines)', rProducts.size, issues, 'Variants, MOQ/lead, and component refs.')
    }

    // ── corp products ───────────────────────────────────────────────────────────
    {
      const issues = []
      products.docs.forEach(d => {
        const p = d.data(), label = p.name || d.id
        if (!String(p.name || '').trim()) add(issues, 'error', d.id, label, 'missing `name`', `/products/${d.id}`)
      })
      grp('Corp Gift Products', products.size, issues, 'Name is required.')
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

  if (loading) return <LoadingBar />

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

      <div className="space-y-4">
        {groups.map(g => (
          <div key={g.name} className="card p-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-gray-700">{g.name} <span className="font-normal text-ink-40">· {g.total} records</span></h2>
              {g.issues.length === 0
                ? <span className="text-xs text-green-600 inline-flex items-center gap-1"><CheckCircle2 size={13} /> clean</span>
                : <span className="text-xs text-ink-50">{g.issues.length} issue{g.issues.length > 1 ? 's' : ''}</span>}
            </div>
            <p className="text-[11px] text-ink-40 mb-2">{g.hint}</p>
            {g.issues.length > 0 && (
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
                {g.issues.length > 100 && <p className="text-xs text-ink-40 pt-2">…and {g.issues.length - 100} more.</p>}
              </div>
            )}
          </div>
        ))}
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
