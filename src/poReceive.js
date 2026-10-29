import {collection,doc,getDoc,getDocs,runTransaction,serverTimestamp} from 'firebase/firestore'
import {db,authedUser} from './firebase'
import {loadComponents} from './criticalComponents'
import {loadCrystals} from './crystals'
import {loadPackaging} from './packaging'
import {stageStockMovement} from './stockLedger'
import {sameFirestoreValue as same} from './firestoreValue.js'
import {RECEIVE_CLASS_PATH,inventoryIndex,matchPoLines,groupReceiptLines,receiptKey,poCode,legacyReceiptId,receiptId,correctionId} from './poReceiptModel.js'
export {RECEIVE_CLASS_PATH} from './poReceiptModel.js'

async function loadIndex() {
  const [metal,crystal,packaging] = await Promise.all([loadComponents(),loadCrystals(),loadPackaging()])
  return inventoryIndex({metal,crystal,packaging})
}
const itemRef = l => doc(db,RECEIVE_CLASS_PATH[l.cls],l.sku_id)
const movementRef = (l,id) => doc(db,RECEIVE_CLASS_PATH[l.cls],l.sku_id,'movements',id)
const generation = po => Number.isInteger(po.receive_generation) && po.receive_generation >= 0 ? po.receive_generation : 0
const savedGroups = lines => (lines || []).map(l=>({cls:l.cls,sku_id:l.sku_id,code:l.code,qty:l.qty,source_lines:l.source_lines || []}))
const conflict = result => { if(result.conflicts.length) throw Error(result.conflicts.map(c=>c.reason).join(' ')) }

export async function computePoReceive(po) { return matchPoLines(po,await loadIndex()) }

// One transaction owns the PO receipt and all item movements/balances. Sum
// repeated SKU rows BEFORE assigning a movement ID. No partially posted receipt.
export async function receivePo(poId,poNumber,lines,expectedLines) {
  if (!Array.isArray(expectedLines)) throw Error('Reload the PO before receiving stock.')
  const groups = groupReceiptLines(lines),index = await loadIndex(),ref = doc(db,'purchase_orders',poId)
  return runTransaction(db,async tx=>{
    const snap = await tx.get(ref)
    if (!snap.exists()) throw Error('PO no longer exists.')
    const po = snap.data(),gen = generation(po)
    if (!same(po.lines || [],expectedLines)) throw Error('PO lines changed. Reload before receiving stock.')
    const matched = matchPoLines(po,index); conflict(matched)
    for (const line of lines) {
      const current = matched.items.find(it=>it.line_index === line.line_index)
      if (!current || current.cls !== line.cls || current.sku_id !== line.sku_id || poCode(current.code) !== poCode(line.code)) throw Error('Stock matching changed. Reload the receipt preview.')
    }
    if (po.stock_received) {
      if (po.stock_receipt_version === 2 && same(savedGroups(po.received_lines),groups)) return po.received_lines
      throw Error('Stock already received for this PO. Review its receipt instead.')
    }
    const reads = await Promise.all(groups.map(async l=>({line:l,item:await tx.get(itemRef(l)),old:await tx.get(movementRef(l,legacyReceiptId(poId,gen,l.sku_id))),posted:await tx.get(movementRef(l,receiptId(poId,gen,l)))})))
    for (const r of reads) {
      if (!r.item.exists() || poCode(r.item.data().code) !== poCode(r.line.code)) throw Error('Stock item changed. Reload the receipt preview.')
      if (r.old.exists() || r.posted.exists()) throw Error('Existing receipt movements need review before this PO can be received.')
    }
    const received = groups.map(l=>({...l,movement_ids:[receiptId(poId,gen,l)]}))
    for (const r of reads) stageStockMovement(tx,RECEIVE_CLASS_PATH[r.line.cls],r.line.sku_id,r.item.data(),{
      type:'receipt',qty:r.line.qty,note:`Received PU ${po.pu_number || poNumber || poId}`,
    },movementRef(r.line,receiptId(poId,gen,r.line)))
    tx.update(ref,{stock_received:true,stock_received_at:serverTimestamp(),received_lines:received,receive_generation:gen,stock_receipt_version:2})
    return received
  })
}

