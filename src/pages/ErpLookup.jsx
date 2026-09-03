import { useEffect, useMemo, useState } from 'react'
import { Search, Database, Building2, Factory, Boxes, AlertCircle, ListTree, X, Receipt, ClipboardList, FileText, ShoppingCart, History, Warehouse, ImageOff, Download } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import { erpLookup, erpBom, erpLines, erpSyncStatus, erpItemImages } from '../erpApi'
import ErpProductImport from '../components/ErpProductImport'
import { buildProductIndex, matchProductCode } from '../criticalComponents'
import { designBaseOf } from '../erpProductImport'
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { loadCustomers, importErpCustomers } from '../domain/customer'
import { CURRENCIES } from '../constants'
import { useCan } from '../access'

// Import ERP supplier records as app Suppliers (mirrors importErpCustomers).
// Suppliers have no domain module yet — SupplierForm.jsx writes this same
// shape inline — so this matches that shape directly rather than inventing a
// new one. Dedupes on erp_code so a re-import (or a code already linked)
// never creates a duplicate.
async function importErpSuppliers(erpRows) {
  const snap = await getDocs(collection(db, 'suppliers'))
  const seen = new Set(snap.docs.map(d => String(d.data().erp_code || '').toUpperCase()).filter(Boolean))
  const created = [], skipped = []
  for (const r of erpRows) {
    const code = String(r.code || '')
    const codeKey = code.toUpperCase()
    if (codeKey && seen.has(codeKey)) { skipped.push(code); continue }
    const companyName = r.name || r.short_name || code
    const emails = [r.email, r.email2].filter(Boolean)
    const phones = [r.phone, r.phone2, r.mobile].filter(Boolean)
    // If JES carries a contact name, seed contacts[] with one primary person
    // (the supplier form's own shape) rather than only the legacy flat field.
    const contacts = r.contact
      ? [{
          id: `sc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          name: String(r.contact), title: '', phone: '', wechat: '', whatsapp: '',
          email: '', is_primary: true, active: true,
        }]
      : []
    const ref = await addDoc(collection(db, 'suppliers'), {
      name: companyName, name_cn: '', erp_code: code, category: '',
      country: r.country || '', city: r.city || '', address: r.address || '',
      wechat_id: '', whatsapp: '', contact_person: r.contact || '', contacts,
      notes: ['Imported from JES ERP (code ' + code + ').', r.remarks].filter(Boolean).join(' '),
      default_currency: CURRENCIES.includes(r.currency) ? r.currency : '',
      default_payment_terms: '',
      phones, emails, phone: phones[0] || '', email: emails[0] || '',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
    created.push({ erpCode: code, supplierId: ref.id, companyName })
    if (codeKey) seen.add(codeKey)
  }
  return { created, skipped }
}

// Column layout per entity. `key` maps to the curated view's fields.
const ENTITIES = {
  customer: {
    label: 'Customers', Icon: Building2,
    cols: [
      { key: 'code', label: 'Code', mono: true },
      { key: 'name', label: 'Name', grow: true },
      { key: 'contact', label: 'Contact' },
      { key: 'phone', label: 'Phone' },
      { key: 'country', label: 'Country' },
      { key: 'currency', label: 'Curr' },
    ],
  },
  supplier: {
    label: 'Suppliers', Icon: Factory,
    cols: [
      { key: 'code', label: 'Code', mono: true },
      { key: 'name', label: 'Name', grow: true },
      { key: 'type', label: 'Type' },
      { key: 'contact', label: 'Contact' },
      { key: 'phone', label: 'Phone' },
      { key: 'country', label: 'Country' },
      { key: 'currency', label: 'Curr' },
    ],
  },
  item: {
    label: 'Items', Icon: Boxes,
    cols: [
      { key: 'code', label: 'Code', mono: true },
      { key: 'name', label: 'Description', grow: true },
      { key: 'type', label: 'Type' },
      { key: 'a_cost', label: 'A-Cost', num: true },
      { key: 'b_cost', label: 'B-Cost', num: true },
      { key: 'c_cost', label: 'C-Cost', num: true },
      { key: 'srp', label: 'SRP', num: true },
      { key: 'has_bom', label: 'BOM', bool: true },
    ],
  },
  sales_invoice: {
    label: 'Invoices', Icon: Receipt, linesOf: 'sales_invoice',
    cols: [
      { key: 'code', label: 'Invoice #', mono: true },
      { key: 'date', label: 'Date', date: true },
      { key: 'customer', label: 'Customer', grow: true },
      { key: 'currency', label: 'Curr' },
      { key: 'amount', label: 'Amount', num: true },
      { key: 'discount', label: 'Discount', num: true },
      // "Deposit" is JES's only record of money received against this
      // invoice — there is no fuller payment ledger here (the books, and any
      // later partial payments, are in PBIS, not JES). Balance Due is derived
      // from it, same formula as the Lines drill-down modal below.
      { key: 'deposit', label: 'Deposit Paid', num: true },
      { key: 'balance_due', label: 'Balance Due', num: true, compute: r => (Number(r.amount) || 0) - (Number(r.deposit) || 0) },
      { key: 'status', label: 'Status', badge: true },
    ],
  },
  sales_order: {
    label: 'Sales Orders', Icon: ClipboardList, linesOf: 'sales_order',
    cols: [
      { key: 'code', label: 'Order #', mono: true },
      { key: 'date', label: 'Date', date: true },
      { key: 'customer', label: 'Customer', grow: true },
      { key: 'currency', label: 'Curr' },
      { key: 'amount', label: 'Amount', num: true },
      { key: 'status', label: 'Status', badge: true },
    ],
  },
  purchase: {
    label: 'Purchase Orders', Icon: ShoppingCart, linesOf: 'purchase',
    cols: [
      { key: 'code', label: 'PO #', mono: true },
      { key: 'date', label: 'Date', date: true },
      { key: 'supplier', label: 'Supplier', grow: true },
      { key: 'currency', label: 'Curr' },
      { key: 'amount', label: 'Amount', num: true },
      { key: 'status', label: 'Status', badge: true },
    ],
  },
  item_history: {
    label: 'Item price history', Icon: History,
    crossLink: { key: 'invoice_no', of: 'sales_invoice' }, trailingLabel: 'Invoice',
    cols: [
      { key: 'date', label: 'Date', date: true },
      { key: 'customer', label: 'Customer', grow: true },
      { key: 'item_code', label: 'Item', mono: true },
      { key: 'description', label: 'Description', grow: true },
      { key: 'currency', label: 'Curr' },
      { key: 'qty', label: 'Qty', num: true, qty: true },
      { key: 'unit_price', label: 'List', num: true },
      { key: 'markup', label: 'Mkup', num: true },
      { key: 'net_price', label: 'Net / unit', num: true, strong: true },
      { key: 'amount', label: 'Line total', num: true },
      { key: 'invoice_no', label: 'Invoice #', mono: true },
    ],
  },
  stock: {
    // noTrailing: stock rows have no active/expired flag, so the generic
    // trailing Status column would label every row "Expired".
    label: 'Inventory', Icon: Warehouse, hasWarehouse: true, limit: 500, noTrailing: true,
    cols: [
      { key: 'item_code', label: 'Item Code', mono: true },
      { key: 'description', label: 'Description', grow: true },
      { key: 'item_type', label: 'Type' },
      { key: 'warehouse', label: 'W/H', mono: true },
      { key: 'qty', label: 'Qty', num: true, qty: true },
      { key: 'last_movement', label: 'Last Move', date: true },
      { key: 'movements', label: 'Moves', num: true, int: true },
    ],
  },
}

// Which entities support the "Active only" filter (have an active flag).
const ACTIVE_FILTER = new Set(['customer', 'supplier', 'item'])

// Field groups for the customer/supplier detail panel. The list query already
// returns every column (select *), so opening a detail costs no extra request.
// Empty fields are hidden — coverage varies a lot across these records.
const DETAIL_GROUPS = {
  customer: [
    ['Identity', [
      ['code', 'Code'], ['ref_code', 'Ref code'], ['name', 'Name'],
      ['short_name', 'Short name'], ['customer_group', 'Group'],
    ]],
    ['Contact', [
      ['contact', 'Contact'], ['phone', 'Phone'], ['phone2', 'Phone 2'],
      ['mobile', 'Mobile'], ['fax', 'Fax'], ['email', 'Email'],
      ['email2', 'Email 2'], ['website', 'Website'],
    ]],
    ['Address', [['address', 'Address'], ['city', 'City'], ['country', 'Country']]],
    ['Commercial', [
      ['currency', 'Currency'], ['payment_terms', 'Payment terms'],
      ['payment_method', 'Payment method'], ['credit_limit', 'Credit limit'],
      ['markup', 'Markup'], ['ship_method', 'Ship method'],
      ['shipment_terms', 'Shipment terms'], ['sales_team', 'Sales team'],
      ['salesman', 'Salesman'],
    ]],
    ['Accounts contacts', [
      ['ar_contact', 'AR contact'], ['ar_email', 'AR email'],
      ['coos_contact', 'COOS contact'], ['coos_email', 'COOS email'],
    ]],
    ['Document remarks', [
      ['quotation_remarks', 'Quotation'], ['order_remarks', 'Sales order'],
      ['invoice_remarks', 'Invoice'], ['remarks', 'General'],
    ]],
  ],
  supplier: [
    ['Identity', [
      ['code', 'Code'], ['ref_code', 'Ref code'], ['name', 'Name'],
      ['short_name', 'Short name'], ['type', 'Type'],
    ]],
    ['Contact', [
      ['contact', 'Contact'], ['phone', 'Phone'], ['phone2', 'Phone 2'],
      ['mobile', 'Mobile'], ['fax', 'Fax'], ['email', 'Email'], ['website', 'Website'],
    ]],
    ['Address', [
      ['address', 'Address'], ['ship_address', 'Ship-from address'],
      ['city', 'City'], ['country', 'Country'],
    ]],
    ['Commercial', [
      ['currency', 'Currency'], ['payment_terms', 'Payment terms'],
      ['payment_method', 'Payment method'], ['ship_method', 'Ship method'],
      ['shipment_terms', 'Shipment terms'],
    ]],
  ],
}

// Render a cell value based on its column type.
function cellValue(col, row) {
  const v = col.compute ? col.compute(row) : row[col.key]
  if (col.bool) {
    return v
      ? <span className="inline-block px-1.5 py-0.5 rounded-none text-xs bg-blue-100 text-blue-700">Yes</span>
      : <span className="text-platinum">—</span>
  }
  if (col.num) {
    if (v === null || v === undefined || v === '') return <span className="text-platinum">—</span>
    // Quantities are counts, not money — don't force 2 decimals (some are
    // fractional from weight-based items, so allow up to 4 when present).
    if (col.qty) {
      const n = Number(v)
      const txt = n.toLocaleString(undefined, { maximumFractionDigits: 4 })
      return <span className={n < 0 ? 'text-red-600' : n === 0 ? 'text-ink-60' : ''}>{txt}</span>
    }
    if (col.int) return Number(v).toLocaleString()
    return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (col.date) {
    return v ? String(v).slice(0, 10) : <span className="text-platinum">—</span>
  }
  if (col.badge) {
    if (!v) return <span className="text-platinum">—</span>
    const green = /confirm|complet|paid|ship|done/i.test(v)
    return <span className={`inline-block px-1.5 py-0.5 rounded-none text-xs ${green ? 'bg-green-100 text-green-700' : 'bg-ivory-dark text-ink-70'}`}>{v}</span>
  }
  return (v ?? null) === null ? <span className="text-platinum">—</span> : v
}

const money = (v) => (v === null || v === undefined || v === '')
  ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const price4 = (v) => (v === null || v === undefined || v === '')
  ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })

// Per-(item, customer, currency) price summary over the current result set —
// the "what did we last charge, and is it trending up or down" answer that a
// quote or a price-adjustment decision needs. Prices are per-unit net
// (line amount ÷ qty) in each invoice's own currency; currencies are never
// mixed within a row.
function PriceSummary({ rows }) {
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      if (r.net_price == null) continue
      const key = `${r.item_code}||${r.customer || '—'}||${r.currency || '—'}`
      if (!m.has(key)) m.set(key, { item_code: r.item_code, customer: r.customer || '—', currency: r.currency || '—', pts: [] })
      m.get(key).pts.push({ date: r.date ? String(r.date).slice(0, 10) : '', net: Number(r.net_price), qty: Number(r.qty) || 0 })
    }
    const out = []
    for (const g of m.values()) {
      g.pts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      const nets = g.pts.map(p => p.net)
      const first = g.pts[0], last = g.pts[g.pts.length - 1]
      out.push({
        ...g, n: g.pts.length,
        firstDate: first.date, lastDate: last.date,
        firstNet: first.net, lastNet: last.net,
        min: Math.min(...nets), max: Math.max(...nets),
        delta: first.net ? (last.net - first.net) / first.net : null,
      })
    }
    // Biggest recent business first (by last unit price × line count is noisy;
    // sort by customer then item so a customer's rows sit together).
    out.sort((a, b) => a.customer.localeCompare(b.customer) || a.item_code.localeCompare(b.item_code))
    return out
  }, [rows])

  const multiItem = new Set(groups.map(g => g.item_code)).size > 1
  if (!groups.length) return null

  return (
    <div className="bg-white border border-warm-grey rounded-none overflow-hidden mb-4">
      <div className="px-3 py-2 border-b border-warm-grey bg-ivory text-xs text-ink-60 font-medium">
        Price summary — {groups.length} customer{groups.length === 1 ? '' : 's'}
        {multiItem ? ' · multiple items in view' : ''}. Net = line total ÷ qty, in each invoice's currency.
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-60 border-b border-warm-grey">
              {multiItem && <th className="px-3 py-2 font-medium whitespace-nowrap">Item</th>}
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Curr</th>
              <th className="px-3 py-2 font-medium text-right">Invoices</th>
              <th className="px-3 py-2 font-medium text-right">First</th>
              <th className="px-3 py-2 font-medium text-right">Latest</th>
              <th className="px-3 py-2 font-medium text-right">Change</th>
              <th className="px-3 py-2 font-medium text-right">Min</th>
              <th className="px-3 py-2 font-medium text-right">Max</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => (
              <tr key={i} className="border-b border-warm-grey last:border-0 hover:bg-ivory">
                {multiItem && <td className="px-3 py-2 font-mono text-xs align-top">{g.item_code}</td>}
                <td className="px-3 py-2 align-top">{g.customer}</td>
                <td className="px-3 py-2 align-top">{g.currency}</td>
                <td className="px-3 py-2 text-right tabular-nums align-top">{g.n}</td>
                <td className="px-3 py-2 text-right tabular-nums align-top">
                  {price4(g.firstNet)}<span className="block text-2xs text-ink-60">{g.firstDate}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums align-top font-semibold text-ink">
                  {price4(g.lastNet)}<span className="block text-2xs text-ink-60 font-normal">{g.lastDate}</span>
                </td>
                <td className={`px-3 py-2 text-right tabular-nums align-top ${
                  g.delta == null ? 'text-platinum' : g.delta > 0.0001 ? 'text-green-700' : g.delta < -0.0001 ? 'text-red-600' : 'text-ink-60'
                }`}>
                  {g.delta == null ? '—' : `${g.delta > 0 ? '+' : ''}${(g.delta * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums align-top text-ink-60">{price4(g.min)}</td>
                <td className="px-3 py-2 text-right tabular-nums align-top text-ink-60">{price4(g.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Full record for one customer / supplier. Reads the row already loaded by the
// list query — no extra fetch.
function DetailModal({ entity, row, onClose }) {
  const groups = DETAIL_GROUPS[entity] || []
  const has = (v) => v !== null && v !== undefined && v !== ''

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="bg-white rounded-none shadow-xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-warm-grey">
          <div>
            <div className="font-mono text-xs text-ink-60">{row.code}</div>
            <h2 className="text-lg text-ink">{row.name}</h2>
            <span className={`inline-block mt-1 px-1.5 py-0.5 rounded-none text-xs ${
 row.active ? 'bg-green-100 text-green-700' : 'bg-ivory-dark text-ink-60'
            }`}>{row.active ? 'Active' : 'Expired'}</span>
          </div>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70 p-1"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {groups.map(([title, fields]) => {
            const shown = fields.filter(([k]) => has(row[k]))
            if (!shown.length) return null
            return (
              <div key={title}>
                <h3 className="text-xs text-ink-60 uppercase tracking-wide mb-2">{title}</h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {shown.map(([k, label]) => (
                    <div key={k} className="flex gap-2 text-sm">
                      <dt className="text-ink-60 shrink-0 w-32">{label}</dt>
                      <dd className="text-ink break-words min-w-0">
                        {typeof row[k] === 'number' ? row[k].toLocaleString() : String(row[k])}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )
          })}

          {/* The ERP has no usable bank master (see V7.15_ERP_Inventory.md), so
              say so rather than leaving a silent gap where banking should be. */}
          <div className="text-xs text-ink-60 bg-ivory border border-warm-grey rounded-none px-3 py-2">
            No bank / remittance details: the ERP never stored them
            {row.bank_code ? <> (only a legacy bank code, <span className="font-mono">{row.bank_code}</span>)</> : null}.
          </div>
        </div>

        <div className="px-5 py-3 border-t border-warm-grey text-xs text-ink-60">
          Last updated in ERP: {row.last_update ? String(row.last_update).slice(0, 10) : '—'}
        </div>
      </div>
    </div>
  )
}

// Modal showing the line items, surcharges, and full money breakdown of one
// sales invoice / order.
function LinesModal({ title, code, header, rows, surcharges, loading, error, onClose }) {
  const num = (v) => Number(v) || 0
  const subtotal = rows.reduce((s, r) => s + num(r.amount), 0)
  const discount = num(header?.discount)
  const surchargeTotal = surcharges.reduce((s, r) => s + num(r.amount), 0)
  const tax = num(header?.tax)
  const grandTotal = header?.amount != null ? num(header.amount) : subtotal - discount + surchargeTotal + tax
  const deposit = num(header?.deposit)
  const balance = grandTotal - deposit
  const curr = header?.currency ? ` ${header.currency}` : ''
  const SummaryRow = ({ label, value, strong, sign }) => (
    <div className={`flex justify-between gap-8 py-0.5 ${strong ? 'font-semibold text-ink border-t border-warm-grey mt-1 pt-1.5' : 'text-ink-70'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{sign === '-' && value ? '−' : ''}{money(value)}{curr}</span>
    </div>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-none shadow-xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-warm-grey">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-teal-600" />
            <h2 className=" text-ink">{title}</h2>
            <span className="font-mono text-xs text-ink-60">{code}</span>
          </div>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70 p-1"><X size={18} /></button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-auto">
          {loading && <p className="text-sm text-ink-60 py-6 text-center">Loading lines…</p>}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-none px-3 py-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-ink-60 py-6 text-center">No line items on this document.</p>
          )}
          {!loading && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-60 border-b border-warm-grey">
                  <th className="px-2 py-1.5 font-medium">#</th>
                  <th className="px-2 py-1.5 font-medium">Item</th>
                  <th className="px-2 py-1.5 font-medium">Description</th>
                  <th className="px-2 py-1.5 font-medium text-right">Qty</th>
                  <th className="px-2 py-1.5 font-medium text-right">Unit Price</th>
                  <th className="px-2 py-1.5 font-medium text-right">Markup</th>
                  <th className="px-2 py-1.5 font-medium text-right">Marked Unit Price</th>
                  <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  // JES's own line grid shows three price columns, not two: a
                  // reference Unit Price, a per-line Markup/Discount factor
                  // (e.g. 0.70 — independent of the header's own discount),
                  // and the Marked Unit Price that factor produces. Only the
                  // first and the resulting Amount are stored; Marked Unit
                  // Price is derived here exactly as JES derives it.
                  const hasMarkup = r.markup !== null && r.markup !== undefined && Number(r.markup) !== 1
                  const marked = r.markup != null ? Number(r.unit_price || 0) * Number(r.markup) : null
                  return (
                    <tr key={i} className="border-b border-warm-grey hover:bg-ivory">
                      <td className="px-2 py-1.5 text-ink-60 tabular-nums">{r.seq}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">{r.item_code}</td>
                      <td className="px-2 py-1.5">{r.description}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.qty}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(r.unit_price)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${hasMarkup ? 'text-amber-700 font-medium' : 'text-platinum'}`}>
                        {r.markup != null ? Number(r.markup).toFixed(2) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{marked != null ? money(marked) : '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{money(r.amount)}</td>
                    </tr>
                  )
                })}
                {surcharges.map((s, i) => (
                  <tr key={`s${i}`} className="border-b border-warm-grey bg-amber-50/40">
                    <td className="px-2 py-1.5 text-ink-60"></td>
                    <td className="px-2 py-1.5 text-xs text-amber-700">{s.code || 'CHARGE'}</td>
                    <td className="px-2 py-1.5 text-ink-70" colSpan={5}>{s.description}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && !error && (rows.length > 0 || surcharges.length > 0) && (
            <div className="mt-4 ml-auto w-full max-w-xs text-sm">
              <SummaryRow label="Subtotal" value={subtotal} />
              {discount > 0 && <SummaryRow label="Discount" value={discount} sign="-" />}
              {surchargeTotal > 0 && <SummaryRow label="Surcharges (freight, etc.)" value={surchargeTotal} />}
              {tax > 0 && <SummaryRow label="Tax / GST" value={tax} />}
              <SummaryRow label="Grand total" value={grandTotal} strong />
              {deposit > 0 && <SummaryRow label="Deposit paid" value={deposit} sign="-" />}
              {deposit > 0 && <SummaryRow label="Balance due" value={balance} strong />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const fmtQty = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 })

// Modal showing the recursive BOM explosion of one item.
function BomModal({ code, rows, loading, error, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="bg-white rounded-none shadow-xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-warm-grey">
          <div className="flex items-center gap-2">
            <ListTree size={18} className="text-teal-600" />
            <h2 className=" text-ink">Bill of Materials</h2>
            <span className="font-mono text-xs text-ink-60">{code}</span>
          </div>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70 p-1"><X size={18} /></button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-auto">
          {loading && <p className="text-sm text-ink-60 py-6 text-center">Exploding BOM…</p>}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-none px-3 py-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-ink-60 py-6 text-center">No components found for this item.</p>
          )}
          {!loading && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-60 border-b border-warm-grey">
                  <th className="px-2 py-1.5 font-medium">Component</th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium text-right">Qty</th>
                  <th className="px-2 py-1.5 font-medium text-right">Ext. Qty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-warm-grey hover:bg-ivory">
                    <td className="px-2 py-1.5 font-mono text-xs" style={{ paddingLeft: `${(r.level - 1) * 20 + 8}px` }}>
                      {r.is_assembly && <span className="text-ink-60 mr-1">▸</span>}
                      {r.component_code}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.component_type && (
                        <span className="inline-block px-1.5 py-0.5 rounded-none text-xs bg-ivory-dark text-ink-70">{r.component_type}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-60">{fmtQty(r.qty)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtQty(r.ext_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-2.5 border-t border-warm-grey text-xs text-ink-60">
          Indented rows are sub-assemblies exploded to their components. Ext. Qty = quantity per one finished unit.
        </div>
      </div>
    </div>
  )
}

// "21 Jul 13:28". Accepts both shapes the two fields come in: an ISO timestamp
// with a zone (last_run_at) and JES's naive "2026-07-21 11:45:07" (the
// watermark), which is local time and must not be read as UTC.
// Enlarged item image. The item master is the one place a picture answers the
// question faster than any field does — "is this the right part?" is visual.
function PhotoModal({ url, row, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-white rounded-none shadow-2xl max-w-lg w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-warm-grey">
          <div className="min-w-0">
            <div className="font-mono text-sm text-ink truncate">{row.code}</div>
            <div className="text-xs text-ink-60 truncate">{row.name}</div>
          </div>
          <button onClick={onClose} className="text-ink-60 hover:text-ink-70 shrink-0"><X size={18} /></button>
        </div>
        <img src={url} alt={row.code} className="w-full max-h-[70vh] object-contain bg-ivory" />
        <div className="px-4 py-2 text-2xs text-ink-60 font-mono truncate border-t border-warm-grey">{row.picture1}</div>
      </div>
    </div>
  )
}

function fmtSyncTime(v) {
  if (!v) return '—'
  const iso = typeof v === 'string' && !v.includes('T') && !v.endsWith('Z')
    ? v.replace(' ', 'T')            // naive → parsed in the reader's own zone
    : v
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 16)
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function ErpLookup() {
  const can = useCan()
  // V8.14 — the `erp` module is all-or-nothing (owner's call); the full
  // entity set is visible to anyone who has it. The customer-import helper
  // (below) still needs the `customers` module, or its read permission-denies.
  const canCustomers = can('customers')
  const entityKeys = Object.keys(ENTITIES)
  const [entity, setEntity] = useState('customer')
  const [q, setQ] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [limit, setLimit] = useState(50)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Inventory: warehouse + item-type pickers (loaded once) and their selections.
  const [sync, setSync] = useState(null)
  const [images, setImages] = useState({})   // picture1 filename -> signed URL
  const [photo, setPhoto] = useState(null)   // { url, row } — enlarged view
  const [importCode, setImportCode] = useState('')   // ERP code being imported
  const [rangeProducts, setRangeProducts] = useState([])
  const [existingErpCodes, setExistingErpCodes] = useState(() => new Set())  // customers.erp_code already in the app
  const [selectedCustomers, setSelectedCustomers] = useState(() => new Set())
  const [importingCustomers, setImportingCustomers] = useState(false)
  const [existingSupplierErpCodes, setExistingSupplierErpCodes] = useState(() => new Set())  // suppliers.erp_code already in the app
  const [selectedSuppliers, setSelectedSuppliers] = useState(() => new Set())
  const [importingSuppliers, setImportingSuppliers] = useState(false)

  // Is this ERP code's design already a product here? Uses the app's own
  // matcher, which reconciles a full variant code (D0002-001-CGR) against
  // however design_code happens to be stored.
  const productIndex = useMemo(() => buildProductIndex(rangeProducts), [rangeProducts])
  const inApp = (code) => !!matchProductCode(designBaseOf(code), productIndex)
  const [warehouses, setWarehouses] = useState([])
  const [itemTypes, setItemTypes] = useState([])
  const [warehouse, setWarehouse] = useState('')       // '' = all warehouses
  const [itemType, setItemType] = useState('')         // '' = all types
  const [nonZeroOnly, setNonZeroOnly] = useState(true)

  // Customer / supplier detail panel (uses the already-loaded row).
  const [detailRow, setDetailRow] = useState(null)

  // BOM modal state
  const [bomCode, setBomCode] = useState(null)
  const [bomRows, setBomRows] = useState([])
  const [bomLoading, setBomLoading] = useState(false)
  const [bomError, setBomError] = useState('')

  const cfg = ENTITIES[entity]

  async function openBom(code) {
    setBomCode(code); setBomRows([]); setBomError(''); setBomLoading(true)
    try {
      setBomRows(await erpBom(code))
    } catch (e) {
      setBomError(e.message)
    } finally {
      setBomLoading(false)
    }
  }

  // Lines (sales invoice / order detail) modal state
  const [lines, setLines] = useState(null)       // { of, code, title, header } | null
  const [linesRows, setLinesRows] = useState([])
  const [linesSurcharges, setLinesSurcharges] = useState([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [linesError, setLinesError] = useState('')

  async function openLines(of, row) {
    const title = { sales_invoice: 'Sales Invoice', sales_order: 'Sales Order', purchase: 'Purchase Order' }[of] || 'Document'
    setLines({ of, code: row.code, title, header: row })
    setLinesRows([]); setLinesSurcharges([]); setLinesError(''); setLinesLoading(true)
    try {
      const data = await erpLines(of, row.code)
      setLinesRows(data.rows); setLinesSurcharges(data.surcharges)
    } catch (e) {
      setLinesError(e.message)
    } finally {
      setLinesLoading(false)
    }
  }

  // Item images. Signed per visible page rather than per row: one request for
  // the whole list instead of 50, and the URLs expire in an hour so there is
  // no point caching them beyond the current view.
  //
  // 22,437 of 29,263 distinct picture1 filenames have an object behind them —
  // the rest are referenced by the ERP but were missing from the image folder.
  // A filename with no object is simply absent from the response, so those
  // rows fall back to the placeholder instead of a broken image.
  useEffect(() => {
    if (entity !== 'item') { setImages({}); return }
    const paths = [...new Set(rows.map(r => r.picture1).filter(Boolean))]
    if (!paths.length) { setImages({}); return }
    let alive = true
    erpItemImages(paths).then(u => { if (alive) setImages(u) }).catch(() => {})
    return () => { alive = false }
  }, [entity, rows])

  // The app's own figurines, loaded once. Only used to mark which ERP items
  // are already in the app, and to stop an import creating a second product for
  // a design that already has one.
  useEffect(() => {
    let alive = true
    getDocs(collection(db, 'range_products'))
      .then(s => { if (alive) setRangeProducts(s.docs.map(d => ({ id: d.id, ...d.data() }))) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Same idea for customers: which JES customer codes are already linked to an
  // app Customer, so an ERP row can be marked "in app" and excluded from import.
  // Skipped without the `customers` module — the read would permission-deny.
  useEffect(() => {
    if (!canCustomers) return
    let alive = true
    loadCustomers()
      .then(list => { if (alive) setExistingErpCodes(new Set(list.map(c => String(c.erp_code || '').toUpperCase()).filter(Boolean))) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // And for suppliers.
  useEffect(() => {
    let alive = true
    getDocs(collection(db, 'suppliers'))
      .then(s => { if (alive) setExistingSupplierErpCodes(new Set(s.docs.map(d => String(d.data().erp_code || '').toUpperCase()).filter(Boolean))) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Sync freshness. Loaded once; a failure leaves the line hidden rather than
  // showing a wrong or alarming value.
  useEffect(() => {
    let alive = true
    erpSyncStatus().then(s => { if (alive) setSync(s) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // Picker lists for the Inventory tab. Loaded once, on first use.
  useEffect(() => {
    if (!cfg.hasWarehouse || warehouses.length) return
    let alive = true
    Promise.all([
      erpLookup('warehouse', { limit: 100 }),
      erpLookup('item_type', { limit: 100 }),
    ])
      .then(([whs, types]) => {
        if (!alive) return
        setWarehouses(whs); setItemTypes(types)
      })
      .catch(() => { /* pickers stay empty; the stock list still loads */ })
    return () => { alive = false }
  }, [cfg.hasWarehouse, warehouses.length])

  // Debounced lookup on any input change.
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    const t = setTimeout(async () => {
      try {
        const r = await erpLookup(entity, {
          q, activeOnly, limit: cfg.limit || limit,
          filters: cfg.hasWarehouse ? { warehouse, item_type: itemType } : {},
          nonZeroOnly: cfg.hasWarehouse ? nonZeroOnly : false,
        })
        if (alive) setRows(r)
      } catch (e) {
        if (alive) { setError(e.message); setRows([]) }
      } finally {
        if (alive) setLoading(false)
      }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [entity, q, activeOnly, warehouse, itemType, nonZeroOnly, limit, cfg])

  // Only rows not already linked to an app customer can be selected/imported.
  const importableCustomerRows = entity === 'customer'
    ? rows.filter(r => !existingErpCodes.has(String(r.code).toUpperCase()))
    : []
  const allCustomersShownSelected = importableCustomerRows.length > 0
    && importableCustomerRows.every(r => selectedCustomers.has(r.code))

  function toggleCustomerSel(code) {
    setSelectedCustomers(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
  }
  function toggleAllCustomerSel() {
    setSelectedCustomers(prev => {
      const n = new Set(prev)
      if (allCustomersShownSelected) importableCustomerRows.forEach(r => n.delete(r.code))
      else importableCustomerRows.forEach(r => n.add(r.code))
      return n
    })
  }

  async function handleImportCustomers() {
    const codes = selectedCustomers
    const toImport = rows.filter(r => codes.has(r.code))
    if (!toImport.length) return
    if (!window.confirm(`Import ${toImport.length} customer${toImport.length === 1 ? '' : 's'} from JES into the app?`)) return
    setImportingCustomers(true)
    try {
      const { created, skipped } = await importErpCustomers(toImport)
      setExistingErpCodes(prev => {
        const n = new Set(prev)
        created.forEach(c => n.add(String(c.erpCode).toUpperCase()))
        return n
      })
      setSelectedCustomers(new Set())
      window.alert(
        `Imported ${created.length} customer${created.length === 1 ? '' : 's'}.` +
        (skipped.length ? ` ${skipped.length} already linked, skipped.` : '')
      )
    } catch (e) {
      window.alert(e.message || 'Import failed.')
    } finally {
      setImportingCustomers(false)
    }
  }

  // Only rows not already linked to an app supplier can be selected/imported.
  const importableSupplierRows = entity === 'supplier'
    ? rows.filter(r => !existingSupplierErpCodes.has(String(r.code).toUpperCase()))
    : []
  const allSuppliersShownSelected = importableSupplierRows.length > 0
    && importableSupplierRows.every(r => selectedSuppliers.has(r.code))

  function toggleSupplierSel(code) {
    setSelectedSuppliers(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
  }
  function toggleAllSupplierSel() {
    setSelectedSuppliers(prev => {
      const n = new Set(prev)
      if (allSuppliersShownSelected) importableSupplierRows.forEach(r => n.delete(r.code))
      else importableSupplierRows.forEach(r => n.add(r.code))
      return n
    })
  }

  async function handleImportSuppliers() {
    const codes = selectedSuppliers
    const toImport = rows.filter(r => codes.has(r.code))
    if (!toImport.length) return
    if (!window.confirm(`Import ${toImport.length} supplier${toImport.length === 1 ? '' : 's'} from JES into the app?`)) return
    setImportingSuppliers(true)
    try {
      const { created, skipped } = await importErpSuppliers(toImport)
      setExistingSupplierErpCodes(prev => {
        const n = new Set(prev)
        created.forEach(c => n.add(String(c.erpCode).toUpperCase()))
        return n
      })
      setSelectedSuppliers(new Set())
      window.alert(
        `Imported ${created.length} supplier${created.length === 1 ? '' : 's'}.` +
        (skipped.length ? ` ${skipped.length} already linked, skipped.` : '')
      )
    } catch (e) {
      window.alert(e.message || 'Import failed.')
    } finally {
      setImportingSuppliers(false)
    }
  }

  return (
    <div className="p-4 md:p-6">
      {loading && <LoadingBar />}
      {photo && <PhotoModal url={photo.url} row={photo.row} onClose={() => setPhoto(null)} />}
      {importCode && (
        <ErpProductImport
          products={rangeProducts}
          initialCode={importCode}
          onClose={() => setImportCode('')}
        />
      )}

      <div className="mb-4">
        <h1 className="text-xl md:text-2xl text-ink flex items-center gap-2">
          <Database size={22} className="text-teal-600" /> ERP Lookup
        </h1>
        <p className="text-sm text-ink-60 mt-0.5">
          Read-only search of the legacy JES ERP archive. Reflects the last data sync — not live.
        </p>
        {/* Two different times, deliberately both shown. "Synced" is when the
            mirror last ran; "JES data to" is the newest edit it actually
            carries. They diverge whenever nothing has changed in JES since the
            previous run, and only the second one answers "is my order in here
            yet?". Sync runs on the office LAN only, so this can be days old. */}
        {sync && (
          <p className="text-xs text-ink-60 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span title={sync.synced_at || ''}>
              Synced <strong className="font-medium text-ink-60">{fmtSyncTime(sync.synced_at)}</strong>
            </span>
            {sync.data_through && (
              <span title={sync.data_through}>
                JES data to <strong className="font-medium text-ink-60">{fmtSyncTime(sync.data_through)}</strong>
              </span>
            )}
            {sync.tables ? <span>{Number(sync.rows_mirrored).toLocaleString()} rows · {sync.tables} tables</span> : null}
          </p>
        )}
      </div>

      {/* Entity toggle — an even grid rather than one overflowing row: enough
          tabs now that a single row runs off a laptop viewport, and a plain
          wrap left one lonely tab on row 2. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-none border border-warm-grey bg-white p-1 mb-4">
        {entityKeys.map((key) => {
          const e = ENTITIES[key]
          const on = entity === key
          return (
            <button
              key={key}
              onClick={() => { setEntity(key); setRows([]); setSelectedCustomers(new Set()); setSelectedSuppliers(new Set()) }}
              className={`flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm rounded-none transition ${
 on ? 'bg-teal-600 text-white' : 'text-ink-70 hover:bg-ivory'
              }`}
            >
              <e.Icon size={15} className="shrink-0" /> {e.label}
            </button>
          )
        })}
      </div>

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-60" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${cfg.label.toLowerCase()} by code or name…`}
            className="w-full pl-9 pr-3 py-2 text-sm border border-warm-grey rounded-none
 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
          />
        </div>
        {cfg.hasWarehouse && (
          <>
            <select
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              className="px-3 py-2 text-sm border border-warm-grey rounded-none bg-white
 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
            >
              <option value="">All warehouses</option>
              {/* Only warehouses that actually hold stock — 49 exist in the ERP
                  but ~16 are in use, and the rest are dead entries. */}
              {warehouses
                .filter((w) => w.stock_items > 0)
                .sort((a, b) => b.stock_items - a.stock_items)
                .map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.code}{w.name ? ` — ${w.name}` : ''} ({w.stock_items.toLocaleString()})
                  </option>
                ))}
            </select>
            <select
              value={itemType}
              onChange={(e) => setItemType(e.target.value)}
              className="px-3 py-2 text-sm border border-warm-grey rounded-none bg-white
 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
            >
              <option value="">All types</option>
              {/* Only types that actually appear in stock (5 of the ERP's 6). */}
              {itemTypes
                .filter((t) => t.stock_items > 0)
                .sort((a, b) => b.stock_items - a.stock_items)
                .map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name || t.code} ({t.stock_items.toLocaleString()})
                  </option>
                ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-ink-70 select-none">
              <input type="checkbox" checked={nonZeroOnly} onChange={(e) => setNonZeroOnly(e.target.checked)}
                     className="rounded-none border-warm-grey text-teal-600 focus:ring-teal-500" />
              In stock only
            </label>
          </>
        )}
        {ACTIVE_FILTER.has(entity) && (
          <label className="flex items-center gap-2 text-sm text-ink-70 select-none">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)}
                   className="rounded-none border-warm-grey text-teal-600 focus:ring-teal-500" />
            Active only
          </label>
        )}
        {!cfg.limit && (
          <label className="flex items-center gap-2 text-sm text-ink-70 select-none">
            Show
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="px-2 py-1.5 text-sm border border-warm-grey rounded-none bg-white
 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </label>
        )}
      </div>

      {/* Inventory: make the provenance explicit — this is a computed balance,
          not a stored one, and it is only as fresh as the last sync. */}
      {cfg.hasWarehouse && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-none px-3 py-2 mb-4">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            Balances are <strong>computed from the movement ledger</strong> (sum of all stock
            transactions), not read from the ERP's stored balance table — that table is a stale
            snapshot. Figures reflect the last sync.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-none px-3 py-2 mb-4">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Import old JES customers into the app. Tick rows (already-linked ones
          are disabled, per existingErpCodes) and import — a real Customer
          record is created per code, tagged erp-import, never duplicated on a
          re-import since it dedupes on erp_code. */}
      {entity === 'customer' && (
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap min-h-[24px]">
          <p className="text-xs text-ink-60">
            Tick rows to import as app Customers — already-linked ones are disabled.
          </p>
          {selectedCustomers.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-60">{selectedCustomers.size} selected</span>
              <button onClick={() => setSelectedCustomers(new Set())} className="text-xs text-ink-60 hover:text-ink-80">Clear</button>
              <button onClick={handleImportCustomers} disabled={importingCustomers}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 border border-brand-200 rounded-none px-2 py-1 disabled:opacity-50">
                <Download size={13} /> {importingCustomers ? 'Importing…' : 'Import as Customers'}
              </button>
            </div>
          )}
        </div>
      )}
      {entity === 'supplier' && (
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap min-h-[24px]">
          <p className="text-xs text-ink-60">
            Tick rows to import as app Suppliers — already-linked ones are disabled.
          </p>
          {selectedSuppliers.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-60">{selectedSuppliers.size} selected</span>
              <button onClick={() => setSelectedSuppliers(new Set())} className="text-xs text-ink-60 hover:text-ink-80">Clear</button>
              <button onClick={handleImportSuppliers} disabled={importingSuppliers}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 border border-brand-200 rounded-none px-2 py-1 disabled:opacity-50">
                <Download size={13} /> {importingSuppliers ? 'Importing…' : 'Import as Suppliers'}
              </button>
            </div>
          )}
        </div>
      )}

      {entity === 'item_history' && rows.length > 0 && <PriceSummary rows={rows} />}

      {/* Results */}
      <div className="bg-white border border-warm-grey rounded-none overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-60 border-b border-warm-grey bg-ivory">
                {entity === 'customer' && (
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={allCustomersShownSelected} onChange={toggleAllCustomerSel}
                           className="rounded-none border-warm-grey text-teal-600 focus:ring-teal-500"
                           title="Select all shown (not already in the app)" />
                  </th>
                )}
                {entity === 'supplier' && (
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={allSuppliersShownSelected} onChange={toggleAllSupplierSel}
                           className="rounded-none border-warm-grey text-teal-600 focus:ring-teal-500"
                           title="Select all shown (not already in the app)" />
                  </th>
                )}
                {cfg.cols.map((c) => (
                  <th key={c.key} className={`px-3 py-2 font-medium whitespace-nowrap ${c.num ? 'text-right' : ''}`}>{c.label}</th>
                ))}
                {!cfg.noTrailing && (
                  <th className="px-3 py-2 font-medium">{cfg.trailingLabel || (cfg.linesOf ? 'Lines' : cfg.crossLink ? 'ERP' : 'Status')}</th>
                )}
                {entity === 'item' && <th className="px-3 py-2 font-medium w-14"></th>}
              </tr>
            </thead>
            <tbody>
              {/* Stock rows have no `code` — the same item appears once per
                  warehouse, so those key on the warehouse/item pair. */}
              {rows.map((r, ri) => (
                <tr key={r.invoice_no != null && r.seq != null ? `${r.invoice_no}/${r.seq}` : r.code ?? r.uc_no ?? (r.item_code ? `${r.warehouse}/${r.item_code}` : ri)}
                    className="border-b border-warm-grey last:border-0 hover:bg-ivory">
                  {entity === 'customer' && (
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selectedCustomers.has(r.code)}
                             disabled={existingErpCodes.has(String(r.code).toUpperCase())}
                             onChange={() => toggleCustomerSel(r.code)}
                             className="rounded-none border-warm-grey text-teal-600 focus:ring-teal-500 disabled:opacity-30" />
                    </td>
                  )}
                  {entity === 'supplier' && (
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selectedSuppliers.has(r.code)}
                             disabled={existingSupplierErpCodes.has(String(r.code).toUpperCase())}
                             onChange={() => toggleSupplierSel(r.code)}
                             className="rounded-none border-warm-grey text-teal-600 focus:ring-teal-500 disabled:opacity-30" />
                    </td>
                  )}
                  {cfg.cols.map((c) => (
                    <td key={c.key} className={`px-3 py-2 align-top ${c.mono ? 'font-mono text-xs' : ''} ${c.grow ? '' : 'whitespace-nowrap'} ${c.num ? 'text-right tabular-nums' : ''} ${c.strong ? 'font-semibold text-ink' : ''}`}>
                      {entity === 'item' && c.key === 'has_bom' && r.has_bom
                        ? <div className="flex items-center gap-2">
                            <button onClick={() => openBom(r.code)}
                              className="inline-flex items-center gap-0.5 text-teal-600 hover:underline text-xs font-medium">
                              <ListTree size={13} /> View
                            </button>
                            {/* Import only makes sense for a finished good — a
                                figurine — and only when the app has no product
                                for that design yet. */}
                            {String(r.type).toUpperCase() === 'FG' && (
                              inApp(r.code)
                                ? <span className="text-2xs text-ink-60" title="This design is already a product in the app">in app</span>
                                : <button onClick={() => setImportCode(r.code)}
                                    className="inline-flex items-center gap-0.5 text-brand-600 hover:underline text-xs font-medium"
                                    title="Create a figurine product from this item and its BOM">
                                    <Download size={12} /> Import
                                  </button>
                            )}
                          </div>
                        : entity === 'customer' && c.key === 'name' && existingErpCodes.has(String(r.code).toUpperCase())
                        ? <span className="inline-flex items-center gap-1.5">
                            {r.name}
                            <span className="text-2xs text-teal-600 bg-teal-50 rounded-none px-1 py-0.5 shrink-0" title="Already linked to an app customer">in app</span>
                          </span>
                        : entity === 'supplier' && c.key === 'name' && existingSupplierErpCodes.has(String(r.code).toUpperCase())
                        ? <span className="inline-flex items-center gap-1.5">
                            {r.name}
                            <span className="text-2xs text-teal-600 bg-teal-50 rounded-none px-1 py-0.5 shrink-0" title="Already linked to an app supplier">in app</span>
                          </span>
                        : DETAIL_GROUPS[entity] && c.key === 'code'
                        ? <button onClick={() => setDetailRow(r)}
                            className="text-teal-600 hover:underline font-medium">
                            {r.code}
                          </button>
                        // Invoice/Sales Order customer code, PO supplier code —
                        // Cindy keys this into PBIS alongside the document
                        // (same need already covered on the app-side Sales
                        // Invoices / Shipping / Purchase Orders pages; JES
                        // Lookup itself was still missing it).
                        : (entity === 'sales_invoice' || entity === 'sales_order' || entity === 'item_history') && c.key === 'customer' && r.customer_code
                        ? <span className="inline-flex items-center gap-1.5 flex-wrap">
                            {r.customer}
                            <span className="text-2xs text-ink-60 font-mono">{r.customer_code}</span>
                          </span>
                        : entity === 'purchase' && c.key === 'supplier' && r.supplier_code
                        ? <span className="inline-flex items-center gap-1.5 flex-wrap">
                            {r.supplier}
                            <span className="text-2xs text-ink-60 font-mono">{r.supplier_code}</span>
                          </span>
                        : cellValue(c, r)}
                    </td>
                  ))}
                  {!cfg.noTrailing && (
                  <td className="px-3 py-2">
                    {cfg.linesOf ? (
                      <button onClick={() => openLines(cfg.linesOf, r)}
                        className="inline-flex items-center gap-0.5 text-teal-600 hover:underline text-xs font-medium">
                        <FileText size={13} /> Lines
                      </button>
                    ) : cfg.crossLink ? (
                      r[cfg.crossLink.key]
                        ? <button onClick={() => openLines(cfg.crossLink.of, { code: r[cfg.crossLink.key], currency: r.currency })}
                            className="inline-flex items-center gap-0.5 text-teal-600 hover:underline text-xs font-medium">
                            <FileText size={13} /> Invoice
                          </button>
                        : <span className="text-platinum text-xs">—</span>
                    ) : (
                      <span className={`inline-block px-1.5 py-0.5 rounded-none text-xs ${
 r.active ? 'bg-green-100 text-green-700' : 'bg-ivory-dark text-ink-60'
                      }`}>{r.active ? 'Active' : 'Expired'}</span>
                    )}
                  </td>
                  )}
                  {entity === 'item' && (
                    <td className="px-3 py-2">
                      {images[r.picture1] ? (
                        <button type="button" onClick={() => setPhoto({ url: images[r.picture1], row: r })}
                                title="View image">
                          {/* loading="lazy": a 50-row page would otherwise pull
                              50 images from the CDN before any are scrolled to. */}
                          <img src={images[r.picture1]} alt="" loading="lazy"
                               className="w-9 h-9 object-cover rounded-none border border-warm-grey bg-white hover:border-teal-400" />
                        </button>
                      ) : (
                        <div className="w-9 h-9 rounded-none border border-dashed border-warm-grey flex items-center justify-center"
                             title={r.picture1 ? `${r.picture1} — referenced by the ERP but not in the image sync` : 'No image on this item'}>
                          <ImageOff size={13} className="text-platinum" />
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {!loading && rows.length === 0 && !error && (
                <tr><td colSpan={cfg.cols.length + (cfg.noTrailing ? 0 : 1) + (entity === 'item' ? 1 : 0) + (entity === 'customer' || entity === 'supplier' ? 1 : 0)} className="px-3 py-10 text-center text-ink-60">
                  {q ? `No ${cfg.label.toLowerCase()} match “${q}”.` : `No ${cfg.label.toLowerCase()} found.`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-ink-60 mt-3">
        {cfg.hasWarehouse && rows.length > 0 && (
          <>
            {rows.length.toLocaleString()} line{rows.length === 1 ? '' : 's'}
            {' · total qty '}
            {rows.reduce((s, r) => s + (Number(r.qty) || 0), 0)
              .toLocaleString(undefined, { maximumFractionDigits: 2 })}
            {' — '}
          </>
        )}
        Showing up to {(cfg.limit || limit).toLocaleString()} results. Source:{' '}
        <span className="font-mono">JES_UnitedArt</span> → Supabase mirror.
      </p>

      {detailRow && (
        <DetailModal entity={entity} row={detailRow} onClose={() => setDetailRow(null)} />
      )}
      {bomCode && (
        <BomModal code={bomCode} rows={bomRows} loading={bomLoading} error={bomError}
                  onClose={() => setBomCode(null)} />
      )}
      {lines && (
        <LinesModal title={lines.title} code={lines.code} header={lines.header}
                    rows={linesRows} surcharges={linesSurcharges}
                    loading={linesLoading} error={linesError} onClose={() => setLines(null)} />
      )}
    </div>
  )
}
