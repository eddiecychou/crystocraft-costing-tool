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
    // Debug: log what fields are in the quote object
    console.log('[QuoteExport] quote fields:', JSON.stringify({
      client_name:     quote.client_name,
      contact_name:    quote.contact_name,
      contact_email:   quote.contact_email,
      contact_phone:   quote.contact_phone,
      contact_address: quote.contact_address,
      quote_date:      quote.quote_date,
    }))
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
      ws.getColumn(COL.NUM).width     = 4   // narrow — only used for row numbers in data rows
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

      // ── Rows 2–7: Client info block ─────────────────────────────────────────
      // Direct cell assignment — no merges, no rich text, no helper functions.
      // Col B (photo col, width 14) used as label; value starts at col C and overflows right.
      const labelFont = { name: 'Calibri Light', size: 7.5, color: { argb: B.GRAY_MID } }
      const valueFont = { name: 'Calibri Light', size: 9,   color: { argb: B.BLACK } }
      const labelAlign = { vertical: 'middle' }
      const valueAlign = { vertical: 'middle' }

      ws.getRow(2).height = 7   // spacer after logo

      // Row 3: TO / client name
      ws.getRow(3).height = 15
      ws.getCell(3, COL.PHOTO).value     = 'TO';      ws.getCell(3, COL.PHOTO).font = labelFont; ws.getCell(3, COL.PHOTO).alignment = labelAlign
      ws.getCell(3, COL.PRODUCT).value   = String(quote.client_name || '—');   ws.getCell(3, COL.PRODUCT).font = { ...valueFont, bold: true, size: 10 }; ws.getCell(3, COL.PRODUCT).alignment = valueAlign

      // Row 4: CONTACT / name + email
      ws.getRow(4).height = 14
      ws.getCell(4, COL.PHOTO).value   = 'CONTACT'; ws.getCell(4, COL.PHOTO).font = labelFont; ws.getCell(4, COL.PHOTO).alignment = labelAlign
      ws.getCell(4, COL.PRODUCT).value = String([quote.contact_name, quote.contact_email].filter(Boolean).join('   ·   ') || '—')
      ws.getCell(4, COL.PRODUCT).font  = valueFont; ws.getCell(4, COL.PRODUCT).alignment = valueAlign

      // Row 5: PHONE
      ws.getRow(5).height = 14
      ws.getCell(5, COL.PHOTO).value   = 'PHONE';   ws.getCell(5, COL.PHOTO).font = labelFont; ws.getCell(5, COL.PHOTO).alignment = labelAlign
      ws.getCell(5, COL.PRODUCT).value = String(quote.contact_phone || '—')
      ws.getCell(5, COL.PRODUCT).font  = valueFont; ws.getCell(5, COL.PRODUCT).alignment = valueAlign

      // Row 6: ADDRESS — height grows with content (supports multi-line)
      const addrText  = String(quote.contact_address || '—')
      const addrLines = Math.max(1, addrText.split('\n').length, Math.ceil(addrText.length / 50))
      const addrRowH  = Math.max(14, addrLines * 13)
      ws.getRow(6).height = addrRowH
      ws.getCell(6, COL.PHOTO).value   = 'ADDRESS'; ws.getCell(6, COL.PHOTO).font = labelFont; ws.getCell(6, COL.PHOTO).alignment = labelAlign
      ws.getCell(6, COL.PRODUCT).value = addrText
      ws.getCell(6, COL.PRODUCT).font  = valueFont; ws.getCell(6, COL.PRODUCT).alignment = { ...valueAlign, wrapText: true }
      // Merge address value across remaining columns so long addresses don't get clipped
      ws.mergeCells(6, COL.PRODUCT, 6, TOTAL_COLS)

      // Right side — DATE and CURRENCY (rows 3–4, cols E–F)
      ws.getRow(7).height = 7   // spacer before header row
      const dateStr = quote.quote_date
        ? new Date(quote.quote_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      ws.getCell(3, COL.QTY).value   = 'DATE';     ws.getCell(3, COL.QTY).font = labelFont;  ws.getCell(3, COL.QTY).alignment = { vertical: 'middle', horizontal: 'right' }
      ws.getCell(3, COL.PRICE).value = dateStr;    ws.getCell(3, COL.PRICE).font = valueFont; ws.getCell(3, COL.PRICE).alignment = { vertical: 'middle', horizontal: 'right' }
      ws.getCell(4, COL.QTY).value   = 'CURRENCY'; ws.getCell(4, COL.QTY).font = labelFont;  ws.getCell(4, COL.QTY).alignment = { vertical: 'middle', horizontal: 'right' }
      ws.getCell(4, COL.PRICE).value = cur;        ws.getCell(4, COL.PRICE).font = valueFont; ws.getCell(4, COL.PRICE).alignment = { vertical: 'middle', horizontal: 'right' }

      // ── Column header row (row 8) ───────────────────────────────────────────
      const HEADER_ROW = 8
      ws.getRow(HEADER_ROW).height = 22
      const headers = ['', '', 'PRODUCT', 'DESCRIPTION', 'QTY', `UNIT PRICE (${cur})`]
      headers.forEach((h, i) => {
        const c = ws.getRow(HEADER_ROW).getCell(i + 1)
        c.value = h
        c.font  = { name: 'Calibri Light', bold: true, size: 8, color: { argb: B.GRAY_DARK } }
        c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } }  // light grey
        c.alignment = {
          horizontal: i >= 4 ? 'center' : (i <= 1 ? 'center' : 'left'),
          vertical: 'middle',
        }
      })

      // ── Helpers ─────────────────────────────────────────────────────────────
      // Estimate how many wrapped lines a text needs in a given column width (chars)
      function descLineCount(text, wrapChars) {
        if (!text) return 1
        return text.split('\n').reduce((n, line) => {
          return n + Math.max(1, Math.ceil((line.length || 1) / wrapChars))
        }, 0)
      }

      const DESC_WRAP    = 48    // chars per line in description col at size-8 font
      const LINE_PT      = 11   // pt per wrapped line
      const PAD_PT       = 96   // top+bottom padding — drives row height; larger = more centering room
      const IMG_SIZE     = 90   // px — image size
      const PT_TO_PX     = 4/3  // 1 Excel pt ≈ 1.333 px at 96 DPI

      // ── Page break tracking ─────────────────────────────────────────────────
      // A4 portrait usable height: 297mm = 841.89pt minus margins (top 0.6in + bottom 0.8in
      // + header 0.3in + footer 0.3in = 144pt total margins) ≈ 698pt usable per page.
      const PAGE_HEIGHT_PT = 698
      // Header section height (rows 1–8) consumes space on page 1
      const headerUsedPt = (LOGO_H + 10) + 7 + 15 + 14 + 14 + addrRowH + 7 + 22
      let usedPt = headerUsedPt

      // ── Data rows ───────────────────────────────────────────────────────────
      let currentRow = HEADER_ROW + 1

      for (let i = 0; i < items.length; i++) {
        const item     = items[i]
        const tiers    = item.tiers?.length ? item.tiers : [{ quantity: 0, price: 0 }]
        const rowBg    = i % 2 === 1 ? B.ROW_ALT : B.WHITE
        const firstRow = currentRow
        const lastRow  = currentRow + tiers.length - 1

        // ── Calculate row height driven by description length ────────
        const lines    = descLineCount(item.product_description, DESC_WRAP)
        const descPt   = lines * LINE_PT + PAD_PT
        // Image needs ~66pt (88px × 0.75pt/px) minimum
        const imgMinPt = Math.ceil(IMG_SIZE * 0.75) + PAD_PT
        const totalPt  = Math.max(imgMinPt, descPt)
        // Distribute evenly — minimum 18pt per tier row
        const rowH     = Math.max(18, Math.ceil(totalPt / tiers.length))

        // ── Page break: don't split a product across pages ───────────
        const productPt = rowH * tiers.length
        if (i > 0 && usedPt + productPt > PAGE_HEIGHT_PT) {
          // Insert a manual row break after the row just before this product
          ws.rowBreaks.push({ id: firstRow - 1, min: 1, max: 16383, man: 1 })
          usedPt = 0
        }
        usedPt += productPt

        for (let t = 0; t < tiers.length; t++) {
          const tier = tiers[t]
          const row  = ws.getRow(currentRow)
          row.height = rowH  // equal height for every tier row

          if (t === 0) {
            row.getCell(COL.NUM).value     = i + 1
            row.getCell(COL.NUM).font      = baseFont({ size: 8, color: { argb: B.GRAY_MID } })
            row.getCell(COL.NUM).alignment = { horizontal: 'center', vertical: 'middle' }
          }

          row.getCell(COL.QTY).value       = tier.quantity ?? ''
          row.getCell(COL.QTY).font        = baseFont()
          row.getCell(COL.QTY).alignment   = { horizontal: 'center', vertical: 'middle' }
          row.getCell(COL.PRICE).value     = tier.price ?? tier.price_hkd ?? ''
          row.getCell(COL.PRICE).font      = baseFont({ bold: true })
          row.getCell(COL.PRICE).numFmt    = '#,##0.00'
          row.getCell(COL.PRICE).alignment = { horizontal: 'right', vertical: 'middle' }

          if (rowBg !== B.WHITE) {
            for (let c = 1; c <= TOTAL_COLS; c++) {
              row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } }
            }
          }
          if (t === tiers.length - 1) {
            for (let c = 1; c <= TOTAL_COLS; c++) {
              row.getCell(c).border = { bottom: { style: 'hair', color: { argb: B.BORDER } } }
            }
          }
          currentRow++
        }

        // ── Merge # / Photo / Product / Description across all tier rows ──
        if (tiers.length > 1) {
          ws.mergeCells(firstRow, COL.NUM,     lastRow, COL.NUM)
          ws.mergeCells(firstRow, COL.PHOTO,   lastRow, COL.PHOTO)
          ws.mergeCells(firstRow, COL.PRODUCT, lastRow, COL.PRODUCT)
          ws.mergeCells(firstRow, COL.DESC,    lastRow, COL.DESC)
        }

        ws.getRow(firstRow).getCell(COL.NUM).alignment     = { horizontal: 'center', vertical: 'middle' }
        ws.getRow(firstRow).getCell(COL.PRODUCT).value     = item.product_name || ''
        ws.getRow(firstRow).getCell(COL.PRODUCT).font      = baseFont({ bold: true })
        ws.getRow(firstRow).getCell(COL.PRODUCT).alignment = { vertical: 'middle', wrapText: true }
        ws.getRow(firstRow).getCell(COL.DESC).value        = item.product_description || ''
        ws.getRow(firstRow).getCell(COL.DESC).font         = baseFont({ size: 8, color: { argb: B.GRAY_DARK } })
        ws.getRow(firstRow).getCell(COL.DESC).alignment    = { vertical: 'middle', wrapText: true }

        // ── Embed image — centred in merged Photo cell ───────────────
        const imgUrl = item.custom_image || item.hero_image
        if (imgUrl) {
          try {
            // Try proxy first (Netlify), fall back to direct fetch (local dev)
            let buf
            try {
              const res = await fetch(`/api/download-image?url=${encodeURIComponent(imgUrl)}`)
              if (!res.ok) throw new Error('proxy failed')
              buf = await res.arrayBuffer()
            } catch {
              const res = await fetch(imgUrl)
              buf = await res.arrayBuffer()
            }
            const ext   = imgUrl.includes('.png') ? 'png' : 'jpeg'
            const imgId = wb.addImage({ buffer: buf, extension: ext })

            // Fractional col/row coordinates.
            // Col B (width=14 char-units): actual px ≈ 14 * 7 + 5 = 103px (Calibri MDW ~7px)
            // Horizontal: small fixed left-margin (4px) keeps image inside col B
            const PHOTO_COL_ACTUAL_PX = 103
            const colOffFrac = Math.max(0, (PHOTO_COL_ACTUAL_PX - IMG_SIZE) / (2 * PHOTO_COL_ACTUAL_PX))

            // Vertical: center image in the total merged height.
            // rowOffFrac = fraction of ONE row height to offset from top of firstRow.
            // ExcelJS uses the anchor row's custom height for EMU conversion, so we
            // divide by singleRowPx (= rowH × PT_TO_PX).
            const singleRowPx = rowH * PT_TO_PX
            const totalRowPx  = singleRowPx * tiers.length
            // Cap top offset at 38px so tall rows (long descriptions) don't push
            // the image further down than short-description rows.
            const topOffsetPx = Math.min(70, Math.max(0, (totalRowPx - IMG_SIZE) / 2))
            const rowOffFrac  = topOffsetPx / singleRowPx

            ws.addImage(imgId, {
              tl:     { col: (COL.PHOTO - 1) + colOffFrac, row: (firstRow - 1) + rowOffFrac },
              ext:    { width: IMG_SIZE, height: IMG_SIZE },
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

  const fields = [
    { label: 'To',      value: quote.client_name },
    { label: 'Contact', value: [quote.contact_name, quote.contact_email].filter(Boolean).join(' · ') },
    { label: 'Phone',   value: quote.contact_phone },
    { label: 'Address', value: quote.contact_address },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold text-gray-900 mb-1">Export Quote</h2>

        {/* Data preview — confirms what will appear in the Excel */}
        <div className="mt-3 mb-5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 space-y-1">
          {fields.map(({ label, value }) => (
            <div key={label} className="flex gap-2 text-xs">
              <span className="text-gray-400 w-14 shrink-0">{label}</span>
              <span className={value ? 'text-gray-700' : 'text-gray-300 italic'}>
                {value || 'not set — edit in Quote Details first'}
              </span>
            </div>
          ))}
        </div>

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
