// Pure PO inventory identity rules, shared by previews and committed receipts.
export const RECEIVE_CLASS_PATH = {metal:'range_components', crystal:'crystals', packaging:'packaging'}
export const poCode = value => String(value ?? '').trim().toUpperCase()
export const receiptKey = line => `${line.cls}:${line.sku_id}`
export const legacyReceiptId = (poId, generation, id) => `po_receive_${poId}_g${generation}_${id}`
export const receiptId = (poId, generation, line) => `po_receive_v2_${poId}_g${generation}_${line.cls}_${line.sku_id}`
export const correctionId = (poId, generation, line) => `po_reconcile_${poId}_g${generation}_${line.cls}_${line.sku_id}_v2`

export function inventoryIndex(groups) {
  const byCode = new Map(), byId = new Map()
  for (const [cls, rows] of Object.entries(groups)) for (const row of rows || []) {
    const rec = {...row, cls, sku_id:row.id, code:row.code || '', stock:Number(row.stock_qty) || 0}
    byId.set(receiptKey(rec), rec)
    const code = poCode(rec.code)
    if (code) byCode.set(code, [...(byCode.get(code) || []), rec])
  }
  return {byCode, byId}
}

export function matchPoLines(po, index) {
  const items = [], unmatched = [], conflicts = []
  for (const [line_index, line] of (po.lines || []).entries()) {
    const qty = Number(line.qty)
    if (!Number.isFinite(qty) || qty <= 0) continue
    const code = poCode(line.code)
    const linked = line.linked?.type === 'range' && line.linked.component_id
      ? index.byId.get(`metal:${line.linked.component_id}`) : null
    const candidates = index.byCode.get(code) || []
    let rec = null, reason = ''
    if (line.linked?.type === 'range' && !linked) reason = 'Linked stock item no longer exists.'
    else if (linked && code && poCode(linked.code) !== code) reason = `Item code ${line.code} conflicts with linked stock item ${linked.code}.`
    else if (linked) rec = linked
    else if (candidates.length === 1) rec = candidates[0]
    else if (candidates.length > 1) reason = `Item code ${line.code} matches more than one stock item. Select its component explicitly.`
    if (reason) conflicts.push({line_index,code:line.code || '',reason})
    else if (rec) items.push({cls:rec.cls,sku_id:rec.sku_id,code:rec.code,name:rec.name || '',qty,stock:rec.stock,line_index})
    else unmatched.push({line_index,code:line.code || '(no code)',description:line.description || '',qty})
  }
  return {items,unmatched,conflicts,source_lines:po.lines || []}
}

export function groupReceiptLines(lines) {
  const grouped = new Map(), seen = new Set()
  for (const line of lines || []) {
    if (!RECEIVE_CLASS_PATH[line.cls] || !line.sku_id || !Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0) throw Error('Invalid receipt item or quantity.')
    if (!Number.isInteger(line.line_index) || line.line_index < 0 || seen.has(line.line_index)) throw Error('Receipt source lines are missing or duplicated. Reload this PO.')
    seen.add(line.line_index)
    const key = receiptKey(line), group = grouped.get(key) || {cls:line.cls,sku_id:line.sku_id,code:line.code,qty:0,source_lines:[]}
    if (poCode(group.code) !== poCode(line.code)) throw Error('Conflicting codes for the same stock item.')
    group.qty += Number(line.qty)
    if (!Number.isFinite(group.qty)) throw Error('Receipt quantity is too large.')
    group.source_lines.push({line_index:line.line_index,code:line.code,qty:Number(line.qty)})
    grouped.set(key, group)
  }
  if (!grouped.size) throw Error('Nothing to receive — no lines matched an inventory item.')
  if (grouped.size > 100) throw Error('Receive at most 100 different stock items in one PO.')
  return [...grouped.values()].map(g=>({...g,source_lines:g.source_lines.sort((a,b)=>a.line_index-b.line_index)})).sort((a,b)=>a.source_lines[0].line_index-b.source_lines[0].line_index)
}

// Stock-relevant identity only: commercial descriptions/prices remain editable.
export const poStockIdentity = lines => (lines || []).map(l=>({code:poCode(l.code),qty:Number(l.qty) || 0,linked:l.linked || null}))

export function poCodeChange(line, code, components) {
  const matches = components.filter(c=>poCode(c.code) === poCode(code) && poCode(code))
  const previous = components.find(c=>line.linked?.type === 'range' && c.id === line.linked.component_id)
    || components.find(c=>poCode(c.code) === poCode(line.code) && poCode(line.code))
  const match = matches.length === 1 ? matches[0] : null
  if (poCode(code) === poCode(line.code)) return {code}
  const automaticDescription = !line.description?.trim() || (previous && line.description.trim() === previous.name?.trim())
  return {code,linked:match ? {type:'range',component_id:match.id,label:match.code} : null,
    ...(automaticDescription ? {description:match?.name || ''} : {})}
}
