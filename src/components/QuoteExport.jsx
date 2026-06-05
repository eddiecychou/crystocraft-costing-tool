import { useState } from 'react'
import ExcelJS from 'exceljs'
import logoUrl from '../assets/logo.png'

// ── Brand theme ───────────────────────────────────────────────────────────────
const B = {
  BLACK:     'FF1A1A1A',
  WHITE:     'FFFFFFFF',
  GOLD:      'FFC8A951',
  GRAY_DARK: 'FF444444',
  GRAY_MID:  'FF888888',
  GRAY_LIGHT:'FFF5F5F5',
  ROW_ALT:   'FFFAFAF8',
  BORDER:    'FFE0E0E0',
}

// Logo: 617 × 108 px → aspect 5.713
const LOGO_W = 210
const LOGO_H = Math.round(LOGO_W / 5.713)  // 37 px

// Columns (no Category): A=# · B=Photo · C=Product · D=Description · E=Qty · F=Unit Price
const COL = { NUM: 1, PHOTO: 2, PRODUCT: 3, DESC: 4, QTY: 5, PRICE: 6 }
const LAST_COL   = 'F'
const TOTAL_COLS = 6

const baseFont = (opts = {}) => ({ name: 'Calibri Light', size: 9, color: { argb: B.BLACK }, ...opts })

