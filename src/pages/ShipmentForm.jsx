import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { authHeader } from '../firebase'
import { hasIncompleteRangeLine, quoteItemToOrderLine } from '../rangeQuote'
import {
  applyExtractedPiHeader,
  getOrder, getOrderLines, getOrderEditSnapshot, updateOrder, saveOrderWithLines, deleteOrder,
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
import { allocateSoNo } from '../soNumber'
import { upsertInvoice, allocateOrderUc } from '../ucRegistry'
import {invoiceAction} from '../invoiceRecovery'
import {invoiceExpected,invoiceReferenceValues,invoiceReferenceSavePatch,sameInvoiceValue} from '../invoiceRecoveryModel.js'
import ShipmentInvoiceRecovery from '../components/shipping/ShipmentInvoiceRecovery'
import QuoteOrderRecovery from '../components/shipping/QuoteOrderRecovery'
import {quoteConversionAction} from '../quoteConversion'
import {quoteSourceToken} from '../quoteConversionModel.js'
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
import OrderEditConflict from '../components/shipping/OrderEditConflict'
import { loadOrderEditDrafts, storeOrderEditDraft, removeOrderEditDraft } from '../orderEditDrafts'
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

export default function ShipmentForm({ uid, onCreateOrder }) {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  // A route change must never reuse another order's editable state, pending
  // reads, stock subscription or async allocation/import state.
  const newContext = ['customer_id', 'from_quote', 'direct'].map(k => searchParams.get(k) || '')
  return <ShipmentEditor onCreateOrder={onCreateOrder} uid={uid} key={id ? `order:${uid || ''}:${id}` : `new:${uid || ''}:${JSON.stringify(newContext)}`} />
}

function ShipmentEditor({ uid, onCreateOrder }) {
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
  const hasQuoteSource = Boolean(fromQuoteId && !isEdit)
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
  const editBase = useRef(null)
  const saveAttempt = useRef(null)
  const [editConflict, setEditConflict] = useState(null)
  const [editDrafts, setEditDrafts] = useState([])
  const [draftWarning, setDraftWarning] = useState('')
  const [checkingEdit, setCheckingEdit] = useState(false)

  function keepDraft(draft) {
    const stored = storeOrderEditDraft(uid, id, draft)
    setEditDrafts(old => [draft, ...old.filter(item => item.id !== draft.id)])
    if (uid && !stored) setDraftWarning('Your draft is kept in this tab, but device storage is unavailable. Keep this page open until you have copied your edits.')
  }

  async function checkLatestEdit() {
    setCheckingEdit(true)
    try {
      const latest = await getOrderEditSnapshot(id)
      if (mounted.current) setEditConflict(current => ({ ...current, latest, error: '' }))
    } catch (error) {
      if (mounted.current) setEditConflict(current => ({ ...current, error: error.message }))
    } finally { if (mounted.current) setCheckingEdit(false) }
  }

  function loadLatestEdit() {
    const latest = editConflict?.latest
    if (!latest) return
    const draft = { ...saveAttempt.current, header, lines, base: editBase.current,
      savedAt: new Date().toISOString() }
    if (draft.id) keepDraft(draft)
    const next = orderEditFields(latest.order, blankHeader.destination)
    editBase.current = latest.base
    referenceBase.current = next
    setHeader(next); setLines(latest.lines); setSourceFile(latest.order.source_file || null)
    saveAttempt.current = null
    setEditConflict(null); setExtractError('')
  }

  async function restoreEditDraft(draft) {
    saveAttempt.current = draft
    editBase.current = draft.base
    referenceBase.current = draft.header
    setHeader(draft.header); setLines(draft.lines)
    setEditConflict({ latest: null, error: '' })
    await checkLatestEdit()
  }

  function discardEditDraft(draftId) {
    if (!window.confirm('Discard this preserved draft from this device?')) return
    removeOrderEditDraft(uid, id, draftId)
    if (saveAttempt.current?.id === draftId) saveAttempt.current = null
    setEditDrafts(old => old.filter(draft => draft.id !== draftId))
  }

  useEffect(() => {
    if (!editConflict || !saveAttempt.current) return
    const draft = { ...saveAttempt.current, header, lines, base: editBase.current,
      savedAt: new Date().toISOString() }
    saveAttempt.current = draft
    keepDraft(draft)
  }, [header, lines, editConflict])

  const [customers, setCustomers] = useState([])
  const [rangeProducts, setRangeProducts] = useState([])
  const [sourceFile, setSourceFile] = useState(null)   // { url, name } existing
  const [pendingFile, setPendingFile] = useState(null) // File belonging to the applied PI data
  const [importingFileName, setImportingFileName] = useState(null)
  // Each attempt owns its result, busy state and ERP comparison. A replacement
  // does not replace the committed file until its parsed data can be applied.
  const piImport = useRef({ id: 0, extracting: false, soNo: null })

  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  // { soNo, erp, diff, adopted? } — result of checking the parse against
  // the ERP's own sales order. null when there's nothing to say.
  const [erpCheck, setErpCheck] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [loadRevision, setLoadRevision] = useState(0)
  const [quoteLoad, setQuoteLoad] = useState(() => ({ status: hasQuoteSource ? 'loading' : 'idle', message: '' }))
  const quoteReady = !hasQuoteSource || ['ready', 'empty'].includes(quoteLoad.status)
  const [quoteRecovery,setQuoteRecovery]=useState(null)
  const [quoteRecoveryBusy,setQuoteRecoveryBusy]=useState(false)
  const [quoteRecoveryError,setQuoteRecoveryError]=useState('')
  const [quoteAdditional,setQuoteAdditional]=useState(null)
  const [quoteDraftIssue,setQuoteDraftIssue]=useState('')
  const quoteSource=useRef(null)
  const recoveryInFlight=useRef(false)
  const hasQuoteOrders=Boolean(quoteRecovery?.latest||quoteRecovery?.legacy)
  const showQuoteDraft=!hasQuoteSource||Boolean(quoteRecovery&&!quoteDraftIssue&&!quoteRecovery.active&&(!hasQuoteOrders||quoteAdditional))
  const [saving, setSaving] = useState(false)
  const [savePending, setSavePending] = useState(false)
  const saveInFlight = useRef(false)
  const createInFlight = useRef(false)
  const invoiceInFlight = useRef(false)
  const invoiceReadSequence = useRef(0)
  const referenceBase = useRef(null)
  const [invoiceState,setInvoiceState]=useState(null)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      piImport.current = { id: piImport.current.id + 1, extracting: false, soNo: null }
    }
  }, [])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState('order')

  useEffect(() => {
    let alive = true
    const preCustomerId = searchParams.get('customer_id')
    setFetching(isEdit)
    setLoadError('')
    if (hasQuoteSource) setQuoteLoad({ status: 'loading', message: '' })
    if (hasQuoteSource) {setQuoteRecovery(null);setQuoteRecoveryError('');setQuoteAdditional(null);setQuoteDraftIssue('');quoteSource.current=null}
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
        const drafts = loadOrderEditDrafts(uid, id)
        let snapshot
        try { snapshot = await getOrderEditSnapshot(id) }
        catch (error) {
          if (!alive) return
          if (!drafts.length) throw error
          const draft = drafts[0]
          editBase.current = draft.base
          saveAttempt.current = draft
          referenceBase.current = draft.header
          setHeader(draft.header); setLines(draft.lines); setEditDrafts(drafts)
          setEditConflict({ latest: null, error: error.message })
          return
        }
        if (!alive) return
        const { order: o, lines: orderLines, base } = snapshot
        editBase.current = base
        const pending = drafts.filter(draft => {
          if (snapshot.lastEditId === draft.id && base.revision === draft.base.revision + 1) {
            removeOrderEditDraft(uid, id, draft.id)
            return false
          }
          return true
        })
        setEditDrafts(pending)
        const edit = orderEditFields(o, blankHeader.destination)
        referenceBase.current = edit
        setHeader(edit); setSourceFile(o.source_file || null); setLines(orderLines)
      })())
    }
    if (hasQuoteSource) {
      loads.push((async () => {
        const qSnap = await getDoc(doc(db, 'client_quotes', fromQuoteId))
        if (!alive) return null
        if (!qSnap.exists()) throw new Error('That quote could not be found.')
        const quote = qSnap.data()
        const itemSnap = await getDocs(collection(db, 'client_quotes', fromQuoteId, 'items'))
        if (!alive) return null
        const items = itemSnap.docs.map(d => ({...d.data(),id:d.id}))
        const token=await quoteSourceToken(quote,items)
        const recovery=await quoteConversionAction(fromQuoteId)
        if(!alive)return null
        if(recovery.source_token!==token)throw new Error('The quote changed while it was loading. Retry to review its current details.')
        const issue=quote.quote_type==='uploaded'?'This quote has no product lines to convert — it\'s an uploaded document.':items.some(hasIncompleteRangeLine)?'A Crystocraft Range line has no quantity or positive price. Complete the quote before converting it to a PI.':''
        if(issue&&!recovery.active&&!recovery.latest&&!recovery.legacy)throw new Error(issue)
        return { quote, lines: items.map(quoteItemToOrderLine),recovery,token,issue }
      })())
    }
    Promise.all(loads)
      .then(results => {
        if (!alive || !hasQuoteSource) return
        // Apply once, after BOTH quote reads and common startup reads complete.
        // The route-keyed editor freezes fromQuoteId/customer_id for this attempt.
        const source = results.at(-1)
        if (!source) return
        const q = source.quote
        setHeader(h => ({
          ...h,
          customer_id: q.customer_id || h.customer_id,
          customer_name: q.client_name || h.customer_name,
          currency: q.quote_currency || h.currency,
          uc_no: looksLikeUc(q.ref_no) ? q.ref_no.trim() : h.uc_no,
          notes: q.quote_no ? `Converted from Quote ${q.quote_no}` : h.notes,
        }))
        setLines(source.lines)
        quoteSource.current=source.token
        setQuoteRecovery(source.recovery)
        setQuoteDraftIssue(source.issue)
        setQuoteLoad(source.lines.length
          ? { status: 'ready', message: '' }
          : { status: 'empty', message: 'That quote has no product lines yet — add lines manually.' })
      })
      .catch(err => {
        if (!alive) return
        if (hasQuoteSource) setQuoteLoad({ status: 'error', message: err.message || 'Could not load the quote and its product lines. Please retry.' })
        else setLoadError(err.message || 'Could not load this order. Please retry.')
      })
      .finally(() => { if (alive) setFetching(false) })
    return () => { alive = false }
  }, [id, isEdit, loadRevision])

  async function runQuoteRecovery(action='status',details={}) {
    if(recoveryInFlight.current||createInFlight.current)return
    recoveryInFlight.current=true
    setQuoteRecoveryBusy(true);setQuoteRecoveryError('')
    try{
      const result=await quoteConversionAction(fromQuoteId,action,details)
      if(!mounted.current)return
      if(details.cursor)setQuoteRecovery(old=>({...old,history:[...old.history,...result.history],more_history:result.more_history,next_cursor:result.next_cursor}))
      else{setQuoteRecovery(result);setQuoteAdditional(null)}
      if(result.result?.order_id)navigate(`/shipments/${result.result.order_id}`)
      if(action==='cancel')setLoadRevision(v=>v+1)
    }catch(e){if(mounted.current)setQuoteRecoveryError(e.message)}
    finally{recoveryInFlight.current=false;if(mounted.current)setQuoteRecoveryBusy(false)}
  }

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
    if (saveInFlight.current || invoiceLocked) return
    setAllocatingSo(true); setSoError('')
    try {
      const no = await allocateSoNo()
      invalidatePiComparison()
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
    if (saveInFlight.current || invoiceLocked) return
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
  const invoiceLocked=allocatingSi||Boolean(invoiceState?.operation&&invoiceState.operation.status!=='linked')
  function applyInvoiceState(state) {
    setInvoiceState(state)
    // Server reference state is authoritative, but never erase an unsaved edit.
    setHeader(h=>{
      if(referenceBase.current&&!sameInvoiceValue(invoiceReferenceValues(h),invoiceReferenceValues(referenceBase.current)))return h
      const next={...h,...state.order}
      referenceBase.current={...next}
      if (editBase.current && state.editBase &&
          state.editBase.lastCommercialId === editBase.current.lastCommercialId &&
          sameInvoiceValue(state.editBase.created, editBase.current.created)) {
        editBase.current = state.editBase
      }
      return next
    })
  }
  useEffect(()=>{
    if(!isEdit||fetching||loadError||!header.invoice_allocation_id&&header.source!=='direct_invoice')return
    let alive=true
    const read=async()=>{
      if(invoiceInFlight.current)return
      const seq=++invoiceReadSequence.current
      try{const state=await invoiceAction(id,'status');if(alive&&seq===invoiceReadSequence.current)applyInvoiceState(state)}
      catch(error){if(alive&&seq===invoiceReadSequence.current)setSiError(error.message)}
    }
    read()
    const timer=setInterval(read,15000)
    return()=>{alive=false;clearInterval(timer)}
  },[id,isEdit,fetching,loadError,header.invoice_allocation_id,header.source])

  async function runInvoiceAction(action,details={}) {
    if(editConflict||saveInFlight.current||invoiceInFlight.current||allocatingSo||allocatingUc)return
    if(!id){setSiError('Create and save this order before raising its invoice.');return}
    invoiceInFlight.current=true;++invoiceReadSequence.current
    setAllocatingSi(true);setSiError('')
    try{
      const state=await invoiceAction(id,action,{...details,...(['raise','new'].includes(action)?{expected:invoiceExpected(header)}:{})})
      if(mounted.current)applyInvoiceState(state)
    }catch(error){
      if(mounted.current)setSiError(error.message||'Confirmation unavailable. Reopen this saved order and resume the same request.')
      throw error
    }finally{
      invoiceInFlight.current=false
      if(mounted.current)setAllocatingSi(false)
    }
  }
  async function doAllocateSi() {
    await runInvoiceAction(invoiceState?.operation?'resume':'raise').catch(()=>{})
  }

  const setH = field => e => {
    if (field === 'erp_so_no') invalidatePiComparison()
    setHeader(h => ({ ...h, [field]: e.target.value }))
  }
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
    if (saving || saveInFlight.current || !mounted.current) return
    const attempt = { id: piImport.current.id + 1, extracting: true, soNo: null }
    piImport.current = attempt
    setImportingFileName(file.name)
    setErpCheck(null)
    setExtracting(true); setExtractError('')
    try {
      const payload = await preparePiUploadFile(file)
      const auth = await authHeader()
      if (!mounted.current || piImport.current !== attempt) return
      const res = await fetch('/api/extract-pi', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Extraction failed')
      const data = await res.json()
      if (!mounted.current || piImport.current !== attempt) return

      const matched = autoMatchLines(data.lines || [], rangeProducts)
      attempt.soNo = String(data.so_no || '').trim().toUpperCase()
      setHeader(h => applyExtractedPiHeader(h, data, customers))
      setLines(matched)
      setPendingFile(file)
      if (!matched.length) setExtractError('No line items found — check the file or add lines manually.')

      // The PI is the JES sales order, so its lines already exist in the ERP
      // mirror. Cross-check the parse against them — the ERP's version is the
      // original, the parse is a reading of a picture of it.
      checkAgainstErp(data.so_no, matched, attempt)
    } catch (err) {
      if (mounted.current && piImport.current === attempt) {
        setExtractError(err.code === 'pi-file-too-large'
          ? `${err.message} The existing fields and lines have been kept; this file was not attached.`
          : `Could not read this PI (${file.name}) — the existing fields and lines have been kept. The failed file was not attached; try another file or continue manually.`)
      }
    } finally {
      if (mounted.current && piImport.current === attempt) {
        attempt.extracting = false
        setExtracting(false)
        setImportingFileName(null)
      }
    }
  }

  // ── ERP cross-check ────────────────────────────────────────────────────────
  function invalidatePiComparison() {
    piImport.current.soNo = null
    setErpCheck(null)
  }

  async function checkAgainstErp(soNo, parsedLines, attempt) {
    if (!soNo) return
    try {
      const erp = await fetchErpSoLines(soNo)
      // Not in the mirror yet (raised since the last sync) — say nothing and
      // leave the parsed lines alone. This must never block the workflow.
      if (!erp) return
      const checkedSo = String(soNo).trim().toUpperCase()
      if (!mounted.current || piImport.current !== attempt || attempt.soNo !== checkedSo) return
      setErpCheck({ importId: attempt.id, soNo: checkedSo, erp, diff: diffLines(parsedLines, erp) })
    } catch (e) {
      console.error('ERP SO cross-check failed', e)
    }
  }

  function useErpLines() {
    const current = piImport.current
    if (!erpCheck || current.extracting || current.id !== erpCheck.importId
        || current.soNo !== erpCheck.soNo
        || String(header.erp_so_no || '').trim().toUpperCase() !== erpCheck.soNo) return
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
    if (piImport.current.extracting || createInFlight.current || recoveryInFlight.current || !quoteReady || !showQuoteDraft) return
    createInFlight.current=true
    setSaving(true)
    setExtractError('')
    setQuoteRecoveryError('')
    try {
      // Fall back to the line-item-computed total when the PI extraction never
      // captured a stated total — otherwise the order silently has no value
      // even though a correct one is computable (and was shown on this page).
      const computed = computeOrderTotals(header, lines)
      const orderData = orderCreateFields(header, computed, pendingFile ? {name: pendingFile.name} : null, isDirect)
      const v = validateOrder(orderData, lines)
      if (!v.ok) { setExtractError(v.errors.map(x => x.message).join(' · ')); return }

      if(hasQuoteSource){
        try{
          const saved=await quoteConversionAction(fromQuoteId,'prepare',{
            expected_revision:quoteRecovery.revision,expected_source:quoteSource.current,
            kind:quoteAdditional?'additional':'initial',reason:quoteAdditional?.reason||'',
            legacy_review:quoteAdditional?.legacy_review||null,draft:{order:orderData,lines},
          })
          if(mounted.current){setQuoteRecovery(saved);setQuoteAdditional(null)}
          if(saved.active){
            const completed=await quoteConversionAction(fromQuoteId,'commit',{operation_id:saved.active.id})
            if(mounted.current){setQuoteRecovery(completed);if(completed.result?.order_id)navigate(`/shipments/${completed.result.order_id}`)}
          }
        }catch(error){
          if(mounted.current){
            // A request may already be prepared or committed. Hide Create until
            // a successful status check; never treat a timeout as a new intent.
            setQuoteRecovery(null);setQuoteAdditional(null);setQuoteRecoveryError(error.message)
            try{const recovered=await quoteConversionAction(fromQuoteId);if(mounted.current)setQuoteRecovery(recovered)}catch{/* Keep Check saved requests available, Create blocked. */}
          }
        }
        return
      }

      await onCreateOrder(orderData, lines, pendingFile)
    } catch (err) {
      setExtractError(err.message || 'Could not create order.')
    } finally {
      // Clear busy state on validation/upload/create failures too, so the
      // current form remains usable when creation does not navigate away.
      createInFlight.current=false
      if(mounted.current)setSaving(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    if (editConflict || saveInFlight.current || fetching || loadError || allocatingSo || allocatingUc || allocatingSi || extracting) return
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
      const stableLines = lines.map(line => ({ ...line, id: line.id || crypto.randomUUID() }))
      setLines(stableLines)
      const previous = saveAttempt.current
      const attemptId = previous && sameInvoiceValue(previous.header, header) && sameInvoiceValue(previous.lines, stableLines)
        ? previous.id : crypto.randomUUID()
      const draft = { id: attemptId, header, lines: stableLines, base: editBase.current, savedAt: new Date().toISOString() }
      saveAttempt.current = draft
      keepDraft(draft)
      await saveOrderWithLines(id, {...orderSaveFields(header, computed, accountingTotal, adjustment),...invoiceReferenceSavePatch(header,referenceBase.current)}, stableLines,
        { base: editBase.current, attemptId })
      removeOrderEditDraft(uid, id, attemptId)

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
      if (mounted.current) {
        setExtractError(err.message || 'Could not save order.')
        if (saveAttempt.current && err.code === 'order-edit-conflict')
          setEditConflict({ latest: err.latest || null, error: '' })
      }
    } finally {
      clearTimeout(pendingTimer)
      saveInFlight.current = false
      if (mounted.current) { setSaving(false); setSavePending(false) }
    }
  }

  if (!quoteReady) return (
    <div className="p-4 md:p-6 max-w-4xl">
      <Link to="/shipments" className="text-sm text-brand-600 hover:underline">← Order Listing</Link>
      <h1 className="text-2xl mt-1 mb-4">{isDirect ? 'Direct Invoice' : 'New Order'}</h1>
      <section aria-label="Quote initialization" aria-busy={quoteLoad.status === 'loading'} className="card p-4 md:p-6 space-y-3">
        <h2 className="eyebrow">{quoteLoad.status === 'error' ? 'Quote could not be loaded' : 'Loading quote'}</h2>
        {quoteLoad.status === 'error'
          ? <p role="alert" className="text-sm text-brand-600 break-words">{quoteLoad.message}</p>
          : <p role="status" className="text-sm text-ink-60">Loading the quote and its product lines. Editing will be available when it is ready.</p>}
        <div className="flex flex-wrap gap-3">
          {quoteLoad.status === 'error' && <button type="button" className="btn-primary min-h-[44px]" onClick={() => {
            setQuoteLoad({ status: 'loading', message: '' })
            setLoadRevision(n => n + 1)
          }}>Retry</button>}
          <Link to={`/quotes/${encodeURIComponent(fromQuoteId)}`} className="btn-secondary min-h-[44px]">Back to quote</Link>
        </div>
      </section>
    </div>
  )
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
        id={id} isEdit={isEdit} isDirect={isDirect} fromQuote={hasQuoteSource}
        invoiceNo={header.erp_si_no} ucNo={header.uc_no}
        allocatingSi={allocatingSi} saving={saving || Boolean(editConflict)} siError={siError}
        onRaiseInvoice={doAllocateSi} tab={tab} onTabChange={setTab}
      />

      {isEdit&&(invoiceState||header.invoice_allocation_id||invoiceExpected(header).si||header.source==='direct_invoice')&&<ShipmentInvoiceRecovery
        state={invoiceState||(!header.invoice_allocation_id?{order:header,expected:invoiceExpected(header),history:[],operation:null,canStartNew:true}:null)}
        busy={allocatingSi||saving||Boolean(editConflict)} error={siError} hasInvoice={!!invoiceExpected(header).si} onAction={runInvoiceAction}
      />}

      {hasQuoteSource&&<QuoteOrderRecovery state={quoteRecovery} busy={saving||quoteRecoveryBusy} error={quoteRecoveryError}
        draftIssue={quoteDraftIssue} sourceHref={`/quotes/${encodeURIComponent(fromQuoteId)}`}
        onReload={()=>runQuoteRecovery()} onResume={operation_id=>runQuoteRecovery('commit',{operation_id})}
        onCancel={(operation_id,reason)=>runQuoteRecovery('cancel',{operation_id,reason})}
        onAdditional={details=>{setQuoteAdditional(details);setQuoteRecoveryError('')}} additional={quoteAdditional}
        onCloseAdditional={()=>setQuoteAdditional(null)} onMore={cursor=>runQuoteRecovery('status',{cursor})} />}

      {/* Packing list tab */}
      {isEdit && tab === 'packing' && (
        <PackingListEditor orderId={id} orderLines={lines} />
      )}

      {/* Freight comparison tab */}
      {isEdit && tab === 'freight' && (
        <FreightComparison orderId={id} />
      )}

      {/* Order tab (or new shipment form) */}
      {(!isEdit || tab === 'order') && showQuoteDraft && (
      <form onSubmit={isEdit ? handleSave : handleCreate} className="space-y-5">
      {isEdit && <OrderEditConflict conflict={editConflict} drafts={editDrafts} warning={draftWarning}
        busy={saving || checkingEdit} onCheck={checkLatestEdit} onLoadLatest={loadLatestEdit}
        onRestore={restoreEditDraft} onDiscard={discardEditDraft} />}
      <fieldset disabled={saving || Boolean(editConflict)} className="space-y-5 min-w-0">
        {hasQuoteSource && (
          quoteLoad.status === 'empty' ? (
            <p role="status" className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-none px-3 py-2">{quoteLoad.message}</p>
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
            fileName={importingFileName ?? pendingFile?.name}
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
          referencesLocked={invoiceLocked}
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
          <button type="submit" className="btn-primary" disabled={Boolean(editConflict) || saving || allocatingSo || allocatingUc || allocatingSi || extracting || (!isEdit && lines.length === 0)}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Order'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate('/shipments')}>Cancel</button>
          {isEdit && !header.quote_conversion_id && (
            <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto inline-flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700">
              <Trash2 size={15} /> Delete order
            </button>
          )}
        </div>
        {isEdit&&header.quote_conversion_id&&<p className="text-sm text-ink-60">This order has a saved quote conversion receipt. Deletion is blocked to preserve its order and numbering history.</p>}

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
