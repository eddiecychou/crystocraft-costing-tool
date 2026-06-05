import { useState } from 'react'
import ExcelJS from 'exceljs'
import logoUrl from '../assets/logo.png'

// Column layout (1-indexed):
// A(1)=# | B(2)=Photo | C(3)=Product | D(4)=Category | E(5)=Description | F(6)=Qty | G(7)=Unit Price | H(8)=Subtotal

const COL = { NUM: 1, PHOTO: 2, PRODUCT: 3, CATEGORY: 4, DESC: 5, QTY: 6, PRICE: 7, SUBTOTAL: 8 }
const BRAND = 'FF2D5BE3'
const BRAND_LIGHT = 'FFE8EEFB'
const GRAY = 'FF666666'
const WHITE = 'FFFFFFFF'

function labelCell(ws, addr, value) {
  ws.getCell(addr).value = value
  ws.getCell(addr).font = { bold: true, color: { argb: GRAY }, size: 9 }
}

function valueCell(ws, addr, value) {
  ws.getCell(addr).value = value
  ws.getCell(addr).font = { size: 9, color: { argb: '333333' } }
}

export default function QuoteExport({ quote, items, onClose }) {
  const [loading, setLoading] = useState(false)

  async function exportExcel() {
    setLoading(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Quotation')
      const cur = quote.quote_currency || 'HKD'

      // ── Column widths ──────────────────────────────────────────────
      ws.getColumn(COL.NUM).width      = 5
      ws.getColumn(COL.PHOTO).width    = 12
      ws.getColumn(COL.PRODUCT).width  = 26
      ws.getColumn(COL.CATEGORY).width = 16
      ws.getColumn(COL.DESC).width     = 38
      ws.getColumn(COL.QTY).width      = 12
      ws.getColumn(COL.PRICE).width    = 16
      ws.getColumn(COL.SUBTOTAL).width = 16

      // ── Logo (row 1, col A–B) ──────────────────────────────────────
      let logoEmbedded = false
      try {
        const logoRes = await fetch(logoUrl)
        const logoBuffer = await logoRes.arrayBuffer()
        const logoId = wb.addImage({ buffer: logoBuffer, extension: 'png' })
        ws.addImage(logoId, {
          tl: { col: 0, row: 0 },
          ext: { width: 180, height: 38 },
          editAs: 'oneCell',
        })
        logoEmbedded = true
      } catch {}

      // Row 1: logo row (tall)
      ws.getRow(1).height = 36
      if (!logoEmbedded) {
        ws.mergeCells('A1:B1')
        ws.getCell('A1').value = 'CRYSTOCRAFT'
        ws.getCell('A1').font = { bold: true, size: 13, color: { argb: BRAND } }
        ws.getCell('A1').alignment = { vertical: 'middle' }
      }
      // Title on the right
      ws.mergeCells('E1:H1')
      ws.getCell('E1').value = 'CORPORATE GIFT QUOTATION'
      ws.getCell('E1').font = { bold: true, size: 13, color: { argb: BRAND } }
      ws.getCell('E1').alignment = { horizontal: 'right', vertical: 'middle' }

      // ── Header info (rows 3–5) ─────────────────────────────────────
      ws.getRow(2).height = 6

      labelCell(ws, 'A3', 'Client:')
      valueCell(ws, 'B3', quote.client_name)
      ws.mergeCells('B3:D3')

      labelCell(ws, 'A4', 'Contact:')
      valueCell(ws, 'B4', [quote.contact_name, quote.contact_email, quote.contact_phone].filter(Boolean).join('  ·  '))
      ws.mergeCells('B4:D4')

      labelCell(ws, 'A5', 'Date:')
      valueCell(ws, 'B5', quote.quote_date
        ? new Date(quote.quote_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))

      labelCell(ws, 'F3', 'Currency:')
      valueCell(ws, 'G3', cur)
      ws.mergeCells('G3:H3')

      ws.getRow(3).height = 16
      ws.getRow(4).height = 16
      ws.getRow(5).height = 16
      ws.getRow(6).height = 8

      // ── Thin divider line under header ────────────────────────────
      ;['A3','B3','A4','B4','A5','B5','F3','G3'].forEach(addr => {
        ws.getCell(addr).alignment = { vertical: 'middle' }
      })

      // ── Column header row (row 7) ──────────────────────────────────
      // Force the worksheet row pointer past row 6
      for (let r = 1; r <= 6; r++) ws.getRow(r).commit?.()

      const hRow = ws.getRow(7)
      hRow.values = ['#', 'Photo', 'Product', 'Category', 'Description', 'Qty', `Unit Price (${cur})`, `Subtotal (${cur})`]
      hRow.height = 20
      hRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: WHITE }, size: 9 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false }
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFB0C4F0' } } }
      })

      // ── Data rows (from row 8 onwards) ────────────────────────────
      let currentRow = 8
      let firstDataRow = 8
      let lastDataRow = 8

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const tiers = item.tiers?.length ? item.tiers : [{ quantity: 0, price: 0 }]
        const isEven = i % 2 === 0
        const rowFill = isEven ? null : { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } }

        for (let t = 0; t < tiers.length; t++) {
          const tier = tiers[t]
          const isFirst = t === 0
          const tierPrice = tier.price ?? tier.price_hkd ?? 0
          const rowHeight = isFirst ? 66 : 20

          const row = ws.getRow(currentRow)
          row.height = rowHeight

          // Compute subtotal formula referencing THIS row
          row.getCell(COL.NUM).value      = isFirst ? i + 1 : ''
          row.getCell(COL.PHOTO).value    = ''   // reserved for image
          row.getCell(COL.PRODUCT).value  = isFirst ? item.product_name : ''
          row.getCell(COL.CATEGORY).value = isFirst ? item.product_category : ''
          row.getCell(COL.DESC).value     = isFirst ? item.product_description : ''
          row.getCell(COL.QTY).value      = tier.quantity
          row.getCell(COL.PRICE).value    = tierPrice
          row.getCell(COL.SUBTOTAL).value = { formula: `F${currentRow}*G${currentRow}` }

          // Formatting
          row.getCell(COL.NUM).alignment      = { horizontal: 'center', vertical: 'middle' }
          row.getCell(COL.PRODUCT).alignment  = { vertical: 'top', wrapText: true }
          row.getCell(COL.CATEGORY).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
          row.getCell(COL.DESC).alignment     = { vertical: 'top', wrapText: true }
          row.getCell(COL.QTY).alignment      = { horizontal: 'center', vertical: 'middle' }
          row.getCell(COL.PRICE).numFmt       = '#,##0.00'
          row.getCell(COL.PRICE).alignment    = { horizontal: 'right', vertical: 'middle' }
          row.getCell(COL.SUBTOTAL).numFmt    = '#,##0.00'
          row.getCell(COL.SUBTOTAL).alignment = { horizontal: 'right', vertical: 'middle' }

          // Row shading
          if (rowFill) {
            for (let c = 1; c <= 8; c++) {
              row.getCell(c).fill = rowFill
            }
          }

          // Bottom border for last tier of each product
          if (t === tiers.length - 1) {
            for (let c = 1; c <= 8; c++) {
              row.getCell(c).border = { bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } } }
            }
          }

          // Embed product image on first tier row
          if (isFirst) {
            const imgUrl = item.custom_image || item.hero_image
            if (imgUrl) {
              try {
                const res = await fetch(`/api/download-image?url=${encodeURIComponent(imgUrl)}`)
                const buf = await res.arrayBuffer()
                const imgId = wb.addImage({ buffer: buf, extension: 'jpeg' })
                ws.addImage(imgId, {
                  tl: { col: COL.PHOTO - 1, row: currentRow - 1 },   // col B (0-indexed = 1)
                  ext: { width: 72, height: 62 },
                  editAs: 'oneCell',
                })
              } catch {}
            }
          }

          if (currentRow === firstDataRow && i === 0 && t === 0) firstDataRow = currentRow
          lastDataRow = currentRow
          currentRow++
        }
      }

      // ── Total row ─────────────────────────────────────────────────
      const totalRow = ws.getRow(currentRow)
      totalRow.height = 22
      totalRow.getCell(COL.QTY).value      = 'TOTAL'
      totalRow.getCell(COL.QTY).font       = { bold: true, size: 10 }
      totalRow.getCell(COL.QTY).alignment  = { horizontal: 'center', vertical: 'middle' }
      totalRow.getCell(COL.SUBTOTAL).value = { formula: `SUM(H${firstDataRow}:H${lastDataRow})` }
      totalRow.getCell(COL.SUBTOTAL).numFmt    = '#,##0.00'
      totalRow.getCell(COL.SUBTOTAL).font      = { bold: true, size: 10 }
      totalRow.getCell(COL.SUBTOTAL).alignment = { horizontal: 'right', vertical: 'middle' }
      for (let c = 1; c <= 8; c++) {
        totalRow.getCell(c).fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } }
        totalRow.getCell(c).border = {
          top:    { style: 'medium', color: { argb: BRAND } },
          bottom: { style: 'thin',   color: { argb: BRAND } },
        }
      }
      currentRow++

      // ── Notes ─────────────────────────────────────────────────────
      if (quote.notes) {
        currentRow++
        ws.getRow(currentRow).getCell(1).value = 'Notes:'
        ws.getRow(currentRow).getCell(1).font  = { bold: true, color: { argb: GRAY }, size: 9 }
        ws.mergeCells(`B${currentRow}:H${currentRow}`)
        ws.getRow(currentRow).getCell(2).value = quote.notes
        ws.getRow(currentRow).getCell(2).font  = { size: 9 }
        ws.getRow(currentRow).getCell(2).alignment = { wrapText: true }
        ws.getRow(currentRow).height = 30
        currentRow++
      }

      // ── Terms line ────────────────────────────────────────────────
      currentRow++
      ws.mergeCells(`A${currentRow}:H${currentRow}`)
      ws.getRow(currentRow).getCell(1).value = `All prices in ${cur}. Subject to final confirmation.`
      ws.getRow(currentRow).getCell(1).font  = { italic: true, color: { argb: 'FF999999' }, size: 8 }
      ws.getRow(currentRow).getCell(1).alignment = { horizontal: 'right' }
      currentRow += 2

      // ── Company footer ────────────────────────────────────────────
      const footerStyle = { size: 8, color: { argb: GRAY } }
      const footerLines = [
        'United Art Metals Factory Limited',
        '11A Seabright Plaza, 9-23 Shell Road, Causeway Bay, Hong Kong',
        'WhatsApp: +852 4608 3219   |   Email: sales@uart.com.hk',
      ]
      // Top border
      ws.getRow(currentRow - 1).getCell(1).border = { top: { style: 'hair', color: { argb: 'FFCCCCCC' } } }

      for (const line of footerLines) {
        ws.mergeCells(`A${currentRow}:H${currentRow}`)
        const cell = ws.getRow(currentRow).getCell(1)
        cell.value = line
        cell.font  = line === footerLines[0]
          ? { ...footerStyle, bold: true }
          : footerStyle
        cell.alignment = { horizontal: 'center' }
        ws.getRow(currentRow).height = 13
        currentRow++
      }

      // ── Download ──────────────────────────────────────────────────
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
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
          <button
            className="btn-primary w-full justify-center"
            onClick={exportExcel}
            disabled={loading}
          >
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
