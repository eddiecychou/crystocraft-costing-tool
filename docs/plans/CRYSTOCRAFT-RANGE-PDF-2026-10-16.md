# Crystocraft Range PDF naming follow-up — 16 October 2026

Owner requested checking the catalogue PDF export and updating remaining Figurine Gifts references.

## Result — local implementation verified, not deployed

The full-range PDF cover still read `Figurine Range`, despite the earlier navigation rename. Updated it to `Crystocraft Range`, together with PDF document metadata, download filename prefix and export dialog title. Quote picker/item/error labels formerly using `Gift Range`, supplier component quote heading, component-library help and Woo catalogue matching label now use the same catalogue name; translated wording and corresponding smoke locators/current reference docs were updated. Historical release records retain their original wording.

No remaining `Figurine Gifts` references in application source, QA, current skill/reference docs or MCP docs. Internal routes, modules and collections unchanged; no existing live record snapshots rewritten.

Validation:
- Production build and all 115 existing regression tests passed, zero failures.
- No-undefined lint and whitespace checks passed.
- Real `RangeCataloguePDF` renderer produced a three-page A4 fixture. Metadata title is `Crystocraft Range Catalogue — Catalogue QA sample`; extracted text contains `Crystocraft Range` and neither `Figurine Gifts` nor `Figurine Range`.
- Cover and content pages visually checked for layout. QA fixture explicitly labelled as a layout sample, not a price quotation.
- Sample: `output/pdf/Crystocraft Range - catalogue sample.pdf` (ignored output).

This follow-up is local only. No push or production deployment performed; the preceding rename release remains the last verified production version.

## Authorized release follow-up

Owner explicitly authorized production deployment, a real exported PDF check, and fresh admin/customer login verification.
Release commit: `88143f6afec5700aab52ccf465b51fc133af6eb2`.

Candidate deploy `6ad0ea8b98fac4035c00be9d`:
https://6ad0ea8b98fac4035c00be9d--ua-product-manager.netlify.app
Served bundle `/assets/index-FVk1ooIN.js`, marker `V8.18 · 16 Oct, 01:57`; Firebase configuration probe HTTP 200, separate from real logins. Login configuration suite passed 11/11.

- Admin `claude-qa@crystocraft.com`, fresh email/password sign-in: PASS. Correct OC dashboard (96 pipeline records), Settings/Portal navigation, catalogue 294/294 products and 713 SKUs. Export dialog `Crystocraft Range catalogue` loads 292 products and 693 priced options. Refresh retains admin shell/data; no runtime errors. Screenshot `/private/tmp/v818-evidence/range-pdf-candidate-admin.png`.
- Approved customer `customer-qa@crystocraft.com`, fresh email/password sign-in: PASS. Correct approved QA-only storefront; catalogue heading Crystocraft Range and 24 initial cards load. Refresh retains customer shell; Sacred Angel detail loads USD 6.44 Chrome/Bohemia option, MOQ 100 and ~9-week lead time. No supplier costs or internal notes/admin controls. `/settings` redirects to `/shop`, zero Settings links, no runtime errors. Screenshot `/private/tmp/v818-evidence/range-pdf-candidate-customer.png`.

Both candidate QA sessions explicitly signed out; no product saves or business data changes. Firebase rules unchanged.

## Production — PASS (supersedes local-only status above)

Deploy `6ad0eb4fd6ce220198dade46`, release commit `88143f6afec5700aab52ccf465b51fc133af6eb2`.
Published 16 October 2026 at 02:04:35 AEDT; verification completed at 02:11 AEDT.
Both https://portal.crystocraft.com and https://ua-product-manager.netlify.app serve `/assets/index-C2v2zL6D.js`; both Firebase configuration probes HTTP 200. Marker: `V8.18 · 16 Oct, 02:04`.

- Admin `claude-qa@crystocraft.com`, fresh email/password sign-in on the Netlify production hostname: PASS. OC dashboard (96 pipeline records), Settings/Portal navigation and Crystocraft Range catalogue (294/294 products, 713 SKUs) loaded. Refresh retained correct admin shell and data. No auth/profile or lazy-chunk failure observed; live PDF export completed. Screenshot: `/private/tmp/v818-evidence/range-pdf-production-admin.png`.
- Approved customer `customer-qa@crystocraft.com`, fresh email/password sign-in in an isolated in-app browser at the same production hostname: PASS. Correct approved QA-only storefront, Crystocraft Range catalogue and 24 initial cards, refresh retained customer shell, Sacred Angel product detail and USD 6.44 Chrome/Bohemia pricing loaded. No admin controls, supplier costs or internal notes; `/settings` redirected to `/shop`, zero Settings links. Runtime error log empty. Screenshot: `/private/tmp/v818-evidence/range-pdf-production-customer.png`.

Production login checks used the Netlify hostname to preserve the owner's working custom-domain session. QA sessions were explicitly signed out. Browser automation was interrupted during export; the download completed successfully. Its filename and completion were confirmed in native Chrome's download panel, and the downloaded file was inspected directly. The final customer test ran in an isolated browser to avoid interrupting the owner's Chrome work.

### Actual production PDF export — PASS

Used admin Catalogue PDF → no-account USD list-price option → Build PDF, loading 292 products and 693 priced options.
Downloaded `/Users/eddie/Downloads/Crystocraft Range Catalogue - 2026-10-15.pdf` (31.6 MiB; 37 A4 pages, 33,157,873 bytes). PDF metadata title: `Crystocraft Range Catalogue`. Cover displays `Crystocraft Range` and issue date 16 October 2026. Extracted text across all 37 pages contains the new name and neither `Figurine Gifts` nor `Figurine Range`. Rendered cover and first content page checked visually; no layout issues observed.

Preserved identical copy: `output/pdf/Crystocraft Range Catalogue - production verified.pdf` (ignored output).
SHA-256: `2fd5721007d1f5a284ced5e2b7e3372280e71f5afbc99c73ccc485135385c181`.
Rendered evidence: `/private/tmp/v818-evidence/range-pdf-production-01.png` and `range-pdf-production-02.png`.

GitHub Actions [run 38756974579](https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38756974579), job `116497860937`: all six suites passed, 115 tests, zero failures. No Firebase rules deployment or product/business-data edits. Verification closure commit uses `[skip netlify]` to preserve the tested production build.
