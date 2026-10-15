import ExcelJS from 'exceljs'
import { pdfFileTitle } from './pdfFilename'

// Customer-facing fields only. Charges have an amount but no quantity/unit.
export function orderInvoiceLines(lines) {
  return lines.filter(l => Number(l.qty_ordered) > 0 || Number(l.unit_price) !== 0 && Number.isFinite(Number(l.unit_price)))
    .map(l => {
      const qty = Number(l.qty_ordered) || 0
      const price = Number(l.unit_price) || 0
      return { item_code:l.item_code, description:l.description, qty:qty > 0 ? qty : null,
        unit:qty > 0 ? (l.unit || 'pcs') : '', unit_price:qty > 0 ? price : null,
        amount:qty > 0 ? qty * price : price }
    })
}

export async function downloadInvoiceExcel({ title='Invoice', number, uc, date, currency, lines, summary }) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Invoice')
  ws.addRow([title, number || ''])
  ws.addRow(['UC#', uc || ''])
  ws.addRow(['Date', date || ''])
  ws.addRow(['Currency', currency || 'USD'])
  ws.addRow([])
  ws.addRow(['Item Code','Description','Qty','Unit','Unit Price','Amount']).font={bold:true}
  lines.forEach(l => {
    const row=ws.addRow([l.item_code || '',l.description || '',l.qty == null ? null : Number(l.qty),
      l.qty > 0 ? (l.unit || '') : '',l.unit_price == null ? null : Number(l.unit_price),Number(l.amount) || 0])
    row.getCell(5).numFmt='#,##0.00';row.getCell(6).numFmt='#,##0.00'
  })
  ws.addRow([])
  for(const [label,value] of summary || []) {
    const row=ws.addRow(['','','','',label,Number(value) || 0]);row.font={bold:true};row.getCell(6).numFmt='#,##0.00'
  }
  ws.columns.forEach((c,i)=>{c.width=[22,50,12,12,20,22][i]})
  ws.pageSetup={paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0}
  const buffer=await wb.xlsx.writeBuffer()
  const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
  const a=document.createElement('a');a.href=url;a.download=`${pdfFileTitle([number || title,uc || null])}.xlsx`;a.click();URL.revokeObjectURL(url)
}

export function downloadOrderInvoiceExcel(order, lines, kind, totals) {
  const sales=kind === 'sales'
  const summary=[['Subtotal',totals.subtotal]]
  if(totals.discountAmount)summary.push(['Discount',-totals.discountAmount])
  if(totals.chargesTotal)summary.push(['Charges',totals.chargesTotal])
  summary.push(['Total',totals.total])
  if(sales && order.adjustment){summary.push(['Adjustment',order.adjustment],['Amount Payable',order.accounting_total ?? totals.total])}
  return downloadInvoiceExcel({title:sales?'Sales Invoice':'Proforma Invoice',
    number:sales?order.erp_si_no:order.erp_so_no,uc:order.uc_no || order.erp_pi_no,
    date:(sales ? order.invoice_date || order.invoiced_at : null) || order.order_date,
    currency:order.currency,lines:orderInvoiceLines(lines),summary})
}
