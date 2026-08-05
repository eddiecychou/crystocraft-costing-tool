// Excel export for a single customer enquiry — replaces the old flat CSV.
//
// Two sheets, matching the format CuiLing asked for (2026-08):
//   • "Enquiry" — the item table WITH embedded product photos:
//       Product · Picture · Code · Type · Finish · Colour · Note · Qty ·
//       Unit Price · Line Total
//   • "Customer Information" — company / contact / email / date / currency /
//       message, so the enquiry header sits on its own sheet.
//
// ExcelJS and the image-fetch/CORS handling are exactly the proven approach in
// components/QuoteExport.jsx (Netlify /api/download-image proxy first, direct
// fetch as the local-dev fallback). ExcelJS is dynamically imported so its
// weight stays out of the Enquiries page bundle until someone actually exports.

// ── Brand theme (subset of QuoteExport's) ──────────────────────────────────
const B = {
  BLACK:    'FF1A1A1A',
  GOLD:     'FFC8A951',
  GRAY_DARK:'FF444444',
  GRAY_MID: 'FF888888',
  HEADER_BG:'FFE8E8E8',
  ROW_ALT:  'FFFAFAF8',
  BORDER:   'FFE0E0E0',
}
const FONT = 'Calibri Light'
const IMG_SIZE = 90        // px — embedded photo, square, same as the quote export

