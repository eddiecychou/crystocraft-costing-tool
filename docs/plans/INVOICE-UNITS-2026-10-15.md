# V8.18 invoice export units

Admin PI/SI print/PDF tables already included stored line units. Their legacy fallback now matches normLine's pcs default, and PI CSV keeps that same default. Customer app invoices discarded the unit while mapping order lines; they now preserve the unit through PDF and Excel. Historical ERP invoice DTOs do not contain a documented selected unit, so those lines remain unspecified; no unit is invented and no ERP/security schema is changed.

Added XLSX downloads to admin PI/SI print pages, preserving PI's priced/unpriced CSV options. All invoice XLSX files have separate Qty and Unit columns; quantities, prices and amounts remain numeric. Exported customer-facing fields are explicitly selected; supplier/cost data are excluded. Totals retain subtotal, discount, charges and, for sales invoices, the displayed accounting adjustment/payable amount. Customer charge-only rows previously mapped their flat amount to zero; they now preserve the charge amount and leave quantity/unit/price empty, matching admin print behavior and computeOrderTotals.

Twelve regression tests use the real components, Firestore normalization/totals and actual Excel download, covering all seven units, legacy defaults, decimal values, charge rows, numeric totals, quote conversion, customer ownership refusal, historical unknown units, both PI CSV options and sales accounting adjustment. Tests run in prebuild and GitHub Actions. No live invoice records or profile/rules changes are needed.

Candidate and production verification pending.
