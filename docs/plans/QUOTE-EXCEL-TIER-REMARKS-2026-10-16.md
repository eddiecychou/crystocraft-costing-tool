# V8.18 quotation Excel tier remarks

QuoteExport did not read tier.remarks. Added a Tier remarks column (G) beside the existing numeric quantity/unit (E) and price (F), with one unmerged remark cell per tier. Text wraps with row height allowance; whitespace-only remarks leave a blank cell. Numeric types, selected-unit number format, product/photo/description merging and source snapshots remain unchanged. Header/footer spans now cover the new column. No quote data writes, migration or permission changes.

Three added real-download XLSX regression tests cover correct tier/product association, unmerged remark cells, wrapped long/multiline/Chinese text, literal formula-like strings, blanks and retained numeric quantities/prices. The existing suites bring prebuild/CI to77checks. Fixture workbook inspected with ExcelJS, artifact-tool and independent LibreOffice print conversion; visual review added a small indent to separate remarks from right-aligned prices.

## Candidate PASS — 16 October 2026, Australia/Sydney

Code commits c488a41 and 7392b6a. Final candidate 6ad0d1c2f44a60da2d767a8d, https://6ad0d1c2f44a60da2d767a8d--ua-product-manager.netlify.app, served /assets/index-Cac1xgGa.js, V8.18 · 16 Oct, 00:14. Build 77/77, no-undef lint and 11 Firebase configuration tests passed; served Firebase probe 200.

Fresh password login claude-qa@crystocraft.com: PASS, admin dashboard/Settings navigation, 294 products / 713 SKUs and refresh. Real six-product Mandy Pong quote downloaded: all 12 tier remarks matched their numeric quantity 10, selected pair unit and original prices; seven embedded images. Independent print conversion reviewed visually. No quote fields changed.

Fresh password login customer-qa@crystocraft.com: PASS, approved QA-only customer storefront, 24 figurine cards before/after refresh, Sacred Angel detail and USD finish prices, no private admin controls; admin quote route redirected to /shop. No runtime errors. QA sessions signed out. Evidence in /private/tmp/v818-evidence/excel-final-candidate-{admin,customer}.png and mandy-excel-final-candidate.png.

## Production PASS — 16 October 2026, Australia/Sydney

Git CD deployed 4de6fe62694eec13d02a8d3d363657d030e257b5 as 6ad0d30f1f21d61d939ae9c3, published 16 October 00:21:04 AEDT. Both portal.crystocraft.com and ua-product-manager.netlify.app serve /assets/index-D1LSbWmZ.js, V8.18 · 16 Oct, 00:20, Firebase probes 200. GitHub Actions run 38741829545 / job 116445217833 completed success: 39 search/filter, 9 quote PDF, 6 quote Excel, 13 invoice and 10 packing/PO checks = 77 passed, zero failed.

Fresh real-page password sign-ins repeated on the published Netlify production origin, preserving the owner's working custom-domain session:

- Admin claude-qa@crystocraft.com PASS: dashboard 96 pipeline, Settings navigation, 294/294 figurine products / 713 SKUs before/after refresh, no runtime errors. Downloaded current six-product Mandy Pong quote: all 12 remarks in separate G9:G20 cells, correct numeric quantity 10, pair formats, original prices, seven images; independent print conversion visually checked. Evidence excel-production-admin.png and mandy-excel-production.png.
- Customer customer-qa@crystocraft.com PASS: expected approved QA-only storefront, 24 figurine cards before/after refresh, Sacred Angel product detail and finish prices, no admin/cost controls or runtime errors. /settings redirected to /shop. Evidence excel-production-customer.png. QA signed out.

Corrected real production workbook saved under outputs/01a13b22-c93b-79f2-9f8b-551754486033/Mandy Pong - 2026-10-15 - tier remarks.xlsx (ignored output). No quote content, rules or access changes. Verification screenshots under /private/tmp/v818-evidence/.
