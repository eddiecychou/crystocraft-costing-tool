import { useState } from 'react'
import ExcelJS from 'exceljs'
import logoUrl from '../assets/logo.png'

// ── Brand theme (from crystocraft.com — black/white/gold, minimalist luxury) ──
const B = {
  BLACK:      'FF1A1A1A',
  WHITE:      'FFFFFFFF',
  GOLD:       'FFC8A951',
  GOLD_LIGHT: 'FFFDF6E3',
  GRAY_DARK:  'FF444444',
  GRAY_MID:   'FF888888',
  GRAY_LIGHT: 'FFF5F5F5',
  ROW_ALT:    'FFFAFAF8',
  BORDER:     'FFE0E0E0',
}

// Logo natural dimensions: 617 × 108 px → aspect ratio 5.713
const LOGO_W = 210
const LOGO_H = Math.round(LOGO_W / 5.713)   // ≈ 37px — correct aspect ratio

// Columns (1-indexed, no Subtotal)
// A=#  B=Photo  C=Product  D=Category  E=Description  F=Qty  G=Unit Price
const COL = { NUM: 1, PHOTO: 2, PRODUCT: 3, CATEGORY: 4, DESC: 5, QTY: 6, PRICE: 7 }
const LAST_COL_LETTER = 'G'
const TOTAL_COLS = 7

function cell(ws, addr) { return ws.getCell(addr) }

function applyFont(ws, addr, opts) {
  ws.getCell(addr).font = { name: 'Calibri Light', size: 9, color: { argb: B.GRAY_DARK }, ...opts }
}

