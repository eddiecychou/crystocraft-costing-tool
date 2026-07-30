// Shared helper for the "Save as PDF" filename on the print-CSS documents
// (Proforma Invoice, Sales Invoice — same pattern would suit PO/packing list
// later). Neither window.print() nor the browser's print dialog exposes a way
// to set the PDF filename directly, but Chrome/Safari/Edge all seed the Save
// dialog's default filename from document.title — so a print page sets its
// title to the document's real name just before the user prints, instead of
// leaving it as the app's route title ("SalesInvoicePrint" or similar).
// Requested by the owner 2026-07-30: "SIXXXXXX - UCxxxxx - customer name".
export function pdfFileTitle(parts) {
  return parts
    .filter(Boolean)
    .join(' - ')
    // Characters invalid in a Windows/macOS filename — the customer name or
    // notes could contain any of these.
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}
