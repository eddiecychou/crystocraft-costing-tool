import { useState } from 'react'
import ExcelJS from 'exceljs'

export default function QuoteExport({ quote, items, onClose }) {
  const [loading, setLoading] = useState(false)

  async function exportExcel() {
    setLoading(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Quote')

      // Header info
      ws.mergeCells('A1:F1')
      ws.getCell('A1').value = 'CRYSTOCRAFT — CORPORATE GIFT QUOTATION'
      ws.getCell('A1').font = { bold: true, size: 14 }
      ws.getCell('A1').alignment = { horizontal: 'center' }

      ws.getCell('A3').value = 'Client:'
      ws.getCell('B3').value = quote.client_name
      ws.getCell('A4').value = 'Contact:'
      ws.getCell('B4').value = [quote.contact_name, quote.contact_email].filter(Boolean).join(' · ')
      ws.getCell('A5').value = 'Date:'
      ws.getCell('B5').value = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      ws.getCell('D3').value = 'Currency:'
      ws.getCell('E3').value = quote.quote_currency || 'HKD'
      ws.getCell('D4').value = 'Exchange Rates:'
      ws.getCell('E4').value = `RMB ${quote.rmb_to_hkd} · USD ${quote.usd_to_hkd} · EUR ${quote.eur_to_hkd}`

      ;['A3','A4','A5','D3','D4'].forEach(c => { ws.getCell(c).font = { bold: true, color: { argb: 'FF666666' } } })

      // Column headers
      const headerRow = ws.addRow([])
      ws.addRow([])
      const cur = quote.quote_currency || 'HKD'
      const hRow = ws.addRow(['#', 'Product', 'Category', 'Description', 'Quantity', `Unit Price (${cur})`, `Subtotal (${cur})`])
      hRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4244CF' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      })
      hRow.height = 20

      // Image column width
      ws.getColumn(1).width = 6
      ws.getColumn(2).width = 30
      ws.getColumn(3).width = 16
      ws.getColumn(4).width = 40
      ws.getColumn(5).width = 12
      ws.getColumn(6).width = 18
      ws.getColumn(7).width = 18

      // Items — one row per tier per product
      let rowIndex = 0
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const tiers = item.tiers || [{ quantity: item.quantity || 0, price_hkd: item.price_hkd || 0 }]

        for (let t = 0; t < tiers.length; t++) {
          const tier = tiers[t]
          const isFirstTier = t === 0
          const tierPrice = tier.price ?? tier.price_hkd ?? 0
          const row = ws.addRow([
            isFirstTier ? i + 1 : '',
            isFirstTier ? item.product_name : '',
            isFirstTier ? item.product_category : '',
            isFirstTier ? item.product_description : '',
            tier.quantity,
            tierPrice,
            { formula: `E${ws.lastRow.number}*F${ws.lastRow.number}` },
          ])
          row.height = isFirstTier ? 60 : 22

          // Embed hero image only on first tier row
          if (isFirstTier && item.hero_image) {
            try {
              const imgRes = await fetch(`/api/download-image?url=${encodeURIComponent(item.hero_image)}`)
              const imgBlob = await imgRes.blob()
              const arrayBuffer = await imgBlob.arrayBuffer()
              const imageId = wb.addImage({ buffer: arrayBuffer, extension: 'jpeg' })
              ws.addImage(imageId, {
                tl: { col: 1, row: row.number - 1 },
                ext: { width: 80, height: 80 },
              })
              ws.getColumn(2).width = Math.max(ws.getColumn(2).width, 14)
            } catch {}
          }

          // Style cells
          row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' }
          row.getCell(6).numFmt = '#,##0.00'
          row.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' }
          row.getCell(7).numFmt = '#,##0.00'
          row.getCell(7).alignment = { horizontal: 'right', vertical: 'middle' }
          row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
          row.getCell(2).alignment = { vertical: 'middle', wrapText: true }
          row.getCell(4).alignment = { vertical: 'middle', wrapText: true }

          if (rowIndex % 2 === 1) {
            row.eachCell(cell => {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F8FF' } }
            })
          }
          rowIndex++
        }
      }

      const totalRowCount = rowIndex
      // Total row
      const totalRow = ws.addRow(['', '', '', '', 'TOTAL', '', { formula: `SUM(G${ws.lastRow.number - totalRowCount + 1}:G${ws.lastRow.number})` }])
      totalRow.getCell(5).font = { bold: true }
      totalRow.getCell(7).font = { bold: true }
      totalRow.getCell(7).numFmt = '#,##0.00'
      totalRow.getCell(7).alignment = { horizontal: 'right' }

      // Notes
      if (quote.notes) {
        ws.addRow([])
        ws.addRow(['Notes:', quote.notes])
        ws.lastRow.getCell(1).font = { bold: true }
      }

      // Footer
      ws.addRow([])
      ws.addRow(['', '', '', '', '', '', `All prices in ${cur}. Subject to final confirmation.`])
      ws.lastRow.getCell(7).font = { color: { argb: 'FF999999' }, italic: true }
      ws.lastRow.getCell(7).alignment = { horizontal: 'right' }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Quote_${quote.client_name}_${new Date().toISOString().slice(0, 10)}.xlsx`
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
          Download a professional quote for <span className="font-medium">{quote.client_name}</span> with product images.
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
            ⬇ Download PDF (coming soon)
          </button>
        </div>

        <button className="mt-4 text-xs text-gray-400 hover:text-gray-600 w-full text-center" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
