import ExcelJS from 'exceljs'
import { PO_PAYMENT_TERM_LABEL } from './constants'
import { pdfFileTitle } from './pdfFilename'
import { poTotals, lineAmount, adjustmentValue } from './purchaseOrders'
import { derivedCbm, effectiveGw, palletisedTotals, isPalletised, palletWeight } from './packing'
import { packingQuantityLines, quantityUnitTotals } from './packingUnits'

async function download(wb, name) {
  const buffer = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
  const a = document.createElement('a'); a.href=url; a.download=`${pdfFileTitle([name])}.xlsx`; a.click(); URL.revokeObjectURL(url)
}
function sheet(wb, name, widths) {
  const ws=wb.addWorksheet(name)
  widths.forEach((w,i)=>{ws.getColumn(i+1).width=w})
  ws.pageSetup={paperSize:9,orientation:name==='Packing List'?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0}
  return ws
}
export function downloadPurchaseOrderExcel(po, L) {
  const wb=new ExcelJS.Workbook(), ws=sheet(wb,'Purchase Order',[22,44,14,14,20,22])
  const totals=poTotals(po)
  for(const row of [[L.title,po.pu_number || ''],[L.supplier,po.supplier_name || '',po.supplier_name_cn || ''],
    [L.attn,po.supplier_contact || ''],['Address',po.supplier_address || ''],[L.issued,po.issued_date || ''],
    [L.estShip,po.est_ship_date || ''],[L.currency,po.currency || 'RMB'],[L.shipTo,po.ship_to || ''],
    [L.terms,[PO_PAYMENT_TERM_LABEL[po.payment_terms],po.payment_terms_custom].filter(Boolean).join(' · ')]]) ws.addRow(row)
  ws.addRow([])
  ws.addRow([L.itemCode,L.description,L.qty,L.unit,L.unitPrice,L.amount]).font={bold:true}
  for(const l of po.lines || []) {
    const r=ws.addRow([l.code || '',l.description || '',Number(l.qty) || 0,l.unit || 'pcs',Number(l.unit_price) || 0,lineAmount(l)])
    r.getCell(5).numFmt='#,##0.00';r.getCell(6).numFmt='#,##0.00'
  }
  ws.addRow([])
  for(const t of quantityUnitTotals(po.lines || []))ws.addRow(['',L.totalQty,t.qty,t.unit])
  const summary=[[L.subtotal,totals.subtotal],...(po.adjustments || []).map(a=>[a.label || (a.kind==='discount'?L.discount:L.addCharge),adjustmentValue(a)]),[L.orderTotal,totals.grandTotal],[L.deposit,totals.deposit],[L.balanceDue,totals.balance]]
  for(const [label,value] of summary){const r=ws.addRow(['','','','',label,value]);r.getCell(6).numFmt='#,##0.00'}
  if(po.remarks)ws.addRow([L.remarks,po.remarks])
  return download(wb,po.pu_number || 'Purchase Order')
}
export function downloadPackingExcel(pl, order, cartons) {
  const wb=new ExcelJS.Workbook(), ws=sheet(wb,'Packing List',[10,14,22,38,14,12,14,14,16,16,24,16,16,16,16,22])
  ws.addRow(['PACKING LIST',order?.erp_so_no || ''])
  ws.addRow(['Consignee',pl.consignee_name || order?.customer_name || ''])
  ws.addRow(['Ref No',order?.uc_no || order?.erp_pi_no || ''])
  ws.addRow(['Customer PO',order?.customer_po || ''])
  ws.addRow(['Case Mark',pl.case_mark || '']);ws.addRow(['Shipped Per',pl.shipped_per || '']);
  ws.addRow(['Date',pl.pl_date?.toDate?.() || pl.pl_date || '']);ws.addRow([])
  ws.addRow(['Pallet','Carton No','Item Code','Description','Qty/Ctn','Unit','Carton Count','Total Qty','GW/Ctn (kg)','Total GW (kg)','Dimensions (cm)','CBM/Ctn','Total CBM','NW/Ctn (kg)','Total NW (kg)','Pack Code']).font={bold:true}
  for(const c of cartons) {
    const count=parseInt(c.carton_count) || 1, seq=parseInt(c.carton_seq) || 1
    for(const [i,item] of (c.contents?.length?c.contents:[{}]).entries()) {
      const first=i===0, qty=Number(item.qty) || 0
      ws.addRow([c.pallet_no || 1,first?(count>1?`${seq}–${seq+count-1}`:seq):'',item.item_code || '',item.description || '',qty,item.qty == null && !item.item_code && !item.description ? '' : item.unit || 'unit not set',first?count:null,qty*count,
        first?effectiveGw(c):null,first?effectiveGw(c)*count:null,first?[c.length_cm,c.width_cm,c.height_cm].join(' × '):'',
        first?derivedCbm(c):null,first?(derivedCbm(c) || 0)*count:null,first?Number(c.nw_kg) || 0:null,first?(Number(c.nw_kg) || 0)*count:null,first?c.packaging_code || '':''])
    }
  }
  ws.addRow([])
  for(const t of quantityUnitTotals(packingQuantityLines(cartons)))ws.addRow(['','','','Total Qty',null,t.unit,null,t.qty])
  const totals=palletisedTotals(cartons,pl.pallets || [])
  ws.addRow(['Total Cartons',cartons.reduce((s,c)=>s+(parseInt(c.carton_count) || 1),0)])
  for(const [label,value] of [['Carton GW (kg)',totals.cartonGw],['Carton CBM',totals.cartonCbm],['Shipping GW (kg)',totals.totalGw],['Shipping CBM',totals.totalCbm]])ws.addRow([label,value])
  if(pl.pallets?.length){
    ws.addRow([]);ws.addRow(['Pallet','Length (m)','Width (m)','Height (m)','Pallet weight (kg)'])
    for(const p of pl.pallets)ws.addRow([p.pallet_no,p.length_m,p.width_m,p.height_m,isPalletised(p) ? palletWeight(p) : 0])
  }
  return download(wb,`Packing List - ${order?.erp_so_no || pl.id || 'export'}`)
}
