import { useState, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import {
  INCOTERMS, ORDER_CURRENCIES, ORDER_STATUSES, LINE_TYPES, lineTypeOf, isPackable,
  getOrder, getOrderLines, createOrderWithLines, updateOrder, saveOrderLines, deleteOrder,
  loadRangeProductsLite, autoMatchLines, matchRangeProduct, rematchLines, validateOrder, computeOrderTotals,
  orderUc,
} from '../shipping'
import { loadCustomers, saveCustomer } from '../domain/customer'
import { fetchErpSoLines, diffLines } from '../erpSoImport'
import { CURRENCIES } from '../constants'
import { FileInput, FolderOpen, FileText, Trash2, CheckCircle2, AlertTriangle, RefreshCw, Database } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'
import PackingListEditor from './PackingListEditor'
import FreightComparison from './FreightComparison'
import OrderStockIssue from '../components/OrderStockIssue'
import OrderInventoryIssue from '../components/OrderInventoryIssue'
import { crystalInventory } from '../crystals'
import { packagingInventory } from '../packaging'
import { metalOrderConfig } from '../orderStock'
import { allocateSoNo, soYear } from '../soNumber'
import { allocateInvoice, upsertInvoice } from '../ucRegistry'
import { orderStockStatus, stockStatusDetail, STOCK_STATUS_LABEL, STOCK_STATUS_STYLE } from '../orderStockStatus'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

// Every stock class an order consumes. Order matters only for display.
const STOCK_CFGS = [metalOrderConfig, crystalInventory, packagingInventory]

// Statuses that mean the goods have physically left. Past this point, material
// consumption that was never recorded will not be — JES used to make that
// impossible (no job order, no movement); the app has to ask instead.
const SHIPPED_STATUSES = new Set(['shipped', 'delivered'])

const blankHeader = {
  customer_id: '', customer_name: '', erp_pi_no: '', erp_so_no: '', erp_si_no: '', uc_no: '', customer_po: '', order_date: '',
  invoiced_at: '',
  currency: 'USD', incoterm: 'FOB', status: 'draft',
  destination: { country: '', city: '', address: '', port: '' }, notes: '',
  // pi_subtotal / pi_total hold what the imported PI stated, for the mismatch
  // cross-check only. The order's real subtotal/total are computed from the
  // lines at save time, not carried in editable header state.
  pi_subtotal: '', pi_total: '', discount_pct: '', discount_amount: '',
}

// Firestore writes with persistentLocalCache resolve only when the SERVER acks —
// but the write is already durable in the local cache and syncs on its own. So we
// don't block the UI forever on the round-trip: proceed after a short grace period
// while still surfacing an error if the write rejects quickly (e.g. permissions).
// A late rejection after we've moved on is swallowed (the .catch below).
function raceWrite(promise, ms = 6000) {
  promise.catch(() => {})   // prevent an unhandled rejection if it settles late
  return Promise.race([
    promise.then(() => false),                               // committed: not pending
    new Promise(resolve => setTimeout(() => resolve(true), ms)), // timed out: assume cached
  ])
}

// Shows how the parsed PI compares to the ERP's own sales order. The ERP rows
// are the original record; the parse is a reading of a picture of it. So when
// they disagree, the ERP is right — but this says so rather than silently
// overwriting, because the mirror can be a few days stale and the person
// importing knows which document they're holding.
function ErpCrossCheck({ check, onUse }) {
  if (!check) return null
  const { soNo, erp, diff, adopted } = check
  const clean = !diff.differing.length && !diff.onlyParsed.length && !diff.onlyErp.length

  return (
    <div className={`mt-3 rounded-lg border px-3 py-2.5 text-xs ${
      clean ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-center gap-1.5 font-semibold mb-1">
        <Database size={13} />
        {soNo} found in the ERP — {erp.length} line{erp.length === 1 ? '' : 's'}
      </div>

      {clean ? (
        <p className="text-green-800">The parsed lines match the ERP exactly.</p>
      ) : (
        <div className="text-amber-900 space-y-1">
          {diff.differing.map((d) => (
            <div key={d.item_code}>
              <span className="font-mono">{d.item_code}</span>{' '}
              {d.fields.map((f) => (
                <span key={f.field}>
                  {f.field} read as <strong>{String(f.parsed)}</strong>, ERP says{' '}
                  <strong>{String(f.erp)}</strong>{' '}
                </span>
              ))}
            </div>
          ))}
          {diff.onlyParsed.map((l, i) => (
            <div key={`p${i}`}>
              <span className="font-mono">{l.item_code || '(no code)'}</span> — read from the
              PDF but not in the ERP order
            </div>
          ))}
          {diff.onlyErp.map((l) => (
            <div key={l.item_code}>
              <span className="font-mono">{l.item_code}</span> — in the ERP order but missed
              by the parser
            </div>
          ))}
        </div>
      )}

      {adopted ? (
        <p className="mt-2 text-green-800 font-medium">Using the ERP's lines.</p>
      ) : (
        <button type="button" onClick={onUse}
                className="mt-2 px-2.5 py-1 rounded border border-current text-xs font-medium hover:bg-white/60">
          Use the ERP's lines{clean ? '' : ' (recommended)'}
        </button>
      )}
    </div>
  )
}

export default function ShipmentForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Direct invoice: a retail sale with no sales order behind it. Only changes
  // how the page presents itself — the record is the same shape, it just never
  // gets an SO number. See normOrder in shipping.js for why that is legitimate.
  const isDirect = searchParams.get('direct') === '1'

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
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState('order')

  useEffect(() => {
    const preCustomerId = searchParams.get('customer_id')
    const loads = [
      loadCustomers().then(list => {
        setCustomers(list)
        // Resolve customer name when pre-filled from URL
        if (preCustomerId && !isEdit) {
          const c = list.find(x => x.id === preCustomerId)
          if (c) setHeader(h => ({ ...h, customer_name: c.company_name }))
        }
      }),
      loadRangeProductsLite().then(setRangeProducts),
    ]
    if (isEdit) {
      loads.push((async () => {
        const o = await getOrder(id)
        if (o) {
          setHeader({
            customer_id: o.customer_id, customer_name: o.customer_name,
            // uc_no is seeded through orderUc so an order whose UC lives in the
            // legacy erp_pi_no shows it in the UC# field and does not look
            // un-allocated to doAllocateSi. erp_pi_no is still carried so
            // saving does not silently drop it.
            erp_pi_no: o.erp_pi_no, erp_so_no: o.erp_so_no || '', erp_si_no: o.erp_si_no || '', uc_no: orderUc(o),
            customer_po: o.customer_po || '',
            invoiced_at: o.invoiced_at || '',
            order_date: o.order_date || '',
            currency: o.currency, incoterm: o.incoterm, status: o.status,
            destination: { ...blankHeader.destination, ...o.destination }, notes: o.notes,
            discount_pct:    o.discount_pct    ?? '',
            discount_amount: o.discount_amount ?? '',
            // Reference figures for the mismatch check. New orders carry their
            // own pi_* fields; older imported orders predate them and still
            // hold the PI value in subtotal/total_amount, so fall back to those.
            pi_subtotal: o.pi_subtotal ?? (o.source === 'imported_pi' ? o.subtotal : null) ?? '',
            pi_total:    o.pi_total    ?? (o.source === 'imported_pi' ? o.total_amount : null) ?? '',
          })
          setSourceFile(o.source_file || null)
          setLines(await getOrderLines(id))
        }
      })())
    }
    Promise.all(loads).finally(() => setFetching(false))
  }, [id, isEdit])

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

  // Same as the SO allocator, own counter. Stamps invoiced_at so the invoice
  // carries its own date rather than reusing the order date — an order raised in
  // June and invoiced in July is normal and the books need the later one.
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
    setAllocatingSi(true); setSiError('')
    try {
      const res = await allocateInvoice({
        year: soYear(),
        customer: header.customer_name,
        currency: header.currency,
        order_id: id || null,
        uc_no: header.uc_no || null,
      })
      setHeader(h => ({
        ...h, uc_no: res.uc_no, erp_si_no: res.si_no,
        invoiced_at: h.invoiced_at || new Date().toISOString().slice(0, 10),
      }))
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
      let base64, mimeType
      if (file.type === 'application/pdf') { base64 = await toBase64(file); mimeType = 'application/pdf' }
      else { base64 = await toBase64(await preprocessForGemini(file)); mimeType = 'image/png' }
      const res = await fetch('/api/extract-pi', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType }),
      })
      if (!res.ok) throw new Error('Extraction failed')
      const data = await res.json()

      setHeader(h => {
        let customer_id = h.customer_id
        let customer_name = h.customer_id ? h.customer_name : (data.customer_name || h.customer_name)
        if (!customer_id && data.customer_name) {
          const lower = data.customer_name.toLowerCase()
          const match = customers.find(c => {
            const cn = (c.company_name || '').toLowerCase()
            return cn && (lower.includes(cn) || cn.includes(lower))
          })
          if (match) {
            customer_id = match.id
            customer_name = match.company_name
          }
        }
        return {
          ...h,
          customer_id,
          customer_name,
          // The parser's "pi_no" is the UC reference on the document (the
          // PDFs are named e.g. "… UC4920-26.pdf"), so it lands in uc_no now.
          uc_no: data.pi_no || h.uc_no,
          erp_so_no: data.so_no || h.erp_so_no,
          order_date: data.order_date || h.order_date,
          currency: ['USD', 'EUR', 'RMB', 'HKD'].includes(data.currency) ? data.currency : h.currency,
          incoterm: INCOTERMS.includes(data.incoterm) ? data.incoterm : h.incoterm,
          // The parsed PI totals are the stated reference, not the order value.
          pi_subtotal:     data.subtotal        != null ? data.subtotal        : h.pi_subtotal,
          discount_pct:    data.discount_pct    != null ? data.discount_pct    : h.discount_pct,
          discount_amount: data.discount_amount != null ? data.discount_amount : h.discount_amount,
          pi_total:        data.total_amount    != null ? data.total_amount    : h.pi_total,
        }
      })
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
    const l = lines[i]
    // Switching to figurine re-runs the match; other types clear the product ref.
    if (type === 'range') {
      const p = l.item_code ? matchRangeProduct(l.item_code, rangeProducts) : null
      setLine(i, {
        line_type: 'range', packable: true,
        matched_product_ref: p ? { collection: 'range_products', id: p.id, name: p.name } : null,
        match_status: p ? 'manual' : 'unmatched',
      })
    } else {
      setLine(i, { line_type: type, packable: isPackable(type), matched_product_ref: null, match_status: 'manual' })
    }
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
      const orderData = {
        ...header,
        source: 'imported_pi', source_file: sf,
        // Actual value = computed from the lines. PI figures kept only as the
        // stated reference for the mismatch check.
        subtotal:        computed.subtotal > 0 ? computed.subtotal : null,
        total_amount:    computed.subtotal > 0 ? computed.total : null,
        pi_subtotal:     header.pi_subtotal !== '' ? parseFloat(header.pi_subtotal) : null,
        pi_total:        header.pi_total    !== '' ? parseFloat(header.pi_total)    : null,
        discount_pct:    header.discount_pct    !== '' ? parseFloat(header.discount_pct)    : null,
        discount_amount: header.discount_amount !== '' ? parseFloat(header.discount_amount) : (computed.discountAmount > 0 ? computed.discountAmount : null),
      }
      const v = validateOrder(orderData, lines)
      if (!v.ok) { setExtractError(v.errors.map(x => x.message).join(' · ')); return }

      // Allocate the SO number automatically on create. The app is now the only
      // source of new SO numbers (CuiLing, 2026-07-23: new SO/SI go in the app,
      // old JES ones may be edited but no new ones are added), so the JES
      // collision the manual button guarded against no longer applies. Only
      // when empty: an imported old JES PI already carries its SO and must keep
      // it. Allocation failure aborts the create with a message rather than
      // silently making an order with no SO — the exact state being fixed.
      if (!orderData.erp_so_no) {
        try {
          orderData.erp_so_no = await allocateSoNo()
        } catch (e) {
          setExtractError(`Could not allocate an SO number: ${e.message || e}. Order not created.`)
          return
        }
      }

      const { id: orderId, commit } = createOrderWithLines(orderData, lines)
      await raceWrite(commit)   // throws only on a fast rejection; otherwise proceeds

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
            invoiced_at: orderData.invoiced_at || new Date().toISOString().slice(0, 10),
          })
        } catch (e) {
          setExtractError(`Order created, but the invoice number could not be allocated: ${e.message || e}. Use Allocate on the order.`)
        }
      }

      navigate(`/shipments/${orderId}`)
    } catch (err) {
      setExtractError(err.message || 'Could not create order.')
    } finally {
      // Always clear — navigating /shipments/new → /shipments/:id reuses this
      // component instance (same element, no key), so it does NOT unmount and
      // `saving` would otherwise stay stuck on "Saving…" even though the order
      // was created. This is the real cause of the hung Save button.
      setSaving(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setExtractError('')
    try {
      const v = validateOrder(header, lines)
      if (!v.ok) { setExtractError(v.errors.map(x => x.message).join(' · ')); setSaving(false); return }
      // Same fallback as create — persist the line-computed total when no PI-
      // stated total was ever captured, so the order isn't left valueless.
      const computed = computeOrderTotals(header, lines)
      const write = Promise.all([
        updateOrder(id, {
          customer_id: header.customer_id, customer_name: header.customer_name,
          erp_pi_no: header.erp_pi_no, erp_so_no: header.erp_so_no, erp_si_no: header.erp_si_no,
          customer_po: header.customer_po,
          invoiced_at: header.invoiced_at || null, uc_no: header.uc_no,
          order_date: header.order_date || null,
          currency: header.currency, incoterm: header.incoterm, status: header.status,
          destination: header.destination, notes: header.notes,
          // Actual value follows the lines; PI figures stay as the reference.
          subtotal:        computed.subtotal > 0 ? computed.subtotal : null,
          total_amount:    computed.subtotal > 0 ? computed.total : null,
          pi_subtotal:     header.pi_subtotal !== '' ? parseFloat(header.pi_subtotal) : null,
          pi_total:        header.pi_total    !== '' ? parseFloat(header.pi_total)    : null,
          discount_pct:    header.discount_pct    !== '' ? parseFloat(header.discount_pct)    : null,
          discount_amount: header.discount_amount !== '' ? parseFloat(header.discount_amount) : (computed.discountAmount > 0 ? computed.discountAmount : null),
        }),
        saveOrderLines(id, lines),
      ])
      await raceWrite(write)   // throws only on a fast rejection; otherwise proceeds

      // Keep the Postgres financial record in step. Deliberately AFTER the
      // Firestore write and deliberately not awaited into the failure path:
      // Firestore is the source of truth, so a Supabase hiccup must not make a
      // successful save look failed. Drift that results is caught by the
      // reconciliation on the Sales Invoices page rather than hidden.
      if (header.erp_si_no) {
        upsertInvoice({
          si_no: header.erp_si_no,
          uc_no: header.uc_no || null,
          order_id: id,
          customer: header.customer_name,
          currency: header.currency,
          total: computed.subtotal > 0 ? computed.total
               : (header.pi_total !== '' ? parseFloat(header.pi_total) : null),
          invoiced_at: header.invoiced_at || null,
        })
      }
      navigate('/shipments')
    } catch (err) {
      setExtractError(err.message || 'Could not save order.')
    } finally {
      setSaving(false)
    }
  }

  if (fetching) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="mb-4">
        <Link to="/shipments" className="text-sm text-brand-600 hover:underline">← Order Listing</Link>
        <div className="flex items-start justify-between gap-3 mt-1">
          <h1 className="text-2xl font-bold text-gray-900">
            {isEdit
              ? (header.erp_si_no || header.uc_no || 'Order Detail')
              : (isDirect ? 'Direct Invoice' : 'New Order')}
          </h1>
          {isEdit && (
            <a href={`/shipments/${id}/pi`} target="_blank" rel="noreferrer"
               className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0">
              <FileText size={14} /> Proforma Invoice
            </a>
          )}
        </div>
        {!isEdit && (
          <p className="text-sm text-gray-500 mt-1">
            {isDirect
              ? 'A retail sale invoiced directly — no sales order needed. Add the lines, then allocate an invoice number.'
              : 'Enter the order directly, or drop a PI below to have AI read the header and line items.'}
          </p>
        )}
      </div>

      {/* Tabs — only shown on edit (saved order) */}
      {isEdit && (
        <div className="flex gap-0 border-b border-gray-200 mb-5">
          {[
            { v: 'order',   label: 'Order & Lines' },
            { v: 'packing', label: 'Packing List' },
            { v: 'freight', label: 'Freight' },
          ].map(t => (
            <button
              key={t.v}
              type="button"
              onClick={() => setTab(t.v)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.v
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

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
        {/* PI upload (import only). Hidden for a direct invoice — a retail sale
            has no proforma to import, so offering the dropzone would suggest a
            step that does not exist. */}
        {!isEdit && !isDirect && (
          <div className="card p-4">
            <label
              className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors
                ${dragOver ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-brand-50'}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
              <span className="text-gray-500 mb-1">{dragOver ? <FolderOpen size={22} /> : <FileInput size={22} />}</span>
              <span className="text-sm text-gray-600">{dragOver ? 'Drop to import' : 'Click to upload or drag & drop a PI (PDF or image)'}</span>
              <span className="text-xs text-gray-400 mt-0.5">PDF, JPG, PNG</span>
              <input type="file" accept="image/*,.pdf" className="hidden"
                     onChange={e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = '' }} />
            </label>
            {pendingFile && (
              <div className="flex items-center gap-2 mt-3 text-xs text-gray-600">
                <FileText size={14} className="text-red-400" /> {pendingFile.name}
              </div>
            )}
            {extracting && <div className="mt-2 h-1 bg-brand-100 rounded overflow-hidden"><div className="h-full bg-brand-500 animate-pulse w-full" /></div>}
            {extractError && <p className="text-xs text-amber-600 mt-2">{extractError}</p>}
            <ErpCrossCheck check={erpCheck} onUse={useErpLines} />
          </div>
        )}

        {/* Header */}
        <div className="card p-4 md:p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Customer</label>
              <select className="input" value={customers.find(c => c.id === header.customer_id) ? header.customer_id : ''} onChange={onCustomer}>
                <option value="">— select customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
              {!header.customer_id && header.customer_name && (
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-amber-600">From PI: "{header.customer_name}" — not linked to any customer.</p>
                  <button type="button" onClick={addNewCustomer} disabled={addingCustomer}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline disabled:opacity-50">
                    {addingCustomer ? 'Adding…' : '+ Add as new customer'}
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="label flex items-center justify-between gap-2">
                  <span>SO / Doc No</span>
                  {!header.erp_so_no && (
                    <button type="button" onClick={doAllocateSo} disabled={allocatingSo}
                            className="text-[11px] text-brand-600 hover:text-brand-800 disabled:opacity-50 font-normal normal-case"
                            title="Allocate the next SO number. New orders get one automatically on create; this is for an older order that has none.">
                      {allocatingSo ? 'Allocating…' : 'Allocate'}
                    </button>
                  )}
                </label>
                <input className="input" value={header.erp_so_no} onChange={setH('erp_so_no')} placeholder="e.g. SO260017" />
                {soError && <p className="text-xs text-red-600 mt-1">{soError}</p>}
              </div>
              <div>
                <label className="label">UC#</label>
                <input className="input" value={header.uc_no} onChange={setH('uc_no')} placeholder="e.g. UC4950/26" />
              </div>
              <div>
                <label className="label">Customer PO</label>
                <input className="input" value={header.customer_po} onChange={setH('customer_po')} placeholder="e.g. 56909" />
              </div>
              <div>
                <label className="label flex items-center justify-between gap-2">
                  <span>Invoice No</span>
                  {!header.erp_si_no && (
                    <button type="button" onClick={doAllocateSi} disabled={allocatingSi}
                            className="text-[11px] text-brand-600 hover:text-brand-800 disabled:opacity-50 font-normal normal-case"
                            title="Issue the invoice: allocate the next SI number (and a UC if none), and stamp today as the invoice date. Deliberately manual — an order is invoiced when you invoice it, not when it is created.">
                      {allocatingSi ? 'Allocating…' : 'Allocate'}
                    </button>
                  )}
                </label>
                <input className="input" value={header.erp_si_no} onChange={setH('erp_si_no')} placeholder="e.g. SI260094" />
                {siError && <p className="text-xs text-red-600 mt-1">{siError}</p>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="label">Order Date</label>
              <input className="input" type="date" value={header.order_date} onChange={setH('order_date')} />
            </div>
            <div>
              <label className="label">Currency</label>
              <select className="input" value={header.currency} onChange={setH('currency')}>{ORDER_CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
            </div>
            <div>
              <label className="label">Incoterm</label>
              <select className="input" value={header.incoterm} onChange={setH('incoterm')}>{INCOTERMS.map(t => <option key={t}>{t}</option>)}</select>
            </div>
            {isEdit && (
              <div>
                <label className="label">Status</label>
                <select className="input" value={header.status} onChange={setStatus}>{ORDER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
                {stock && (
                  <span className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium border rounded-full px-2 py-0.5 ${STOCK_STATUS_STYLE[stock.state]}`}
                        title={stockStatusDetail(stock) || 'All material consumption for this order has been recorded.'}>
                    {stock.state !== 'recorded' && <AlertTriangle size={11} />}
                    {STOCK_STATUS_LABEL[stock.state]}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div><label className="label">Dest. Country</label><input className="input" value={header.destination.country} onChange={setDest('country')} placeholder="Germany" /></div>
            <div><label className="label">Dest. City</label><input className="input" value={header.destination.city} onChange={setDest('city')} placeholder="Hamburg" /></div>
            <div><label className="label">Port (optional)</label><input className="input" value={header.destination.port} onChange={setDest('port')} placeholder="Hamburg" /></div>
          </div>
          {sourceFile && (
            <a href={sourceFile.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline">
              <FileText size={13} /> {sourceFile.name || 'View source PI'}
            </a>
          )}
        </div>

        {/* Reconciliation. Rendered unconditionally: "+ Add line" lives inside
            this card, so gating it on `lines.length > 0 || isEdit` meant a
            brand-new order had no way to add its first line by hand — the only
            route in was Import PI. That made the app able to *parse* an order
            but never *originate* one. */}
        {(
          <div className="card p-4 md:p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Line items &amp; reconciliation</h2>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setLines(ls => rematchLines(ls, rangeProducts))}
                  className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1"
                  title="Re-run product matching by item code (keeps lines you classified manually)">
                  <RefreshCw size={12} /> Re-match
                </button>
                <button type="button" onClick={addBlankLine} className="text-xs text-brand-600 hover:text-brand-800">+ Add line</button>
              </div>
            </div>

            {unclassified > 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                <AlertTriangle size={14} />
                {unclassified} line{unclassified > 1 ? 's' : ''} still need a type. Classify every line before packing.
              </div>
            )}

            {lines.length === 0 && (
              <p className="text-sm text-ink-50 py-3 text-center">
                No lines yet — <button type="button" onClick={addBlankLine} className="text-brand-600 hover:underline">add one</button>
                {!isEdit && !isDirect && <> , or drop a PI above to import them.</>}
              </p>
            )}

            <div className="space-y-2">
              {lines.map((l, i) => {
                const t = l.line_type ? lineTypeOf(l.line_type) : null
                return (
                  <div key={i} className={`rounded-lg border p-3 ${l.line_type ? 'border-gray-200' : 'border-amber-200 bg-amber-50/40'}`}>
                    <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-start">
                      <div className="text-xs text-gray-400 pt-2 w-6">{l.line_no ?? i + 1}</div>
                      <div className="min-w-0 space-y-2">
                        <div className="grid grid-cols-[100px_1fr] sm:grid-cols-[140px_1fr] gap-2">
                          <input className="input py-1.5 text-sm font-mono" value={l.item_code} onChange={e => setLine(i, { item_code: e.target.value })} placeholder="Item code" />
                          {/* A textarea, not an input: one-off "MISC" lines
                              routinely carry multi-line descriptions in JES —
                              "SOCKS\nMaterial: Cotton + Polyester\nSize: 25-27".
                              A single-line input made those impossible to enter
                              at all. Drag to expand; newlines are preserved and
                              printed. */}
                          <textarea className="input py-1.5 text-sm resize-y leading-snug" rows={1} style={{ minHeight: '2.15rem' }}
                                    value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="Description" />
                        </div>
                        <div className="flex gap-2 items-center flex-wrap">
                          <input className="input py-1.5 text-sm w-20 sm:w-24" type="number" value={l.qty_ordered ?? ''} onChange={e => setLine(i, { qty_ordered: e.target.value })} placeholder="Qty" />
                          <input className="input py-1.5 text-sm w-16 sm:w-20" value={l.unit} onChange={e => setLine(i, { unit: e.target.value })} placeholder="pcs" />
                          <input className="input py-1.5 text-sm w-24 sm:w-28" type="number" step="0.01" value={l.unit_price ?? ''} onChange={e => setLine(i, { unit_price: e.target.value })} placeholder="Unit price" />
                          {l.matched_product_ref && (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700 truncate max-w-full"
                              title={l.matched_product_ref.name ? undefined : 'This product has no Description set in Figurine Gifts'}>
                              <CheckCircle2 size={13} /> {l.matched_product_ref.name || 'matched (no name set)'}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {LINE_TYPES.map(lt => (
                            <button key={lt.value} type="button" onClick={() => classify(i, lt.value)}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                                l.line_type === lt.value ? lt.style + ' border-current' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                              }`}>
                              {lt.label}
                            </button>
                          ))}
                          {t && !t.packable && <span className="text-[11px] text-gray-400 self-center ml-1">excluded from packing</span>}
                        </div>
                      </div>
                      <button type="button" onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 pt-2"><Trash2 size={15} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Order totals & discount ──────────────────────────────────── */}
        {lines.length > 0 && (() => {
          const { subtotal: computedSubtotal, chargesTotal, discountAmount: discAmt, total: computedTotal } = computeOrderTotals(header, lines)
          const piSubtotal   = parseFloat(header.pi_subtotal) || null
          const piTotal      = parseFloat(header.pi_total) || null
          const subtotalMatch = piSubtotal == null || Math.abs(computedSubtotal - piSubtotal) < 0.02
          const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          return (
            <div className="card p-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Order Totals</h2>
              <div className="space-y-1.5 text-sm">
                {/* Computed subtotal vs PI stated */}
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Computed subtotal</span>
                  <span className="font-mono font-medium text-gray-800">{header.currency} {fmt(computedSubtotal)}</span>
                </div>
                {piSubtotal != null && (
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5 text-gray-500">
                      PI stated subtotal
                      {subtotalMatch
                        ? <span className="text-green-600 text-xs">✓ match</span>
                        : <span className="text-amber-600 text-xs">⚠ mismatch</span>}
                    </span>
                    <span className={`font-mono text-sm ${subtotalMatch ? 'text-gray-500' : 'text-amber-600 font-medium'}`}>
                      {header.currency} {fmt(piSubtotal)}
                    </span>
                  </div>
                )}

                {/* Charges — flat-amount lines (freight, insurance, etc.) with no qty */}
                {chargesTotal > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Charges (freight, insurance, etc.)</span>
                    <span className="font-mono text-gray-800">+ {header.currency} {fmt(chargesTotal)}</span>
                  </div>
                )}

                {/* Discount row */}
                <div className="flex items-center justify-between pt-1 border-t border-gray-100 mt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">Discount</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number" step="0.01" min="0" max="100"
                        className="input py-0.5 text-xs w-16 text-right"
                        value={header.discount_pct}
                        onChange={e => {
                          const pct = e.target.value
                          const amt = pct !== '' ? +((parseFloat(piSubtotal || computedSubtotal) * parseFloat(pct) / 100)).toFixed(2) : ''
                          setHeader(h => ({ ...h, discount_pct: pct, discount_amount: isNaN(amt) ? '' : amt }))
                        }}
                        placeholder="0"
                      />
                      <span className="text-xs text-gray-400">%</span>
                    </div>
                  </div>
                  <span className="font-mono text-sm text-red-600">
                    {discAmt > 0 ? `− ${header.currency} ${fmt(discAmt)}` : '—'}
                  </span>
                </div>

                {/* Total */}
                <div className="flex justify-between items-center pt-1.5 border-t border-gray-200 mt-0.5">
                  <span className="font-semibold text-gray-800">Total Amount</span>
                  <div className="text-right">
                    <span className="font-mono font-bold text-gray-900 text-base">{header.currency} {fmt(computedTotal)}</span>
                    {piTotal != null && Math.abs(computedTotal - piTotal) >= 0.02 && (
                      <div className="text-xs text-amber-600">PI states {header.currency} {fmt(piTotal)}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Component stock — issue this order's figurine BOM to the ledger (V7.13a) */}
        {isEdit && <OrderStockIssue orderId={id} orderLabel={header.uc_no || header.erp_so_no || id} />}

        {/* Crystal + packaging stock — batch-issue this order's consumption (V7.13a) */}
        {isEdit && <OrderInventoryIssue orderId={id} orderLabel={header.uc_no || header.erp_so_no || id} inv={crystalInventory} />}
        {isEdit && <OrderInventoryIssue orderId={id} orderLabel={header.uc_no || header.erp_so_no || id} inv={packagingInventory} />}

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" className="btn-primary" disabled={saving || (!isEdit && lines.length === 0)}>
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
      </form>
      )}
    </div>
  )
}

// ── Image utilities (mirror RangeQuoteForm) ──────────────────────────────────
async function preprocessForGemini(file, maxPx = 2400) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, w, h)
  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    data[i] = data[i + 1] = data[i + 2] = grey
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

async function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