function recordedTargets(poId,po) {
  const groups = new Map(),gen = generation(po)
  for (const line of po.received_lines || []) {
    if (!RECEIVE_CLASS_PATH[line.cls] || !line.sku_id) throw Error('Receipt contains an unknown stock item.')
    const key = receiptKey(line),g = groups.get(key) || {...line,movement_ids:[]}
    for (const id of line.movement_ids || [legacyReceiptId(poId,gen,line.sku_id)]) if (!g.movement_ids.includes(id)) g.movement_ids.push(id)
    groups.set(key,g)
  }
  if (groups.size > 100) throw Error('Too many receipt items to review together.')
  return [...groups.values()]
}
async function readPosted(get,poId,po,targets) {
  const posted = []
  for (const target of targets) for (const id of target.movement_ids) {
    const allowed = [legacyReceiptId(poId,generation(po),target.sku_id),receiptId(poId,generation(po),target),correctionId(poId,generation(po),target)]
    if (!allowed.includes(id)) throw Error('Unrecognized receipt movement. Manual stock review is required.')
    const ref = movementRef(target,id),snap = await get(ref)
    if (!snap.exists() || snap.data().type !== 'receipt' || !Number.isFinite(snap.data().qty) || snap.data().qty <= 0) throw Error('Receipt movement is missing or invalid. Manual stock review is required.')
    posted.push({target,id,ref,data:snap.data()})
  }
  return posted
}

// Reverse the actual movements, not possibly incorrect legacy received_lines.
export async function reversePoReceive(poId,poNumber,expectedReceipt) {
  const ref = doc(db,'purchase_orders',poId)
  return runTransaction(db,async tx=>{
    const snap = await tx.get(ref)
    if (!snap.exists()) throw Error('PO no longer exists.')
    const po = snap.data(),gen = generation(po)
    if (!po.stock_received) return
    if (!expectedReceipt || gen !== expectedReceipt.generation || !same(po.received_lines,expectedReceipt.lines)) throw Error('Receipt changed. Reload before reversing it.')
    const targets = recordedTargets(poId,po),posted = await readPosted(r=>tx.get(r),poId,po,targets)
    const reads = await Promise.all(targets.map(async l=>({line:l,item:await tx.get(itemRef(l)),reverse:await tx.get(movementRef(l,`po_reverse_v2_${poId}_g${gen}_${l.cls}_${l.sku_id}`)),oldReverse:await tx.get(movementRef(l,`po_receive_reverse_${poId}_g${gen}_${l.sku_id}`))})))
    for (const r of reads) if (!r.item.exists() || r.reverse.exists() || r.oldReverse.exists()) throw Error('Stock item or an earlier reversal needs review before reversing.')
    for (const r of reads) stageStockMovement(tx,RECEIVE_CLASS_PATH[r.line.cls],r.line.sku_id,r.item.data(),{
      type:'adjustment',qty:-posted.filter(p=>receiptKey(p.target) === receiptKey(r.line)).reduce((sum,p)=>sum+p.data.qty,0),note:`Reversed PU receipt ${po.pu_number || poNumber || poId}`,
    },movementRef(r.line,`po_reverse_v2_${poId}_g${gen}_${r.line.cls}_${r.line.sku_id}`))
    tx.update(ref,{stock_received:false,stock_received_at:null,received_lines:[],receive_generation:gen+1})
  })
}

const receiptBaseline = po => ({lines:po.lines || [],received_lines:po.received_lines || [],stock_received:!!po.stock_received,receive_generation:generation(po),stock_receipt_version:po.stock_receipt_version || null,receipt_corrections:po.receipt_corrections || {}})
const stockBaseline = d => ({code:d.code || '',name:d.name || '',stock_qty:d.stock_qty ?? null,reserved_qty:d.reserved_qty ?? null,movement_seq:d.movement_seq ?? null,ledger_seeded:d.ledger_seeded ?? false})
function correctedPoLines(po,index) {
  return (po.lines || []).map(l=>{
    if (!(Number(l.qty)>0)) return l
    const candidates = index.byCode.get(poCode(l.code)) || []
    if (candidates.length !== 1) throw Error(`Item code ${l.code} does not identify one stock item.`)
    const rec = candidates[0],old = l.linked?.type === 'range' ? index.byId.get(`metal:${l.linked.component_id}`) : null
    return {...l,linked:rec.cls === 'metal' ? {type:'range',component_id:rec.sku_id,label:rec.code} : null,
      ...(old && l.description?.trim() === old.name?.trim() ? {description:rec.name} : {})}
  })
}

