# V8.18 quotation Excel tier remarks

QuoteExport did not read tier.remarks. Added a Tier remarks column (G) beside the existing numeric quantity/unit (E) and price (F), with one unmerged remark cell per tier. Text wraps with row height allowance; whitespace-only remarks leave a blank cell. Numeric types, selected-unit number format, product/photo/description merging and source snapshots remain unchanged. Header/footer spans now cover the new column. No quote data writes, migration or permission changes.

Three added real-download XLSX regression tests cover correct tier/product association, unmerged remark cells, wrapped long/multiline/Chinese text, literal formula-like strings, blanks and retained numeric quantities/prices. The existing suites bring prebuild/CI to77checks. Fixture workbook inspected with ExcelJS, artifact-tool and independent LibreOffice print conversion; visual review added a small indent to separate remarks from right-aligned prices.

## Candidate PASS — 16 October 2026, Australia/Sydney

Code commits c488a41 and 7392b6a. Final candidate 6ad0d1c2f44a60da2d767a8d, https://6ad0d1c2f44a60da2d767a8d--ua-product-manager.netlify.app, served /assets/index-Cac1xgGa.js, V8.18 · 16 Oct, 00:14. Build 77/77, no-undef lint and 11 Firebase configuration tests passed; served Firebase probe 200.

Fresh password login claude-qa@crystocraft.com: PASS, admin dashboard/Settings navigation, 294 products / 713 SKUs and refresh. Real six-product Mandy Pong quote downloaded: all 12 tier remarks matched their numeric quantity 10, selected pair unit and original prices; seven embedded images. Independent print conversion reviewed visually. No quote fields changed.

Fresh password login customer-qa@crystocraft.com: PASS, approved QA-only customer storefront, 24 figurine cards before/after refresh, Sacred Angel detail and USD finish prices, no private admin controls; admin quote route redirected to /shop. No runtime errors. QA sessions signed out. Evidence in /private/tmp/v818-evidence/excel-final-candidate-{admin,customer}.png and mandy-excel-final-candidate.png.

Production verification pending. No rules or access changes.