export default function QuoteExport({ quote, items, onClose }) {
  const [loading, setLoading] = useState(false)

  async function exportExcel() {
    setLoading(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Quotation')
      const cur = quote.quote_currency || 'HKD'

      // ── A4 portrait, fit to 1 page wide ────────────────────────────────────
      ws.pageSetup = {
        paperSize: 9, orientation: 'portrait',
        fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.8, header: 0.3, footer: 0.3 },
      }

      // ── Column widths ───────────────────────────────────────────────────────
      ws.getColumn(COL.NUM).width     = 4
      ws.getColumn(COL.PHOTO).width   = 14    // wider without Category column
      ws.getColumn(COL.PRODUCT).width = 22
      ws.getColumn(COL.DESC).width    = 36
      ws.getColumn(COL.QTY).width     = 10
      ws.getColumn(COL.PRICE).width   = 15

      // ── Row 1: Logo + "QUOTATION" ───────────────────────────────────────────
      ws.getRow(1).height = LOGO_H + 10
      try {
        const logoRes = await fetch(logoUrl)
        const logoBuf = await logoRes.arrayBuffer()
        const logoId  = wb.addImage({ buffer: logoBuf, extension: 'png' })
        ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: LOGO_W, height: LOGO_H }, editAs: 'oneCell' })
      } catch {
        const c = ws.getCell('A1')
        c.value = 'CRYSTOCRAFT'
        c.font  = baseFont({ bold: true, size: 16, color: { argb: B.BLACK } })
      }
      ws.mergeCells(`D1:${LAST_COL}1`)
      const titleCell = ws.getCell('D1')
      titleCell.value     = 'QUOTATION'
      titleCell.font      = { name: 'Calibri Light', size: 15, color: { argb: B.GOLD } }
      titleCell.alignment = { horizontal: 'right', vertical: 'bottom' }

      // Gold rule under row 1
      for (let c = 1; c <= TOTAL_COLS; c++) {
        ws.getRow(1).getCell(c).border = { bottom: { style: 'medium', color: { argb: B.GOLD } } }
      }

      // ── Rows 2–8: Client info block ─────────────────────────────────────────
      // Strategy: merge A:D for each info row so the narrow col A doesn't clip text.
      // Labels are embedded as small gray prefix text (rich text).
      ws.getRow(2).height = 7  // spacer

      function infoRow(rowNum, labelText, valueText, height = 14) {
        ws.getRow(rowNum).height = height
        ws.mergeCells(`A${rowNum}:D${rowNum}`)
        if (!valueText) return
        ws.getRow(rowNum).getCell(1).value = {
          richText: [
            { text: `${labelText}  `, font: { name: 'Calibri Light', size: 7.5, color: { argb: B.GRAY_MID } } },
            { text: valueText,        font: { name: 'Calibri Light', size: 9,   color: { argb: B.BLACK } } },
          ],
        }
        ws.getRow(rowNum).getCell(1).alignment = { vertical: 'middle' }
      }

      infoRow(3, 'TO', quote.client_name || '')

      const contactVal = [quote.contact_name, quote.contact_email].filter(Boolean).join('   ·   ')
      infoRow(4, 'CONTACT', contactVal)

      let nextInfoRow = 5
      if (quote.contact_phone) {
        infoRow(nextInfoRow, 'PHONE', quote.contact_phone)
        nextInfoRow++
      }
      if (quote.contact_address) {
        infoRow(nextInfoRow, 'ADDRESS', quote.contact_address, 18)
        nextInfoRow++
      }

      ws.getRow(7).height = 7  // spacer before table (used only if address not there)

      // Right side: Date + Currency — merged D:F, right-aligned
      ;[
        [3, 'DATE', quote.quote_date
          ? new Date(quote.quote_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
          : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })],
        [4, 'CURRENCY', cur],
      ].forEach(([r, label, value]) => {
        ws.mergeCells(`E${r}:${LAST_COL}${r}`)
        ws.getRow(r).getCell(COL.QTY).value = {
          richText: [
            { text: `${label}  `, font: { name: 'Calibri Light', size: 7.5, color: { argb: B.GRAY_MID } } },
            { text: value,        font: { name: 'Calibri Light', size: 9,   color: { argb: B.BLACK } } },
          ],
        }
        ws.getRow(r).getCell(COL.QTY).alignment = { horizontal: 'right', vertical: 'middle' }
      })

      // ── Column header row (row 8) ───────────────────────────────────────────
      const HEADER_ROW = 8
      ws.getRow(HEADER_ROW).height = 22
      const headers = ['', '', 'PRODUCT', 'DESCRIPTION', 'QTY', `UNIT PRICE (${cur})`]
      headers.forEach((h, i) => {
        const c = ws.getRow(HEADER_ROW).getCell(i + 1)
        c.value = h
        c.font  = { name: 'Calibri Light', bold: true, size: 8, color: { argb: B.WHITE } }
        c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: B.BLACK } }
        c.alignment = {
          horizontal: (i === 4) ? 'center' : (i >= 5 ? 'right' : (i <= 1 ? 'center' : 'left')),
          vertical: 'middle',
        }
      })

      // ── Data rows ───────────────────────────────────────────────────────────
      let currentRow = HEADER_ROW + 1

      for (let i = 0; i < items.length; i++) {
        const item     = items[i]
        const tiers    = item.tiers?.length ? item.tiers : [{ quantity: 0, price: 0 }]
        const rowBg    = i % 2 === 1 ? B.ROW_ALT : B.WHITE
        const firstRow = currentRow
        const lastRow  = currentRow + tiers.length - 1

        for (let t = 0; t < tiers.length; t++) {
          const tier  = tiers[t]
          const row   = ws.getRow(currentRow)
          row.height  = t === 0 ? 68 : 20

          // # and Photo only on first tier row
          if (t === 0) {
            row.getCell(COL.NUM).value     = i + 1
            row.getCell(COL.NUM).font      = baseFont({ size: 8, color: { argb: B.GRAY_MID } })
            row.getCell(COL.NUM).alignment = { horizontal: 'center', vertical: 'top' }
          }

          // Qty & Price on every tier row
          row.getCell(COL.QTY).value      = tier.quantity ?? ''
          row.getCell(COL.QTY).font       = baseFont()
          row.getCell(COL.QTY).alignment  = { horizontal: 'center', vertical: 'middle' }
          row.getCell(COL.PRICE).value    = tier.price ?? tier.price_hkd ?? ''
          row.getCell(COL.PRICE).font     = baseFont({ bold: true })
          row.getCell(COL.PRICE).numFmt   = '#,##0.00'
          row.getCell(COL.PRICE).alignment = { horizontal: 'right', vertical: 'middle' }

          // Background fill
          if (rowBg !== B.WHITE) {
            for (let c = 1; c <= TOTAL_COLS; c++) {
              row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } }
            }
          }

          // Bottom border after last tier of each product
          if (t === tiers.length - 1) {
            for (let c = 1; c <= TOTAL_COLS; c++) {
              row.getCell(c).border = { bottom: { style: 'hair', color: { argb: B.BORDER } } }
            }
          }

          currentRow++
        }

        // ── Merge Product cell across all tier rows ─────────────────
        if (tiers.length > 1) {
          ws.mergeCells(firstRow, COL.PRODUCT, lastRow, COL.PRODUCT)
          ws.mergeCells(firstRow, COL.DESC,    lastRow, COL.DESC)
        }
        // Product name & Description values go on the first row of the merge
        ws.getRow(firstRow).getCell(COL.PRODUCT).value     = item.product_name || ''
        ws.getRow(firstRow).getCell(COL.PRODUCT).font      = baseFont({ bold: true })
        ws.getRow(firstRow).getCell(COL.PRODUCT).alignment = { vertical: 'middle', wrapText: true }

        ws.getRow(firstRow).getCell(COL.DESC).value     = item.product_description || ''
        ws.getRow(firstRow).getCell(COL.DESC).font      = baseFont({ size: 8, color: { argb: B.GRAY_DARK } })
        ws.getRow(firstRow).getCell(COL.DESC).alignment = { vertical: 'middle', wrapText: true }

        // ── Embed product image (Photo column, first tier row) ──────
        const imgUrl = item.custom_image || item.hero_image
        if (imgUrl) {
          try {
            const res   = await fetch(`/api/download-image?url=${encodeURIComponent(imgUrl)}`)
            const buf   = await res.arrayBuffer()
            const imgId = wb.addImage({ buffer: buf, extension: 'jpeg' })
            ws.addImage(imgId, {
              tl:     { col: COL.PHOTO - 1, row: firstRow - 1 },
              ext:    { width: 66, height: 62 },
              editAs: 'oneCell',
            })
          } catch {}
        }
      }

      // ── Gold closing rule ───────────────────────────────────────────────────
      for (let c = 1; c <= TOTAL_COLS; c++) {
        ws.getRow(currentRow).getCell(c).border = { top: { style: 'medium', color: { argb: B.GOLD } } }
      }
      ws.getRow(currentRow).height = 3
      currentRow += 2

      // ── Notes ───────────────────────────────────────────────────────────────
      if (quote.notes) {
        ws.mergeCells(`A${currentRow}:${LAST_COL}${currentRow}`)
        ws.getRow(currentRow).getCell(1).value = {
          richText: [
            { text: 'Notes  ', font: { name: 'Calibri Light', size: 8, color: { argb: B.GRAY_MID } } },
            { text: quote.notes, font: { name: 'Calibri Light', size: 8, color: { argb: B.GRAY_DARK } } },
          ],
        }
        ws.getRow(currentRow).getCell(1).alignment = { wrapText: true }
        ws.getRow(currentRow).height = 28
        currentRow += 2
      }

      // ── Terms ───────────────────────────────────────────────────────────────
      ws.mergeCells(`A${currentRow}:${LAST_COL}${currentRow}`)
      ws.getRow(currentRow).getCell(1).value = `All prices in ${cur}. For reference only — subject to final confirmation. MOQ and lead times may vary.`
      ws.getRow(currentRow).getCell(1).font  = { name: 'Calibri Light', size: 7.5, italic: true, color: { argb: B.GRAY_MID } }
      ws.getRow(currentRow).getCell(1).alignment = { horizontal: 'center' }
      ws.getRow(currentRow).height = 12
      currentRow += 2

      // ── Company footer ──────────────────────────────────────────────────────
      for (const [text, bold] of [
        ['United Art Metals Factory Limited', true],
        ['11A Seabright Plaza, 9-23 Shell Road, Causeway Bay, Hong Kong', false],
        ['WhatsApp: +852 4608 3219   |   Email: sales@uart.com.hk', false],
      ]) {
        ws.mergeCells(`A${currentRow}:${LAST_COL}${currentRow}`)
        ws.getRow(currentRow).getCell(1).value = text
        ws.getRow(currentRow).getCell(1).font  = { name: 'Calibri Light', size: 7.5, bold, color: { argb: B.GRAY_DARK } }
        ws.getRow(currentRow).getCell(1).alignment = { horizontal: 'center' }
        ws.getRow(currentRow).height = 12
        currentRow++
      }

      // ── Download ────────────────────────────────────────────────────────────
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
