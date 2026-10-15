# Commercial document catalogue-name audit — 16 October 2026

Owner requested checking quotes, proforma invoices, sales invoices, packing lists and purchase orders, including PDF and Excel exports, for the Crystocraft Range catalogue name.

## Findings and local fixes

| Document | Screen/catalogue labels | PDF and Excel paths reviewed |
|---|---|---|
| Quote | Picker already named Crystocraft Range. Older saved `product_category` fallbacks could still appear as `Crystocraft Range · Gift Range`. `rangeQuoteSubtitle` now suppresses exact obsolete catalogue aliases and avoids duplicate names. The picker normalizes those aliases from source categories without modifying source records. Legitimate categories remain visible. | `QuotePDF.jsx`, `QuoteExport.jsx`: no separate catalogue/category output column; only product name/description and selected commercial data. |
| Proforma invoice | Shared reconciliation `LINE_TYPES` still labelled `range` as Figurine. Updated label and unmatched-line warnings to Crystocraft Range; stock-reserve warning consistent. Stored `range` key and packability unchanged. | `ProformaInvoicePrint.jsx`, `invoiceExcel.js`: line descriptions and commercial values, not internal source/type metadata. |
| Sales invoice | Shared order classification uses the new label. Customer-facing invoice unchanged in access/privacy. | `SalesInvoicePrint.jsx`, `customer/CustomerInvoicePrint.jsx`, `invoiceExcel.js`: no separate catalogue label emitted. |
| Packing list | Reads existing order-line and carton snapshots. | `PackingListPrint.jsx`, `logisticsExcel.js`: no separate catalogue label emitted; mixed and single-carton unit/remark behavior preserved. |
| Purchase order | Linked-component badge and component-selector range tab still said Figurine. Updated both to Crystocraft Range. | `PurchaseOrderPrint.jsx`, `logisticsExcel.js`: English and Simplified Chinese output uses supplier/product line text, not internal component-source classification. |

This is a display-name audit, not a change to document layout. No catalogue column was added to documents that do not have one. No bulk replacements of user-entered descriptions, remarks, product names, historic document snapshots or database records. Physical product terminology such as Freestand Figurine is not a catalogue label and remains accurate.

## Verification — PASS locally

- Full production build passed.
- 124 automated tests passed, zero failures: search/filter 39, quote PDF 10, quote Excel 7, invoice 23, packing/PO 20, AI 25.
- New tests cover actual quote PDF component text, actual quote workbook download, PI/admin SI/customer SI print and workbook downloads, packing print/workbook and English/Chinese PO print/workbook downloads. They verify explicit Crystocraft Range product text, unchanged quantities, units, prices, totals and tier remarks, and exclusion of legacy catalogue-category metadata.
- Quote alias checks cover missing categories, all exact historical names, preserved real categories and no mutation of source products.
- Invoice classification test checks Crystocraft Range label, unchanged `range` key and packability/charge semantics.
- No-undefined lint and whitespace checks passed.

Local code and automated export checks only. No fresh production exports/logins performed for this follow-up. Not pushed or deployed; the preceding catalogue PDF naming release remains production.