// Read-only review. Only provably missing quantities on full legacy receipts
// can be added; over-receipts, partials and unknown movements need manual review.
export async function previewPoReceiptCorrection(poId) {
  const [snap,index] = await Promise.all([getDoc(doc(db,'purchase_orders',poId)),loadIndex()])
  if (!snap.exists() || !snap.data().stock_received) throw Error('This PO has no completed receipt to review.')
  const po = snap.data(),targets = recordedTargets(poId,po)
  const posted = await readPosted(getDoc,poId,po,targets)
  if (po.stock_receipt_version === 2) {
    const matches = matchPoLines(po,index); conflict(matches)
    for (const line of po.received_lines || []) {
      if (!line.source_lines?.length || line.source_lines.some(source=>!matches.items.some(it=>it.line_index===source.line_index && receiptKey(it)===receiptKey(line)))) throw Error('PO item matches changed after receipt. Manual review is required.')
      const total = posted.filter(p=>receiptKey(p.target) === receiptKey(line)).reduce((n,p)=>n+p.data.qty,0)
      if (total !== Number(line.qty)) throw Error('Receipt quantity differs from its ledger. Manual review is required.')
    }
    return {needed:false,items:po.received_lines || []}
  }
  const positive = (po.lines || []).map((l,line_index)=>({...l,line_index})).filter(l=>Number(l.qty)>0)
  if (positive.length !== (po.received_lines || []).length || positive.some((l,i)=>Number(l.qty)!==Number(po.received_lines[i].qty))) throw Error('Partial or changed PO quantities need manual receipt review.')
  const correctedLines = correctedPoLines(po,index),matched = matchPoLines({lines:correctedLines},index); conflict(matched)
  if (matched.unmatched.length) throw Error('Every received line must identify a stock item before correction.')
  const expected = groupReceiptLines(matched.items)
  for (const target of targets) if (!expected.some(l=>receiptKey(l)===receiptKey(target))) throw Error('Stock was posted to an extra item. Manual adjustment review is required.')
  const items = []
  for (const line of expected) {
    const actual = posted.filter(p=>receiptKey(p.target)===receiptKey(line)),already = actual.reduce((n,p)=>n+p.data.qty,0),delta = line.qty-already
    if (delta < 0) throw Error('Stock was over-received. Manual adjustment review is required.')
    const fresh = await getDoc(itemRef(line))
    if (!fresh.exists() || poCode(fresh.data().code)!==poCode(line.code)) throw Error('Stock identity changed. Review again.')
    const history = await getDocs(collection(db,RECEIVE_CLASS_PATH[line.cls],line.sku_id,'movements'))
    const known = new Set(actual.map(p=>p.id))
    if (history.docs.some(d=>(d.id.includes(poId) || String(d.data().note || '').includes(po.pu_number || poId)) && !known.has(d.id))) {
      throw Error('An unrecorded movement for this PO needs manual stock review.')
    }
    const newRef = movementRef(line,correctionId(poId,generation(po),line)),existing = await getDoc(newRef)
    if (existing.exists()) throw Error('An existing correction movement needs manual review.')
    items.push({...line,already,delta,stock:Number(fresh.data().stock_qty)||0,item_before:stockBaseline(fresh.data()),movement_ids:[...actual.map(p=>p.id),...(delta>0?[correctionId(poId,generation(po),line)]:[])]})
  }
  return {needed:true,po_id:poId,generation:generation(po),before:receiptBaseline(po),corrected_lines:correctedLines,items,posted:posted.map(p=>({target:p.target,id:p.id,data:p.data})),audit_key:`g${generation(po)}_v2`}
}