export default function QuoteExport({ quote, items, onClose }) {
  const [loading, setLoading] = useState(false)

  async function exportExcel() {
    setLoading(true)
    try {
      const wb = new ExcelJS.Workbook()
      wb.creator = 'Crystocraft Costing Tool'
      const ws = wb.addWorksheet('Quotation')
      const cur = quote.quote_currency || 'HKD'

      // ── Page setup: A4 portrait, fit to 1 page wide ──────────────
      ws.pageSetup = {
        paperSize:    9,           // A4
        orientation:  'portrait',
        fitToPage:    true,
        fitToWidth:   1,
        fitToHeight:  0,           // let rows grow freely
        margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.8, header: 0.3, footer: 0.3 },
      }

      // ── Column widths (tuned to fit A4 portrait) ──────────────────
      ws.getColumn(COL.NUM).width      = 4
      ws.getColumn(COL.PHOTO).width    = 10
      ws.getColumn(COL.PRODUCT).width  = 20
      ws.getColumn(COL.CATEGORY).width = 13
      ws.getColumn(COL.DESC).width     = 28
      ws.getColumn(COL.QTY).width      = 9
      ws.getColumn(COL.PRICE).width    = 14

      // ── Row 1: Logo ───────────────────────────────────────────────
      ws.getRow(1).height = LOGO_H + 8
      try {
        const logoRes = await fetch(logoUrl)
        const logoBuf = await logoRes.arrayBuffer()
        const logoId  = wb.addImage({ buffer: logoBuf, extension: 'png' })
        ws.addImage(logoId, {
          tl:      { col: 0, row: 0 },
          ext:     { width: LOGO_W, height: LOGO_H },
          editAs:  'oneCell',
        })
      } catch {
        // Fallback text if image fails
        ws.getCell('A1').value = 'CRYSTOCRAFT'
        ws.getCell('A1').font  = { name: 'Calibri Light', bold: true, size: 16, color: { argb: B.BLACK } }
        ws.getCell('A1').alignment = { vertical: 'middle' }
      }

      // "QUOTATION" label — right-aligned in the same row
      ws.mergeCells(`E1:${LAST_COL_LETTER}1`)
      const titleCell = ws.getCell('E1')
      titleCell.value     = 'QUOTATION'
      titleCell.font      = { name: 'Calibri Light', size: 16, color: { argb: B.GOLD }, bold: false }
      titleCell.alignment = { horizontal: 'right', vertical: 'bottom' }

      // ── Thin gold rule under row 1 ────────────────────────────────
      ws.getRow(1).eachCell({ includeEmpty: true }, (c, colNum) => {
        if (colNum <= TOTAL_COLS) {
          c.border = { bottom: { style: 'medium', color: { argb: B.GOLD } } }
        }
      })

      // ── Rows 2–5: Header info block ───────────────────────────────
      ws.getRow(2).height = 6   // spacer

      // Left block
      ws.getRow(3).height = 14
      ws.getRow(4).height = 14
      ws.getRow(5).height = 14
      ws.getRow(6).height = 10  // spacer before table

      const setLabel = (addr, txt) => {
        cell(ws, addr).value = txt
        cell(ws, addr).font  = { name: 'Calibri Light', size: 8, color: { argb: B.GRAY_MID }, bold: false }
        cell(ws, addr).alignment = { vertical: 'middle' }
      }
      const setVal = (addr, txt) => {
        cell(ws, addr).value = txt
        cell(ws, addr).font  = { name: 'Calibri Light', size: 9, color: { argb: B.BLACK } }
        cell(ws, addr).alignment = { vertical: 'middle' }
      }

      setLabel('A3', 'TO')
      setVal('B3', quote.client_name || '')
      ws.mergeCells('B3:D3')

      setLabel('A4', 'CONTACT')
      setVal('B4', [quote.contact_name, quote.contact_email].filter(Boolean).join('   ·   '))
      ws.mergeCells('B4:D4')

      setLabel('A5', 'DATE')
      setVal('B5', quote.quote_date
        ? new Date(quote.quote_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))

      // Right block
      setLabel('F3', 'CURRENCY')
      setVal('G3', cur)
      cell(ws, 'G3').alignment = { vertical: 'middle', horizontal: 'right' }

      // ── Column header row (row 7) ─────────────────────────────────
      const hRow = ws.getRow(7)
      hRow.height = 22
      const headers = ['', '', 'PRODUCT', 'CATEGORY', 'DESCRIPTION', 'QTY', `UNIT PRICE (${cur})`]
      headers.forEach((h, i) => {
        const c = hRow.getCell(i + 1)
        c.value = h
        c.font  = { name: 'Calibri Light', bold: true, size: 8, color: { argb: B.WHITE } }
        c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: B.BLACK } }
        c.alignment = { horizontal: i >= 5 ? 'right' : (i === 0 ? 'center' : 'left'), vertical: 'middle' }
      })

      // ── Data rows (from row 8) ────────────────────────────────────
      let currentRow = 8

      for (let i = 0; i < items.length; i++) {
        const item  = items[i]
        const tiers = item.tiers?.length ? item.tiers : [{ quantity: 0, price: 0 }]
        const rowBg = i % 2 === 1 ? B.ROW_ALT : B.WHITE

        for (let t = 0; t < tiers.length; t++) {
          const tier    = tiers[t]
          const isFirst = t === 0
          const isLast  = t === tiers.length - 1
          const rowH    = isFirst ? 64 : 18

          const row = ws.getRow(currentRow)
          row.height = rowH

          // Values
          row.getCell(COL.NUM).value      = isFirst ? i + 1 : ''
          row.getCell(COL.PHOTO).value    = ''
          row.getCell(COL.PRODUCT).value  = isFirst ? item.product_name : ''
          row.getCell(COL.CATEGORY).value = isFirst ? item.product_category : ''
          row.getCell(COL.DESC).value     = isFirst ? (item.product_description || '') : ''
          row.getCell(COL.QTY).value      = tier.quantity ?? ''
          row.getCell(COL.PRICE).value    = tier.price ?? tier.price_hkd ?? ''

          // Alignment & font
          const baseFont = { name: 'Calibri Light', size: 9, color: { argb: B.BLACK } }
          row.getCell(COL.NUM).font       = { ...baseFont, size: 8, color: { argb: B.GRAY_MID } }
          row.getCell(COL.NUM).alignment  = { horizontal: 'center', vertical: 'top' }
          row.getCell(COL.PRODUCT).font   = { ...baseFont, bold: isFirst }
          row.getCell(COL.PRODUCT).alignment  = { vertical: 'top', wrapText: true }
          row.getCell(COL.CATEGORY).font  = { ...baseFont, size: 8, color: { argb: B.GRAY_MID } }
          row.getCell(COL.CATEGORY).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
          row.getCell(COL.DESC).font      = { ...baseFont, size: 8, color: { argb: B.GRAY_DARK } }
          row.getCell(COL.DESC).alignment = { vertical: 'top', wrapText: true }
          row.getCell(COL.QTY).font       = baseFont
          row.getCell(COL.QTY).alignment  = { horizontal: 'center', vertical: 'middle' }
          row.getCell(COL.PRICE).font     = { ...baseFont, bold: true }
          row.getCell(COL.PRICE).numFmt   = '#,##0.00'
          row.getCell(COL.PRICE).alignment = { horizontal: 'right', vertical: 'middle' }

          // Row background fill
          for (let c = 1; c <= TOTAL_COLS; c++) {
            if (rowBg !== B.WHITE) {
              row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } }
            }
          }

          // Bottom border — thin separator after last tier of each product
          if (isLast) {
            for (let c = 1; c <= TOTAL_COLS; c++) {
              row.getCell(c).border = { bottom: { style: 'hair', color: { argb: B.BORDER } } }
            }
          }

          // Embed product image (first tier only, in Photo column)
          if (isFirst) {
            const imgUrl = item.custom_image || item.hero_image
            if (imgUrl) {
              try {
                const res = await fetch(`/api/download-image?url=${encodeURIComponent(imgUrl)}`)
                const buf = await res.arrayBuffer()
                const imgId = wb.addImage({ buffer: buf, extension: 'jpeg' })
                ws.addImage(imgId, {
                  tl:     { col: COL.PHOTO - 1, row: currentRow - 1 },
                  ext:    { width: 58, height: 58 },
                  editAs: 'oneCell',
                })
              } catch {}
            }
          }

          currentRow++
        }
      }

      // ── Gold closing rule ─────────────────────────────────────────
      const closeRow = ws.getRow(currentRow)
      closeRow.height = 3
      for (let c = 1; c <= TOTAL_COLS; c++) {
        closeRow.getCell(c).border = { top: { style: 'medium', color: { argb: B.GOLD } } }
      }
      currentRow += 2

      // ── Notes ─────────────────────────────────────────────────────
      if (quote.notes) {
        ws.mergeCells(`A${currentRow}:${LAST_COL_LETTER}${currentRow}`)
        const notesCell = ws.getRow(currentRow).getCell(1)
        notesCell.value = `Notes: ${quote.notes}`
        notesCell.font  = { name: 'Calibri Light', size: 8, italic: true, color: { argb: B.GRAY_MID } }
        notesCell.alignment = { wrapText: true }
        ws.getRow(currentRow).height = 24
        currentRow += 2
      }

      // ── Terms line ────────────────────────────────────────────────
      ws.mergeCells(`A${currentRow}:${LAST_COL_LETTER}${currentRow}`)
      const termsCell = ws.getRow(currentRow).getCell(1)
      termsCell.value = `All prices quoted in ${cur}. Prices are for reference and subject to final confirmation. MOQ and lead times may vary.`
      termsCell.font  = { name: 'Calibri Light', size: 7.5, italic: true, color: { argb: B.GRAY_MID } }
      termsCell.alignment = { horizontal: 'center' }
      ws.getRow(currentRow).height = 12
      currentRow += 2

      // ── Company footer ────────────────────────────────────────────
      const footerData = [
        { text: 'United Art Metals Factory Limited', bold: true },
        { text: '11A Seabright Plaza, 9-23 Shell Road, Causeway Bay, Hong Kong', bold: false },
        { text: 'WhatsApp: +852 4608 3219   |   Email: sales@uart.com.hk', bold: false },
      ]
      for (const line of footerData) {
        ws.mergeCells(`A${currentRow}:${LAST_COL_LETTER}${currentRow}`)
        const fc = ws.getRow(currentRow).getCell(1)
        fc.value = line.text
        fc.font  = { name: 'Calibri Light', size: 7.5, bold: line.bold, color: { argb: B.GRAY_DARK } }
        fc.alignment = { horizontal: 'center' }
        ws.getRow(currentRow).height = 12
        currentRow++
      }

      // ── Download ──────────────────────────────────────────────────
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `Quotation_${quote.client_name}_${quote.quote_date || new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)

    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold text-gray-900 mb-1">Export Quote</h2>
        <p className="text-sm text-gray-500 mb-6">
          Download a professional quotation for <span className="font-medium">{quote.client_name}</span>.
        </p>
        <div className="space-y-3">
          <button className="btn-primary w-full justify-center" onClick={exportExcel} disabled={loading}>
            {loading ? 'Generating…' : '⬇ Download Excel (.xlsx)'}
          </button>
          <button className="btn-secondary w-full justify-center" disabled>
            ⬇ Download PDF <span className="text-xs opacity-60 ml-1">(coming in V2)</span>
          </button>
        </div>
        <button className="mt-4 text-xs text-gray-400 hover:text-gray-600 w-full text-center" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
