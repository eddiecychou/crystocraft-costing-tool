import { ocDateOnly } from '../ocTime.js'
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage, authHeader } from '../firebase'
import { hasIncompleteRangeLine, quoteItemToOrderLine } from '../rangeQuote'
import {
  applyExtractedPiHeader, wooRegistryAutofillFields,
  getOrder, getOrderLines, createOrderWithLinesAllocatingSo, updateOrder, saveOrderWithLines, deleteOrder,
  loadRangeProductsLite, autoMatchLines, lineClassificationPatch, rematchLines, validateOrder, computeOrderTotals,
  orderCreateFields, orderSaveFields, invoiceRegistryFields, orderEditFields,
} from '../shipping'
import { loadCustomers, saveCustomer, primaryContact } from '../domain/customer'
import { fetchErpSoLines, diffLines } from '../erpSoImport'
import { CURRENCIES } from '../constants'
import { Trash2 } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'
import LineImagePicker from '../components/LineImagePicker'
import PackingListEditor from './PackingListEditor'
import FreightComparison from './FreightComparison'
import OrderStockIssue from '../components/OrderStockIssue'
import OrderInventoryIssue from '../components/OrderInventoryIssue'
import { crystalInventory } from '../crystals'
import { packagingInventory } from '../packaging'
import { metalOrderConfig } from '../orderStock'
import { allocateSoNo, soYear } from '../soNumber'
import { allocateInvoice, upsertInvoice, updateUcInvoice, allocateOrderUc } from '../ucRegistry'
import { orderStockStatus, stockStatusDetail } from '../orderStockStatus'
import ShipmentPageHeader from '../components/shipping/ShipmentPageHeader'
import ShipmentPiUpload from '../components/shipping/ShipmentPiUpload'
import { preparePiUploadFile } from '../piUploadFile'
import ShipmentDocumentReferences from '../components/shipping/ShipmentDocumentReferences'
import ShipmentScheduleTerms from '../components/shipping/ShipmentScheduleTerms'
import { ShipmentDestination, ShipmentRemarks } from '../components/shipping/ShipmentOrderDetails'
import ShipmentLineItemsHeader from '../components/shipping/ShipmentLineItemsHeader'
import ShipmentLineRow from '../components/shipping/ShipmentLineRow'
import ShipmentCustomerCard from '../components/shipping/ShipmentCustomerCard'
import ShipmentAccountingTotal from '../components/shipping/ShipmentAccountingTotal'
import ShipmentDepositPaid from '../components/shipping/ShipmentDepositPaid'
import ShipmentDiscountRow from '../components/shipping/ShipmentDiscountRow'
import { ShipmentSubtotalRows, ShipmentTotalRow } from '../components/shipping/ShipmentOrderTotalRows'
import { invoicePaymentTotals, invoiceDepositError } from '../invoicePayments'
import { doc, onSnapshot, getDoc, getDocs, collection, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'

// A quote's Ref No. field is free text ("e.g. UC4932/26") — only sometimes
// an actual UC, never allocated through the registry (see ucRegistry.js).
// Convert to PI carries it into uc_no ONLY when it actually looks like one,
// so a quote's PO reference or a blank field doesn't masquerade as a UC and
// short-circuit doAllocateSi's "already has one" check.
const looksLikeUc = v => /^UC\s*\d/i.test(String(v || '').trim())

// Every stock class an order consumes. Order matters only for display.
const STOCK_CFGS = [metalOrderConfig, crystalInventory, packagingInventory]

// Statuses that mean the goods have physically left. Past this point, material
// consumption that was never recorded will not be — JES used to make that
// impossible (no job order, no movement); the app has to ask instead.
const SHIPPED_STATUSES = new Set(['shipped', 'delivered'])

const blankHeader = {
  customer_id: '', contact_id: '', customer_name: '', erp_pi_no: '', erp_so_no: '', erp_si_no: '', uc_no: '', customer_po: '', order_date: '',
  est_ship_date: '',
  invoiced_at: '',
  // Editable accounting date/amount for the invoice — see normOrder in
  // shipping.js. Blank invoice_date falls back to invoiced_at at print time;
  // blank accounting_total falls back to the computed total at save time.
  invoice_date: '', accounting_total: '', adjustment_reason: '',
  currency: 'USD', incoterm: 'FOB', payment_terms: '', status: 'draft',
  destination: { country: '', city: '', address: '', port: '' }, notes: '',
  // pi_subtotal / pi_total hold what the imported PI stated, for the mismatch
  // cross-check only. The order's real subtotal/total are computed from the
  // lines at save time, not carried in editable header state.
  pi_subtotal: '', pi_total: '', discount_pct: '', discount_amount: '', deposit_paid: '',
  // Recorded checkout amount for Woo's paid-in-full UC fill, not a recalculation.
  total_amount: null,
  // Print option (2026-08-26) — some customers' PIs/invoices shouldn't show a
  // combined "Total Qty" line (e.g. mixed-unit orders where a single summed
  // count is meaningless, or the customer just doesn't want it). Persisted on
  // the order so it round-trips correctly whether the print page is opened
  // now or reopened later — it's a fresh page load reading Firestore, not
  // something that can ride along as a transient prop.
  hide_total_qty: false,
  // Printed revision number — see shipping.js's normOrder comment. Blank/0
  // prints nothing ("Original"); bumped by hand, never automatically.
  pi_revision: '',
}

export default function ShipmentForm() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  // A route change must never reuse another order's editable state, pending
  // reads, stock subscription or async allocation/import state.
  const newContext = ['customer_id', 'from_quote', 'direct'].map(k => searchParams.get(k) || '')
  return <ShipmentEditor key={id ? `order:${id}` : `new:${JSON.stringify(newContext)}`} />
}