// Fetch an image and return { buffer, extension } for wb.addImage, or null.
// Proxy first (handles Firebase Storage CORS in production), direct fetch as
// the fallback for local dev.
async function fetchImage(url) {
  if (!url) return null
  try {
    let buf
    try {
      const res = await fetch(`/api/download-image?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error('proxy failed')
      buf = await res.arrayBuffer()
    } catch {
      const res = await fetch(url)
      buf = await res.arrayBuffer()
    }
    return { buffer: buf, extension: url.toLowerCase().includes('.png') ? 'png' : 'jpeg' }
  } catch {
    return null
  }
}

export async function exportEnquiryExcel(r) {
  const { default: ExcelJS } = await import('exceljs')

  const cur  = r.currency || r.base_currency || 'USD'
  const when = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : ''
  const items = r.items || []

  const wb = new ExcelJS.Workbook()

  // ── Sheet 1: Enquiry (items + photos) ─────────────────────────────────────
  const ws = wb.addWorksheet('Enquiry')
  ws.pageSetup = {
    paperSize: 9, orientation: 'landscape',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  }

  // Columns — order follows CuiLing's sample, with Note kept from the data.
  const COL = { PRODUCT: 1, PICTURE: 2, CODE: 3, TYPE: 4, FINISH: 5, COLOUR: 6, NOTE: 7, QTY: 8, UNIT: 9, TOTAL: 10 }
  const LAST = COL.TOTAL
  ws.getColumn(COL.PRODUCT).width = 24
  ws.getColumn(COL.PICTURE).width = 14
  ws.getColumn(COL.CODE).width    = 18
  ws.getColumn(COL.TYPE).width    = 11
  ws.getColumn(COL.FINISH).width  = 9
  ws.getColumn(COL.COLOUR).width  = 22
  ws.getColumn(COL.NOTE).width    = 24
  ws.getColumn(COL.QTY).width     = 7
  ws.getColumn(COL.UNIT).width    = 14
  ws.getColumn(COL.TOTAL).width   = 14

  // Header row.
  const HEADER_ROW = 1
  const headers = ['Product', 'Picture', 'Code', 'Type', 'Finish', 'Colour', 'Note', 'Qty', `Unit Price (${cur})`, `Line Total (${cur})`]
  const hr = ws.getRow(HEADER_ROW)
  hr.height = 22
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1)
    c.value = h
    c.font  = { name: FONT, bold: true, size: 9, color: { argb: B.GRAY_DARK } }
    c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: B.HEADER_BG } }
    c.alignment = { horizontal: i + 1 >= COL.QTY ? 'center' : 'left', vertical: 'middle', wrapText: true }
    c.border = { bottom: { style: 'thin', color: { argb: B.GRAY_MID } } }
  })

  const baseFont = (o = {}) => ({ name: FONT, size: 9, color: { argb: B.BLACK }, ...o })
  const PT_PER_PX = 0.75

  // Data rows.
  let row = HEADER_ROW + 1
  for (let i = 0; i < items.length; i++) {
    const it   = items[i]
    const qty  = Number(it.qty || 1)
    const unit = it.line_total != null && qty ? Number(it.line_total) / qty : null
    const rr   = ws.getRow(row)
    // Row tall enough to hold the square photo with a little breathing room.
    rr.height = Math.max(20, IMG_SIZE * PT_PER_PX + 8)

    rr.getCell(COL.PRODUCT).value = it.name || ''
    rr.getCell(COL.CODE).value    = it.code || ''
    rr.getCell(COL.TYPE).value    = it.type || ''
    rr.getCell(COL.FINISH).value  = it.finish || ''
    rr.getCell(COL.COLOUR).value  = it.color_name || it.color || ''
    rr.getCell(COL.NOTE).value    = it.note || ''
    rr.getCell(COL.QTY).value     = qty
    if (unit != null) { rr.getCell(COL.UNIT).value = unit; rr.getCell(COL.UNIT).numFmt = '#,##0.00' }
    if (it.line_total != null) { rr.getCell(COL.TOTAL).value = Number(it.line_total); rr.getCell(COL.TOTAL).numFmt = '#,##0.00' }

    for (let c = 1; c <= LAST; c++) {
      const cell = rr.getCell(c)
      cell.font = baseFont(c === COL.PRODUCT ? { bold: true } : {})
      cell.alignment = {
        vertical: 'middle', wrapText: true,
        horizontal: c === COL.QTY ? 'center' : (c === COL.UNIT || c === COL.TOTAL ? 'right' : 'left'),
      }
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: B.ROW_ALT } }
      cell.border = { bottom: { style: 'hair', color: { argb: B.BORDER } } }
    }

    // Embed the product photo, centred in the Picture cell.
    const img = await fetchImage(it.image)
    if (img) {
      try {
        const id = wb.addImage(img)
        // Picture col width 14 ≈ 103px actual; centre the 90px image horizontally.
        const colPx = 103
        const colOff = Math.max(0, (colPx - IMG_SIZE) / (2 * colPx))
        const rowPx  = rr.height / PT_PER_PX
        const rowOff = Math.max(0, (rowPx - IMG_SIZE) / 2) / rowPx
        ws.addImage(id, {
          tl:  { col: (COL.PICTURE - 1) + colOff, row: (row - 1) + rowOff },
          ext: { width: IMG_SIZE, height: IMG_SIZE },
          editAs: 'oneCell',
        })
      } catch { /* image failed — row just has no picture */ }
    }
    row++
  }

  // Estimated total row.
  if (r.estimated_total != null) {
    const tr = ws.getRow(row)
    tr.getCell(COL.UNIT).value = 'Estimated total'
    tr.getCell(COL.UNIT).font  = { name: FONT, bold: true, size: 9, color: { argb: B.GRAY_DARK } }
    tr.getCell(COL.UNIT).alignment = { horizontal: 'right', vertical: 'middle' }
    tr.getCell(COL.TOTAL).value = Number(r.estimated_total)
    tr.getCell(COL.TOTAL).numFmt = '#,##0.00'
    tr.getCell(COL.TOTAL).font  = { name: FONT, bold: true, size: 10, color: { argb: B.BLACK } }
    tr.getCell(COL.TOTAL).alignment = { horizontal: 'right', vertical: 'middle' }
    for (let c = 1; c <= LAST; c++) tr.getCell(c).border = { top: { style: 'medium', color: { argb: B.GOLD } } }
    tr.height = 18
  }

  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }]

  // ── Sheet 2: Customer Information ─────────────────────────────────────────
  const cs = wb.addWorksheet('Customer Information')
  cs.pageSetup = { paperSize: 9, orientation: 'portrait', margins: { left: 0.6, right: 0.6, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } }
  cs.getColumn(1).width = 14
  cs.getColumn(2).width = 60

  // Title.
  cs.mergeCells('A1:B1')
  const title = cs.getCell('A1')
  title.value = 'Enquiry'
  title.font  = { name: FONT, bold: true, size: 13, color: { argb: B.BLACK } }
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  cs.getRow(1).height = 24
  for (const c of ['A1', 'B1']) cs.getCell(c).border = { bottom: { style: 'medium', color: { argb: B.GOLD } } }

  const labelFont = { name: FONT, size: 9, color: { argb: B.GRAY_MID } }
  const valueFont = { name: FONT, size: 10, color: { argb: B.BLACK } }
  const info = [
    ['Company',  r.company_name || ''],
    ['Contact',  r.contact_name || ''],
    ['Email',    r.email || ''],
    ['Date',     when],
    ['Currency', cur],
    ['Message',  r.message || ''],
  ]
  let cr = 2
  for (const [label, value] of info) {
    const rowRef = cs.getRow(cr)
    rowRef.getCell(1).value = label
    rowRef.getCell(1).font  = labelFont
    rowRef.getCell(1).alignment = { vertical: 'top' }
    rowRef.getCell(2).value = String(value)
    rowRef.getCell(2).font  = valueFont
    rowRef.getCell(2).alignment = { vertical: 'top', wrapText: true }
    // Message row grows with its content.
    if (label === 'Message' && value) {
      const lines = String(value).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 60)), 0)
      rowRef.height = Math.max(16, lines * 14)
    } else {
      rowRef.height = 16
    }
    cr++
  }

  // ── Download ──────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const safe = (r.company_name || r.email || 'enquiry').replace(/[/\\?%*:|"<>]/g, '-').trim()
  const datePart = r.createdAt?.toDate ? r.createdAt.toDate().toISOString().slice(0, 10) : ''
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `Enquiry - ${safe}${datePart ? ` - ${datePart}` : ''}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}