// Append missing movements and update PO matches/audit in the SAME transaction.
// The old red receipt is never rewritten, removed or posted a second time.
export async function applyPoReceiptCorrection(plan) {
  if (!plan?.needed || !plan.po_id || !plan.items?.length) throw Error('Review the receipt correction first.')
  const user = await authedUser()
  if (!user) throw Error('Please sign in.')
  const ref = doc(db,'purchase_orders',plan.po_id)
  return runTransaction(db,async tx=>{
    const snap = await tx.get(ref)
    if (!snap.exists()) throw Error('PO no longer exists.')
    const po = snap.data()
    if (!po.stock_received || generation(po)!==plan.generation || plan.audit_key!==`g${generation(po)}_v2`) throw Error('Receipt generation changed. Review the correction again.')
    const audit = po.receipt_corrections?.[plan.audit_key]
    if (audit && same(audit.before,plan.before) && same(audit.corrected_lines,plan.corrected_lines) && generation(po)===plan.generation && po.stock_received && same(po.lines,plan.corrected_lines)) return po.received_lines
    if (!same(receiptBaseline(po),plan.before)) throw Error('PO receipt changed. Review the correction again.')
    const index = inventoryIndex({metal:[],crystal:[],packaging:[]})
    const reads = await Promise.all(plan.items.map(async l=>({line:l,snap:await tx.get(itemRef(l)),newMovement:await tx.get(movementRef(l,correctionId(plan.po_id,plan.generation,l)))})))
    for (const r of reads) {
      if (!r.snap.exists() || !same(stockBaseline(r.snap.data()),r.line.item_before) || r.newMovement.exists()) throw Error('Stock changed since review. Review the correction again.')
      const rec = {...r.snap.data(),cls:r.line.cls,sku_id:r.line.sku_id,id:r.line.sku_id,stock:r.line.stock}
      index.byId.set(receiptKey(rec),rec);index.byCode.set(poCode(rec.code),[...(index.byCode.get(poCode(rec.code)) || []),rec])
    }
    const corrected = correctedPoLines(po,index),matched = matchPoLines({lines:corrected},index); conflict(matched)
    if (!same(corrected,plan.corrected_lines)) throw Error('PO details or item matches changed since review.')
    const expected = groupReceiptLines(matched.items)
    if (!same(expected,savedGroups(plan.items))) throw Error('Correction quantities or item matches changed.')
    const posted = await readPosted(r=>tx.get(r),plan.po_id,po,recordedTargets(plan.po_id,po))
    if (!same(posted.map(p=>({target:p.target,id:p.id,data:p.data})),plan.posted)) throw Error('Receipt movements changed. Review again.')
    for (const r of reads) {
      const actual = posted.filter(p=>receiptKey(p.target)===receiptKey(r.line)),amount = actual.reduce((n,p)=>n+p.data.qty,0)
      const ids = [...actual.map(p=>p.id),...(r.line.delta>0?[correctionId(plan.po_id,plan.generation,r.line)]:[])]
      if (r.line.already!==amount || r.line.delta!==r.line.qty-amount || r.line.delta<0 || !same(r.line.movement_ids,ids)) throw Error('Correction does not match the actual stock ledger.')
    }
    const received = plan.items.map(({cls,sku_id,code,qty,source_lines,movement_ids})=>({cls,sku_id,code,qty,source_lines,movement_ids}))
    for (const r of reads) if (r.line.delta>0) stageStockMovement(tx,RECEIVE_CLASS_PATH[r.line.cls],r.line.sku_id,r.snap.data(),{
      type:'receipt',qty:r.line.delta,note:`Reconciled PU receipt ${po.pu_number || plan.po_id}`,
    },movementRef(r.line,correctionId(plan.po_id,plan.generation,r.line)))
    const corrections = {...(po.receipt_corrections || {}),[plan.audit_key]:{at:serverTimestamp(),by:user.uid,before:plan.before,corrected_lines:plan.corrected_lines,received_lines:received}}
    tx.update(ref,{lines:plan.corrected_lines,linked_component_ids:[...new Set(plan.corrected_lines.map(l=>l.linked?.component_id).filter(Boolean))],received_lines:received,stock_receipt_version:2,receipt_corrections:corrections,updatedAt:serverTimestamp()})
    return received
  })
}
