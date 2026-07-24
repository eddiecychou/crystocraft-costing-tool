// Shared CSV export. Requested by Cindy (2026-07-21) for PO, UC registry and
// invoices — she works in Excel and PBIS, so the file has to open cleanly there
// rather than merely be valid CSV.
//
// Three things this gets right that a naive join(',') does not:
//
// 1. A UTF-8 BOM. Without it Excel on Windows reads the file as the local
//    codepage and every Chinese name becomes mojibake — 容興竹木製品有限公司
//    turns to garbage. Half the suppliers in this business have Chinese names,
//    so this is not a nicety.
// 2. Text-forcing for codes. Excel silently converts anything that looks
//    numeric, so "SI260094" survives but a bare code like "0001-179" becomes a
//    date and 00123 loses its zeros. Columns declared `text: true` are wrapped
//    so Excel leaves them alone.
// 3. Formula-injection guarding. A cell beginning = + - or @ is executed by
//    Excel when opened. Customer and remark fields are free text typed by
//    people, so they are prefixed with a quote.

// Excel treats a leading =, +, - or @ as a formula. Prefixing with a single
// quote makes it literal text and the quote itself is not displayed.
//
// A plain negative number is exempt. Guarding it turned -56 into '-56, which
// Excel reads as TEXT — so a shortage or an adjustment column could not be
// summed, sorted or formatted as a number. The test is deliberately strict:
// only a bare number passes, so "-2+cmd|' /C calc'!A0" is still neutralised.
const NUMERIC = /^-?\d+(\.\d+)?$/
const deFormula = (s) => (/^[=+\-@]/.test(s) && !NUMERIC.test(s) ? `'${s}` : s)

const cell = (v, text) => {
  if (v == null) return '""'
  // Firestore Timestamp → ISO date; Date → ISO date. Both read cleanly in Excel.
  if (typeof v?.toDate === 'function') v = v.toDate()
  if (v instanceof Date) return `"${Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)}"`
  let s = String(v)
  s = deFormula(s)
  // ="..." keeps Excel from reinterpreting a code as a number or a date.
  if (text && s !== '') return `"=""${s.replace(/"/g, '""')}"""`
  return `"${s.replace(/"/g, '""')}"`
}

// `columns` is [{ label, value: row => any, text?: bool }].
export function toCsv(columns, rows) {
  const head = columns.map((c) => cell(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => cell(c.value(r), c.text)).join(','))
  // CRLF: Excel is the target, and it is what every other tool accepts too.
  return [head, ...body].join('\r\n')
}

// Downloads `rows` as `<name>.csv`. `name` should already describe the filter
// that produced it — a file called "purchase-orders.csv" that actually holds
// one month is worse than no file at all once it is sitting in a folder.
export function downloadCsv(name, columns, rows) {
  const csv = toCsv(columns, rows)
  // ﻿ is the BOM. It must be the first character of the blob, not of the
  // string passed to toCsv, or it lands inside the first header cell.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name.endsWith('.csv') ? name : `${name}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// Filename stem carrying the filter, so two exports never collide in Downloads:
// "uc-registry_2026-04-01_2026-06-30_wholesale".
export function exportStem(base, { from, to, type } = {}) {
  const parts = [base]
  if (from || to) parts.push(from || 'start', to || 'today')
  if (type) parts.push(String(type).toLowerCase().replace(/[^a-z0-9]+/g, '-'))
  return parts.join('_')
}

// Shared date-range test. Accepts a Firestore Timestamp, a Date or a string;
// `from`/`to` are yyyy-mm-dd from <input type="date">, and both ends are
// INCLUSIVE, which is what someone picking "1 Apr to 30 Jun" means.
export function inDateRange(value, from, to) {
  if (!from && !to) return true
  let d = value
  if (typeof d?.toDate === 'function') d = d.toDate()
  if (!(d instanceof Date)) d = d ? new Date(d) : null
  if (!d || Number.isNaN(d.getTime())) return false   // undated rows fall out of any range
  const day = d.toISOString().slice(0, 10)
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}