function ShipmentEditor() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Direct invoice: a retail sale with no sales order behind it. Only changes
  // how the page presents itself — the record is the same shape, it just never
  // gets an SO number. See normOrder in shipping.js for why that is legitimate.
  const isDirect = searchParams.get('direct') === '1'
  // Arrived from QuoteDetail.jsx's "Convert to PI" — see the prefill effect
  // below and looksLikeUc above.
  const fromQuoteId = searchParams.get('from_quote')
  // Arrived from "Raise invoice →" on the Sales Invoices page. The order form is
  // long and the invoice field is well down it, so landing here without being
  // shown where to go is the same discoverability problem that action fixes.
  const wantsInvoice = searchParams.get('invoice') === '1'
  const invoiceFieldRef = useRef(null)

  const [header, setHeader]   = useState(() => {
    const preCustomerId = searchParams.get('customer_id')
    return preCustomerId ? { ...blankHeader, customer_id: preCustomerId } : blankHeader
  })
  const [lines, setLines]     = useState([])
  const [customers, setCustomers] = useState([])
  const [rangeProducts, setRangeProducts] = useState([])
  const [sourceFile, setSourceFile] = useState(null)   // { url, name } existing
  const [pendingFile, setPendingFile] = useState(null) // File to upload on create

  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  // { soNo, erp, diff, adopted? } — result of checking the parse against
  // the ERP's own sales order. null when there's nothing to say.
  const [erpCheck, setErpCheck] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [loadRevision, setLoadRevision] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savePending, setSavePending] = useState(false)
  const saveInFlight = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState('order')

  useEffect(() => {
    let alive = true
    const preCustomerId = searchParams.get('customer_id')
    setFetching(isEdit)
    setLoadError('')
    setPendingFile(null); setErpCheck(null); setExtractError(''); setSiError('')
    if (!isEdit) {
      setHeader(preCustomerId ? { ...blankHeader, customer_id: preCustomerId } : blankHeader)
      setLines([]); setSourceFile(null); setTab('order')
    }
    const loads = [
      loadCustomers().then(list => {
        if (!alive) return
        setCustomers(list)
        // Resolve customer name when pre-filled from URL
        if (preCustomerId && !isEdit) {
          const c = list.find(x => x.id === preCustomerId)
          if (c) setHeader(h => ({ ...h, customer_name: c.company_name }))
        }
      }),
      loadRangeProductsLite().then(list => { if (alive) setRangeProducts(list) }),
    ]
    if (isEdit) {
      loads.push((async () => {
        const o = await getOrder(id)
        if (!alive) return
        if (!o) throw new Error('This order could not be found.')
        // Apply only a complete matching pair. A failed line read must never
        // expose a partially loaded form that can overwrite existing lines.
        const orderLines = await getOrderLines(id)
        if (!alive) return
        if (o) {
          setHeader(orderEditFields(o, blankHeader.destination))
          setSourceFile(o.source_file || null)
          setLines(orderLines)
        }
      })())
    }
    Promise.all(loads)
      .catch(err => { if (alive) setLoadError(err.message || 'Could not load this order. Please retry.') })
      .finally(() => { if (alive) setFetching(false) })
    return () => { alive = false }
  }, [id, isEdit, loadRevision])

  // Convert to PI (2026-08-26) — prefill header + lines from a client_quotes
  // doc instead of starting blank. Only for the built-from-products quote
  // view (quote_type !== 'uploaded'), since an uploaded quote is just PDF
  // attachments with no items/tiers to convert. Quantities default to each
  // item's FIRST (lowest) tier — QuoteDetail.jsx's own "Min total" comment
  // confirms tiers are already stored lowest-qty-first — and are fully
  // editable here same as any other line, so this is a starting point for
  // review, not a final commit.
  const [fromQuoteError, setFromQuoteError] = useState('')
  useEffect(() => {
    if (!fromQuoteId || isEdit) return
    let alive = true
    ;(async () => {
      const qSnap = await getDoc(doc(db, 'client_quotes', fromQuoteId))
      if (!alive || !qSnap.exists()) { if (alive) setFromQuoteError('That quote could not be found.'); return }
      const q = qSnap.data()
      if (q.quote_type === 'uploaded') { setFromQuoteError('This quote has no product lines to convert — it\'s an uploaded document.'); return }
      const itemSnap = await getDocs(collection(db, 'client_quotes', fromQuoteId, 'items'))
      if (!alive) return
      if (itemSnap.docs.some(d => hasIncompleteRangeLine(d.data()))) {
        setFromQuoteError('A Crystocraft Range line has no quantity or positive price. Complete the quote before converting it to a PI.')
        return
      }
      setHeader(h => ({
        ...h,
        customer_id: q.customer_id || h.customer_id,
        customer_name: q.client_name || h.customer_name,
        currency: q.quote_currency || h.currency,
        uc_no: looksLikeUc(q.ref_no) ? q.ref_no.trim() : h.uc_no,
        notes: q.quote_no ? `Converted from Quote ${q.quote_no}` : h.notes,
      }))
      const newLines = itemSnap.docs.map((d, i) => quoteItemToOrderLine(d.data(), i))
      setLines(newLines)
      if (!newLines.length) setFromQuoteError('That quote has no product lines yet — add lines manually.')
    })()
    return () => { alive = false }
  }, [fromQuoteId, isEdit])

  // Bring the invoice field into view when arriving via "Raise invoice →".
  // After `fetching` clears, so the field exists and the layout has settled.
  useEffect(() => {
    if (!wantsInvoice || fetching || !invoiceFieldRef.current) return
    invoiceFieldRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    invoiceFieldRef.current.focus({ preventScroll: true })
  }, [wantsInvoice, fetching])

  // Live roll-up of what this order has actually consumed. Subscribed rather
  // than read once, so it tracks the three stock cards on the same page.
  const [stock, setStock] = useState(null)
  useEffect(() => {
    if (!isEdit || !id) return
    return onSnapshot(doc(db, 'orders', id), snap => setStock(orderStockStatus(snap.data() || {}, STOCK_CFGS)))
  }, [id, isEdit])

  // Allocate the next SO number in JES's own series. See soNumber.js — this
  // shares a series with JES, so it is only safe once JES has stopped issuing
  // them for the year.
  const [allocatingSo, setAllocatingSo] = useState(false)
  const [soError, setSoError] = useState('')
  async function doAllocateSo() {
    if (saveInFlight.current) return
    setAllocatingSo(true); setSoError('')
    try {
      const no = await allocateSoNo()
      setHeader(h => ({ ...h, erp_so_no: no }))
    } catch (e) {
      setSoError(e.message || 'Could not allocate an SO number.')
    } finally {
      setAllocatingSo(false)
    }
  }

  // A fresh, standalone UC# — for a Direct Invoice or any other order that
  // needs one before it's ready to actually be invoiced (doAllocateSi below
  // allocates a UC too, but only bundled with an SI). Same allocator
  // Shipping.jsx's "Duplicate" uses, never carrying over an existing UC —
  // that's the exact repeatable slip it exists to prevent (see its comment).
  const [allocatingUc, setAllocatingUc] = useState(false)
  const [ucError, setUcError] = useState('')
  async function doAllocateUc() {
    if (saveInFlight.current) return
    setAllocatingUc(true); setUcError('')
    try {
      const uc = await allocateOrderUc({ customer_name: header.customer_name, currency: header.currency })
      setHeader(h => ({ ...h, uc_no: uc.full }))
    } catch (e) {
      setUcError(e.message || 'Could not allocate a UC#.')
    } finally {
      setAllocatingUc(false)
    }
  }

  // Same as the SO allocator, own counter. Stamps invoiced_at so the invoice
  // carries its own date rather than reusing the order date — an order raised in
  // June and invoiced in July is normal and the books need the later one.
  const [imgPickerLine, setImgPickerLine] = useState(null)   // index of the line whose image picker is open
  const [allocatingSi, setAllocatingSi] = useState(false)
  const [siError, setSiError] = useState('')
  // An invoice must carry a UC — that is the required key, not the SO (see
  // normOrder in shipping.js; 0 of 516 JES invoices since 2024 lack one). So
  // allocating an invoice number allocates a UC too when the order has none,
  // rather than letting an invoice exist that cannot be matched to the books.
  //
  // ONE Postgres transaction, as of 2026-07-21. This used to be two steps —
  // a UC written to Postgres, then a number from a Firestore counter — with
  // nothing making them agree: abandoning the form after allocating burned a
  // UC with no invoice behind it. The number is now derived inside the
  // database from the greater of what the app has issued and what the mirror
  // shows JES issued, so JES_SI_SEED_BY_YEAR can no longer go stale and
  // silently reuse a number CuiLing already used. (It did, on 2026-07-21.)
  async function doAllocateSi() {
    if (saveInFlight.current) return
    setAllocatingSi(true); setSiError('')
    try {
      const res = await allocateInvoice({
        year: soYear(),
        customer: header.customer_name,
        currency: header.currency,
        order_id: id || null,
        uc_no: header.uc_no || null,
      })
      const patch = {
        uc_no: res.uc_no || header.uc_no || '',
        erp_si_no: res.si_no,
        invoiced_at: header.invoiced_at || ocDateOnly(new Date()),
      }
      setHeader(h => ({ ...h, ...patch }))
      // Persist immediately on a saved order so "Raise Invoice" is a complete
      // action — the number is already burned in Postgres, so leaving it only in
      // local state (needing a manual Save) is how an invoice goes missing.
      if (id) await updateOrder(id, patch)

      // V8.9 (Cindy's spec) — allocate_sales_invoice() only ever writes
      // year/customer/currency/status into uc_registry (see PROJECT-PLAN.md's
      // "UC Registry doesn't auto-fill..." note); order_no/deposit/balance/
      // bal_pay_date/remarks/source are left blank for every channel, filled
      // in by hand today. For a WooCommerce order specifically, all of that
      // is already known — fill it automatically rather than making Cindy
      // retype what the sync already captured. Scoped to channel ===
      // 'woocommerce' only; wholesale/Alibaba/Amazon orders are untouched,
      // still fully manual. Best-effort — a failure here must not undo the
      // SI/UC allocation that already succeeded above.
      if (header.channel === 'woocommerce' && res.uc_id) {
        try {
          // The registry endpoint coerces missing numeric values to zero.
          // Keep an unknown checkout amount from overwriting existing accounts.
          if (header.total_amount == null) throw new Error('WooCommerce order total is missing; registry amounts were not overwritten.')
          await updateUcInvoice(res.uc_id, wooRegistryAutofillFields(header))
        } catch (e) {
          setSiError(`Invoice allocated, but the UC Registry details could not be auto-filled: ${e.message || e}. Fill them in manually on the UC Registry page.`)
        }
      }
    } catch (e) {
      setSiError(e.message || 'Could not allocate an invoice number.')
    } finally {
      setAllocatingSi(false)
    }
  }

  const setH = field => e => setHeader(h => ({ ...h, [field]: e.target.value }))
  const setDest = field => e => setHeader(h => ({ ...h, destination: { ...h.destination, [field]: e.target.value } }))

  // Moving an order to shipped/delivered with consumption unrecorded is the way
  // component stock drifts once job orders are gone. Deliberately a confirm and
  // not a block — simple sales legitimately consume nothing — but it can no
  // longer happen without someone seeing it.
  const setStatus = e => {
    const next = e.target.value
    if (SHIPPED_STATUSES.has(next) && !SHIPPED_STATUSES.has(header.status) && stock && stock.state !== 'recorded') {
      const detail = stockStatusDetail(stock)
      const ok = window.confirm(
        `This order's material consumption is not fully recorded.\n\n${detail}\n\n`
        + `Mark it ${next} anyway? Component stock will stay higher than it physically is until this is recorded.`
      )
      if (!ok) return
    }
    setHeader(h => ({ ...h, status: next }))
  }

  function onCustomer(e) {
    const c = customers.find(x => x.id === e.target.value)
    setHeader(h => ({
      ...h, customer_id: e.target.value,
      contact_id: c ? (primaryContact(c.contacts)?.id || '') : '',
      customer_name: c ? c.company_name : h.customer_name,
      destination: c ? {
        country: c.country || c.region || h.destination.country,
        city: h.destination.city,
        address: c.address || h.destination.address,
        port: h.destination.port,
      } : h.destination,
    }))
  }

  const [addingCustomer, setAddingCustomer] = useState(false)
  async function addNewCustomer() {
    const nameRaw = (header.customer_name || '').trim()
    if (!nameRaw) return
    setAddingCustomer(true)
    try {
      // Route through the canonical save path (normalize + validate). Use valid
      // enum values so the new record is clean from the start.
      const res = await saveCustomer(null, {
        company_name: nameRaw,
        country: header.destination.country || 'Hong Kong',
        address: header.destination.address || '',
        crm_status: 'Active',
        source: 'Direct',
      })
      if (!res.ok) { setExtractError(res.result.errors[0]?.message || 'Could not create customer.'); return }
      const newCustomer = { id: res.id, company_name: nameRaw, country: header.destination.country || 'Hong Kong' }
      setCustomers(list => [...list, newCustomer].sort((a, b) => (a.company_name || '').localeCompare(b.company_name || '')))
      setHeader(h => ({ ...h, customer_id: res.id, customer_name: nameRaw }))
    } catch (err) {
      setExtractError(err.message || 'Could not create customer.')
    } finally {
      setAddingCustomer(false)
    }
  }

  // ── PI extraction ──────────────────────────────────────────────────────────
  function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    const f = Array.from(e.dataTransfer.files).find(x => x.type.startsWith('image/') || x.type === 'application/pdf')
    if (f) importFile(f)
  }

  async function importFile(file) {
    setPendingFile(file)
    setExtracting(true); setExtractError('')
    try {
      const payload = await preparePiUploadFile(file)
      const res = await fetch('/api/extract-pi', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Extraction failed')
      const data = await res.json()

      setHeader(h => applyExtractedPiHeader(h, data, customers))
      const matched = autoMatchLines(data.lines || [], rangeProducts)
      setLines(matched)
      if (!matched.length) setExtractError('No line items found — check the file or add lines manually.')

      // The PI is the JES sales order, so its lines already exist in the ERP
      // mirror. Cross-check the parse against them — the ERP's version is the
      // original, the parse is a reading of a picture of it.
      checkAgainstErp(data.so_no, matched)
    } catch {
      setExtractError('Could not read this PI — fill in the header and add lines manually.')
    } finally {
      setExtracting(false)
    }
  }

  // ── ERP cross-check ────────────────────────────────────────────────────────
  async function checkAgainstErp(soNo, parsedLines) {
    setErpCheck(null)
    if (!soNo) return
    try {
      const erp = await fetchErpSoLines(soNo)
      // Not in the mirror yet (raised since the last sync) — say nothing and
      // leave the parsed lines alone. This must never block the workflow.
      if (!erp) return
      setErpCheck({ soNo: String(soNo).toUpperCase(), erp, diff: diffLines(parsedLines, erp) })
    } catch (e) {
      console.error('ERP SO cross-check failed', e)
    }
  }

  function useErpLines() {
    if (!erpCheck) return
    setLines(autoMatchLines(erpCheck.erp, rangeProducts))
    setErpCheck(c => ({ ...c, adopted: true }))
  }

  // ── Line editing / reconciliation ────────────────────────────────────────────
  const setLine = (i, patch) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))

  function classify(i, type) {
    setLine(i, lineClassificationPatch(lines[i], type, rangeProducts))
  }

  function addBlankLine() {
    setLines(ls => [...ls, {
      line_no: ls.length + 1, item_code: '', description: '', qty_ordered: '',
      unit: 'pcs', unit_price: '', line_type: null, packable: true, match_status: 'manual',
    }])
  }
  const removeLine = i => setLines(ls => ls.filter((_, j) => j !== i))

  const unclassified = lines.filter(l => !l.line_type).length

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    setExtractError('')
    try {
      // Upload PI under a stable import path first, then anchor it on the order.
      let sf = null
      if (pendingFile) {
        const r = storageRef(storage, `orders/imports/${Date.now()}_${pendingFile.name}`)
        await uploadBytes(r, pendingFile, { contentType: pendingFile.type || 'application/octet-stream' })
        sf = { url: await getDownloadURL(r), name: pendingFile.name }
      }
      // Fall back to the line-item-computed total when the PI extraction never
      // captured a stated total — otherwise the order silently has no value
      // even though a correct one is computable (and was shown on this page).
      const computed = computeOrderTotals(header, lines)
      const orderData = orderCreateFields(header, computed, sf, isDirect)
      const v = validateOrder(orderData, lines)
      if (!v.ok) { setExtractError(v.errors.map(x => x.message).join(' · ')); return }

      // Allocate the SO number automatically on create. The app is now the only
      // source of new SO numbers (CuiLing, 2026-07-23: new SO/SI go in the app,
      // old JES ones may be edited but no new ones are added), so the JES
      // collision the manual button guarded against no longer applies. Only
      // when empty: an imported old JES PI already carries its SO and must keep
      // it.
      //
      // NOT for a Direct Invoice. The business runs two invoicing paths (owner,
      // 2026-07-24):
      //   wholesale — sales order, deposit, production, then the invoice is
      //               raised FROM the SO when the goods are ready to ship;
      //   retail    — Amazon, web and small Alibaba orders skip the sales order
      //               entirely and are invoiced directly to keep it simple.
      // So a retail sale has no sales order by design, and minting one for it
      // would consume a number out of a gapless series for a document that does
      // not exist.
      //
      // Allocation and the order write happen in ONE Firestore transaction
      // (createOrderWithLinesAllocatingSo) — previously these were two
      // separate steps, and a write failure AFTER a successful allocation
      // burned a real, permanent gap in the gapless SO series with no order
      // to explain it (bug-fix pack B-02). Not raced against a timeout like a
      // normal save: a transaction needs a real round-trip to read the
      // counter, so there is nothing to optimistically assume here.
      let orderId
      try {
        const created = await createOrderWithLinesAllocatingSo(orderData, lines, {
          allocateSo: !isDirect && !orderData.erp_so_no,
        })
        orderId = created.id
        orderData.erp_so_no = created.so || orderData.erp_so_no
      } catch (e) {
        setExtractError(`Could not create the order: ${e.message || e}.`)
        return
      }

      // A Direct Invoice with no invoice number vanishes: the Sales Invoices
      // page lists orders that HAVE an SI, plus un-invoiced ones that are
      // shipped/delivered. A new direct invoice is neither, so it appeared
      // nowhere and CuiLing could not find what she had just created
      // (2026-07-23).
      //
      // Unlike a normal order — where invoicing happens later, so the SI stays
      // a deliberate act — this flow exists to produce an invoice. Its own
      // instruction is "add the lines, then allocate an invoice number", which
      // is a step the app can simply take.
      //
      // Deliberately AFTER the order is committed, not before: allocating first
      // and then failing to create would burn an invoice number with nothing
      // behind it, which is the exact fault V7.17 removed from this path. If
      // this fails the order still exists and she lands on it, so the manual
      // Allocate button is one click away rather than the work being lost.
      if (isDirect && !orderData.erp_si_no) {
        try {
          const res = await allocateInvoice({
            year: soYear(),
            customer: orderData.customer_name,
            currency: orderData.currency,
            order_id: orderId,
            uc_no: orderData.uc_no || null,
          })
          await updateOrder(orderId, {
            erp_si_no: res.si_no,
            uc_no: res.uc_no || orderData.uc_no || '',
            invoiced_at: orderData.invoiced_at || ocDateOnly(new Date()),
          })
        } catch (e) {
          setExtractError(`Order created, but the invoice number could not be allocated: ${e.message || e}. Use Allocate on the order.`)
        }
      }

      // Best-effort, after the order is safely committed — never let this
      // block landing on the new order, and never let it retry into a second
      // order if the order write itself already succeeded.
      if (fromQuoteId) {
        updateDoc(doc(db, 'client_quotes', fromQuoteId), { converted_order_id: orderId }).catch(() => {})
      }

      navigate(`/shipments/${orderId}`)
    } catch (err) {
      setExtractError(err.message || 'Could not create order.')
    } finally {
      // Clear busy state on validation/upload/create failures too, so the
      // current form remains usable when creation does not navigate away.
      setSaving(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    if (saveInFlight.current || fetching || loadError || allocatingSo || allocatingUc || allocatingSi || extracting) return
    saveInFlight.current = true
    setSaving(true)
    setSavePending(false)
    setExtractError('')
    const pendingTimer = setTimeout(() => {
      if (mounted.current) setSavePending(true)
    }, 6000)
    try {
      // Same fallback as create — persist the line-computed total when no PI-
      // stated total was ever captured, so the order isn't left valueless.
      const computed = computeOrderTotals(header, lines)
      // Validate these edits against their current total. header.total_amount
      // retains the saved Woo checkout amount for allocation, not live edits.
      const v = validateOrder({ ...header, total_amount: computed.total }, lines)
      if (!v.ok) { setExtractError(v.errors.map(x => x.message).join(' · ')); setSaving(false); return }
      // Accounting total defaults to the computed total when left blank — see
      // the Accounting Total field above. Validate the live computed total;
      // stored-record audits still compare their persisted totals. Checked
      // again server-side in /api/uc: this is not the only gate.
      const accountingTotal = header.accounting_total !== '' ? parseFloat(header.accounting_total) : computed.total
      const adjustment = Math.round((accountingTotal - computed.total) * 100) / 100
      if (Math.abs(adjustment) > 0.005 && !header.adjustment_reason.trim()) {
        setExtractError('Accounting total differs from the calculated total — an adjustment reason is required.')
        setSaving(false)
        return
      }
      // Header and line reconciliation commit together. A slow read or an
      // offline queued batch remains pending, never a successful timeout.
      await saveOrderWithLines(id, orderSaveFields(header, computed, accountingTotal, adjustment), lines)

      // Keep the Postgres financial record in step. Deliberately AFTER the
      // Firestore write and deliberately not awaited into the failure path:
      // Firestore is the source of truth, so a Supabase hiccup must not make a
      // successful save look failed. Drift that results is caught by the
      // reconciliation on the Sales Invoices page rather than hidden.
      if (header.erp_si_no) {
        upsertInvoice(invoiceRegistryFields(id, header, computed, accountingTotal))
      }
      if (mounted.current) navigate('/shipments')
    } catch (err) {
      if (mounted.current) setExtractError(err.message || 'Could not save order.')
    } finally {
      clearTimeout(pendingTimer)
      saveInFlight.current = false
      if (mounted.current) { setSaving(false); setSavePending(false) }
    }
  }

  if (fetching) return <div className="p-6 text-ink-60">Loading…</div>
  if (loadError) return (
    <div className="p-4 md:p-6 max-w-4xl">
      <Link to="/shipments" className="text-sm text-brand-600 hover:underline">← Order Listing</Link>
      <div className="card p-4 mt-4 space-y-3">
        <p role="alert" className="text-sm text-brand-600 break-words">{loadError}</p>
        <button type="button" className="btn-secondary" onClick={() => { setFetching(true); setLoadRevision(n => n + 1) }}>Retry</button>
      </div>
    </div>
  )

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <ShipmentPageHeader
        id={id} isEdit={isEdit} isDirect={isDirect}
        invoiceNo={header.erp_si_no} ucNo={header.uc_no}
        allocatingSi={allocatingSi} saving={saving} siError={siError}
        onRaiseInvoice={doAllocateSi} tab={tab} onTabChange={setTab}
      />

      {/* Packing list tab */}
      {isEdit && tab === 'packing' && (
        <PackingListEditor orderId={id} orderLines={lines} />
      )}

      {/* Freight comparison tab */}
      {isEdit && tab === 'freight' && (
        <FreightComparison orderId={id} />
      )}

      {/* Order tab (or new shipment form) */}
      {(!isEdit || tab === 'order') && (
      <form onSubmit={isEdit ? handleSave : handleCreate} className="space-y-5">
      <fieldset disabled={saving} className="space-y-5 min-w-0">
        {fromQuoteId && (
          fromQuoteError ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-none px-3 py-2">{fromQuoteError}</p>
          ) : (
            <p className="text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-none px-3 py-2">
              Prefilled from the quote — review quantities, prices and the UC# below before creating. Tiers default to the lowest quantity option.
            </p>
          )
        )}
        {/* PI upload (import only). Hidden for a direct invoice — a retail sale
            has no proforma to import, so offering the dropzone would suggest a
            step that does not exist. */}
        {!isEdit && !isDirect && !fromQuoteId && (
          <ShipmentPiUpload
            dragOver={dragOver}
            fileName={pendingFile?.name}
            extracting={extracting}
            error={extractError}
            erpCheck={erpCheck}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onFileChange={e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = '' }}
            onUseErpLines={useErpLines}
          />
        )}

        {/* Header — split into four grouped cards (2026-08-26; was one long
            undivided card) so each group of fields reads as its own
            question: who is this for, what documents reference it, when/on
            what terms, and where is it going. Also fixes the Invoice
            No/Revision pair fighting SO/UC/Customer PO for space in a single
            3-column grid, which was truncating the Revision placeholder and
            wrapping "+ New Rev" onto two lines. */}
        <ShipmentCustomerCard
          customers={customers}
          customerId={header.customer_id}
          customerName={header.customer_name}
          contactId={header.contact_id}
          addingCustomer={addingCustomer}
          onCustomer={onCustomer}
          onContactChange={cid => setHeader(h => ({ ...h, contact_id: cid || '' }))}
          onAddCustomer={addNewCustomer}
        />

        <ShipmentDocumentReferences
          header={header} setH={setH}
          doAllocateSo={doAllocateSo} allocatingSo={allocatingSo} soError={soError}
          doAllocateUc={doAllocateUc} allocatingUc={allocatingUc} ucError={ucError}
          doAllocateSi={doAllocateSi} allocatingSi={allocatingSi} siError={siError}
          invoiceFieldRef={invoiceFieldRef}
          onNewRevision={() => setHeader(h => ({ ...h, pi_revision: String((parseInt(h.pi_revision, 10) || 0) + 1) }))}
          sourceFile={sourceFile}
        />

        <ShipmentScheduleTerms header={header} setH={setH} isEdit={isEdit} setStatus={setStatus} stock={stock} />

        <ShipmentDestination destination={header.destination} setDest={setDest} />

        {/* Reconciliation. Rendered unconditionally: "+ Add line" lives inside
            this card, so gating it on `lines.length > 0 || isEdit` meant a
            brand-new order had no way to add its first line by hand — the only
            route in was Import PI. That made the app able to *parse* an order
            but never *originate* one. */}
        {(
          <div className="card p-4 md:p-6">
            <ShipmentLineItemsHeader
              unclassified={unclassified}
              onRematch={() => setLines(ls => rematchLines(ls, rangeProducts))}
              onAddLine={addBlankLine}
            />

            {lines.length === 0 && (
              <p className="text-sm text-ink-60 py-3 text-center">
                No lines yet — <button type="button" onClick={addBlankLine} className="text-brand-600 hover:underline">add one</button>
                {!isEdit && !isDirect && <> , or drop a PI above to import them.</>}
              </p>
            )}

            <div className="space-y-2">
              {lines.map((line, i) => (
                <ShipmentLineRow key={i} line={line} index={i}
                  setLine={setLine} classify={classify} onPickImage={setImgPickerLine} removeLine={removeLine} />
              ))}
            </div>

            {imgPickerLine != null && (
              <LineImagePicker
                orderId={id}
                matchedProductRef={lines[imgPickerLine]?.matched_product_ref || null}
                itemCode={lines[imgPickerLine]?.item_code || ''}
                selectedUrl={lines[imgPickerLine]?.line_image || null}
                onSelect={url => { setLine(imgPickerLine, { line_image: url }); setImgPickerLine(null) }}
                onClear={() => { setLine(imgPickerLine, { line_image: null }); setImgPickerLine(null) }}
                onClose={() => setImgPickerLine(null)}
              />
            )}
          </div>
        )}

        {/* ── Order totals & discount ──────────────────────────────────── */}
        {lines.length > 0 && (() => {
          const { subtotal: computedSubtotal, chargesTotal, total: computedTotal } = computeOrderTotals(header, lines)
          const payment = invoicePaymentTotals(header, computedTotal)
          const depositError = invoiceDepositError(header, computedTotal)
          const piSubtotal   = parseFloat(header.pi_subtotal) || null
          const piTotal      = parseFloat(header.pi_total) || null
          const subtotalMatch = piSubtotal == null || Math.abs(computedSubtotal - piSubtotal) < 0.02
          const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          return (
            <div className="card p-4">
              <h2 className="text-xs text-ink-60 uppercase tracking-wide mb-3">Order Totals</h2>
              <div className="space-y-1.5 text-sm">
                <ShipmentSubtotalRows
                  currency={header.currency}
                  subtotalText={fmt(computedSubtotal)}
                  statedSubtotalText={piSubtotal != null ? fmt(piSubtotal) : null}
                  subtotalMatch={subtotalMatch}
                  chargesText={chargesTotal > 0 ? fmt(chargesTotal) : null}
                />

                {/* Either field drives the other. Use the stated PI subtotal when available. */}
                <ShipmentDiscountRow
                  currency={header.currency}
                  percentage={header.discount_pct}
                  amount={header.discount_amount}
                  onPercentageChange={e => {
                    const pct = e.target.value
                    const amt = pct !== '' ? +((parseFloat(piSubtotal || computedSubtotal) * parseFloat(pct) / 100)).toFixed(2) : ''
                    setHeader(h => ({ ...h, discount_pct: pct, discount_amount: isNaN(amt) ? '' : amt }))
                  }}
                  onAmountChange={e => {
                    const amt = e.target.value
                    const base = parseFloat(piSubtotal || computedSubtotal)
                    const pct = amt !== '' && base > 0 ? +((parseFloat(amt) / base) * 100).toFixed(2) : ''
                    setHeader(h => ({ ...h, discount_amount: amt, discount_pct: isNaN(pct) ? '' : pct }))
                  }}
                />

                <ShipmentTotalRow
                  currency={header.currency}
                  totalText={fmt(computedTotal)}
                  statedTotalText={piTotal != null && Math.abs(computedTotal - piTotal) >= 0.02 ? fmt(piTotal) : null}
                />

                {/* Accounting total — what finance actually records against this
                    invoice, kept separate from Total Amount above (which stays
                    what the lines say — see normOrder). Only meaningful once the
                    order carries an invoice number. A nonzero gap needs a reason
                    (SR-05); enforced here and again server-side in /api/uc. */}
                {header.erp_si_no && (() => {
                  const accTotal = header.accounting_total !== '' ? parseFloat(header.accounting_total) : computedTotal
                  const adj = Math.round((accTotal - computedTotal) * 100) / 100
                  return (
                    <ShipmentAccountingTotal
                      currency={header.currency}
                      amount={header.accounting_total}
                      computedTotalText={fmt(computedTotal)}
                      adjustmentText={Math.abs(adj) > 0.005 ? fmt(adj) : null}
                      positiveAdjustment={adj > 0}
                      reason={header.adjustment_reason}
                      onAmountChange={setH('accounting_total')}
                      onReasonChange={setH('adjustment_reason')}
                    />
                  )
                })()}

                <ShipmentDepositPaid
                  currency={header.currency}
                  amount={header.deposit_paid}
                  invoiceTotal={payment.invoiceTotal}
                  error={depositError}
                  outstandingText={payment.depositPaid > 0 && !depositError ? fmt(payment.outstanding) : null}
                  onAmountChange={setH('deposit_paid')}
                />
              </div>
            </div>
          )
        })()}

        {/* Remarks — prints on both the Proforma and the Sales Invoice, labelled
            "Remarks" there (see order.notes in SalesInvoicePrint.jsx /
            ProformaInvoicePrint.jsx). Free text: an exception, a name that was
            dropped, or other accounting context (SR-06). */}
        <ShipmentRemarks
          notes={header.notes}
          onNotesChange={setH('notes')}
          hideTotalQty={!!header.hide_total_qty}
          onHideTotalQtyChange={e => setHeader(h => ({ ...h, hide_total_qty: e.target.checked }))}
        />

        {/* Component stock — issue this order's figurine BOM to the ledger (V7.13a) */}
        {isEdit && <OrderStockIssue orderId={id} orderLabel={header.uc_no || header.erp_so_no || id} />}

        {/* Crystal + packaging stock — batch-issue this order's consumption (V7.13a) */}
        {isEdit && <OrderInventoryIssue orderId={id} orderLabel={header.uc_no || header.erp_so_no || id} inv={crystalInventory} />}
        {isEdit && <OrderInventoryIssue orderId={id} orderLabel={header.uc_no || header.erp_so_no || id} inv={packagingInventory} />}

        {extractError && <p id="shipment-form-error" role="alert" className="text-sm text-brand-600 break-words">{extractError}</p>}
        {savePending && <p role="status" className="text-sm text-ink-60 break-words">Save is still pending confirmation. Keep this page open; if you are offline, reconnect to finish. Please do not submit again.</p>}
        <div className="flex items-center gap-3 pt-1">
          <button type="submit" className="btn-primary" disabled={saving || allocatingSo || allocatingUc || allocatingSi || extracting || (!isEdit && lines.length === 0)}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Order'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate('/shipments')}>Cancel</button>
          {isEdit && (
            <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto inline-flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700">
              <Trash2 size={15} /> Delete order
            </button>
          )}
        </div>

      {confirmDelete && (
        <ConfirmDialog title="Delete order" message="Delete this order and all its lines? This cannot be undone."
          onConfirm={async () => { await deleteOrder(id); navigate('/shipments') }}
          onCancel={() => setConfirmDelete(false)} />
      )}
      </fieldset>
      </form>
      )}
    </div>
  )
}
