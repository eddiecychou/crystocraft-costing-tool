# V8.18 invoice export units

Admin PI/SI print/PDF tables already included stored line units. Their legacy fallback now matches normLine's pcs default, and PI CSV keeps that same default. Customer app invoices discarded the unit while mapping order lines; they now preserve the unit through PDF and Excel. Historical ERP invoice DTOs do not contain a documented selected unit, so those lines remain unspecified; no unit is invented and no ERP/security schema is changed.

Added XLSX downloads to admin PI/SI print pages, preserving PI's priced/unpriced CSV options. All invoice XLSX files have separate Qty and Unit columns; quantities, prices and amounts remain numeric. Exported customer-facing fields are explicitly selected; supplier/cost data are excluded. Totals retain subtotal, discount, charges and, for sales invoices, the displayed accounting adjustment/payable amount. Customer charge-only rows previously mapped their flat amount to zero; they now preserve the charge amount and leave quantity/unit/price empty, matching admin print behavior and computeOrderTotals.

Thirteen regression tests use the real components, Firestore normalization/totals and actual Excel download, covering all seven units, legacy defaults, decimal values, charge rows, numeric totals, quote conversion, customer ownership refusal, historical unknown units, both PI CSV options, sales accounting adjustment and historical negative quantities. Tests run in prebuild and GitHub Actions. No live invoice records or profile/rules changes are needed.

Candidate and production verification pending.

## Candidate PASS — 15 October 2026

Code `13a8681`, deploy `6ad0b77bc43630fe7fd482ee`, https://6ad0b77bc43630fe7fd482ee--ua-product-manager.netlify.app; served `/assets/index-DFPb7HoH.js`, V8.18 ·15Oct22:22; Firebase probe200. All60 checks passed (39search/filter,5quote PDF,3quote Excel,13invoice), production build/lint passed and11configuration tests passed separately.

Admin `claude-qa@crystocraft.com`: fresh password sign-in, dashboard data, Settings access, catalogue294products/713SKUs, refresh and runtime PASS. Existing order `ldtFAPTJpiuDfoIo3Xe2` (SO260058/SI260130) PI/SI print tables show2pcs; actual Excel downloads from both pages retain numeric qty2, Unit pcs, product amount60, freight23 with blank qty/unit, total83. Quote/order/invoice fields were not edited.

Customer `customer-qa@crystocraft.com`: fresh password sign-in to approved QA-only home,24catalogue cards, Sacred Angel detail/prices, refresh in correct shell, Settings redirected to shop, no admin/private controls and runtime PASS. No live invoice was created for QA; customer invoice unit/export/ownership behavior was tested with the real component and offline authorized-order fixtures, including rejection of another customer's order. Historical ERP lines without a saved/documented unit remain unspecified. Both QA sessions signed out; owner session preserved.

Mixed-unit actual-component HTML and XLSX fixtures under `/private/tmp/v818-evidence/` were independently rendered to PDFs and text-checked for all7units; browser screenshots verify the real print CSS/layout separately (LibreOffice HTML rendering does not reproduce browser CSS faithfully). Artifact-tool inspection/render confirms XLSX Unit column; numeric types/blank charge cells were verified directly with ExcelJS because artifact-tool has blank-cell display artifacts. Candidate screenshots: invoice-units-candidate-admin.png, invoice-units-candidate-customer.png, invoice-candidate-pi.png, invoice-candidate-sales.png. Synthetic browser screenshots: pi-invoice-browser.png, sales-invoice-browser.png, customer-invoice-browser.png. No rules, permissions or ERP schema changes.

## Production PASS — 15 October 2026

Deploy `6ad0b877d91f01380927bd2c`, release commit `9abcd704031760a8522e1d6586a1be4d249d5eb2`, published22:27:34AEDT. Both production hostnames serve `/assets/index-BkTNBC0i.js`, V8.18 ·15Oct22:27; configuration probes200.

- Admin `claude-qa@crystocraft.com`: fresh real password sign-in, dashboard/Settings access, catalogue294products/713SKUs, refresh and runtime PASS. Production PI/SI print documents for existing SO260058/SI260130 show2pcs. Actual Download Excel actions on both production pages produced workbooks with numeric qty2 and Unit pcs, product amount60, freight23 with blank quantity/unit, and total83. Both were reopened and asserted with ExcelJS. Existing records were not edited. Screenshots `invoice-units-production-admin.png`, `invoice-production-pi.png`, `invoice-production-sales.png` and actual downloaded workbooks retained under `/private/tmp/v818-evidence/`.
- Customer `customer-qa@crystocraft.com`: fresh real password sign-in to approved QA-only home,24catalogue cards, Sacred Angel detail/prices, refresh in customer shell, Settings redirected to shop, no admin/private controls and no runtime errors PASS. Screenshot `invoice-units-production-customer.png`. Invoice-specific selected-unit coverage remains the real-component authorized-order fixture suite; no live invoice was fabricated or another customer's invoice accessed for this QA account.
- GitHub Actions https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38727383307 PASS:39search/filter,5quote PDF,3quote Excel,13invoice checks =60passed,0failed. Production build and lint passed;11Firebase configuration tests passed separately. No rules, role/profile, ERP schema or server permission changes.

Both QA sessions signed out; owner session preserved. Temporary fixture server stopped. Closure documentation skips Netlify so the verified production app build stays current.
