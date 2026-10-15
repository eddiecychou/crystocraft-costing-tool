# V8.18 packing list and purchase order tier remarks

Packing auto-planning and order-line picking now copy the saved order tier_remarks into carton contents. Actual carton saves preserve the snapshot; existing unsnapshotted contents recover only via exact order_line_id, never product-code guessing (repeated codes can represent different tiers). An explicit saved blank remains blank. Both single/mixed carton editors expose the remark, and both PDF row paths and Excel column Q show it beside the corresponding packing quantity.

POs are independent supplier documents; there is no quote/order-to-PO conversion or reliable tier association in the existing workflow. Added editable PO per-line tier_remarks, preserved by cleanLines and existing edit/duplicate loading; PO detail, English/Chinese PDF and Excel column G display the saved remark. No supplier PO is automatically linked to a customer quote or populated from another tier. Existing rows without saved evidence remain blank.

PDF text preserves newlines/wrap; Excel cells wrap with English/Chinese height allowance. Existing numeric quantities, units, amounts, discounts/deposit, carton multipliers, weights/CBM and pallet totals unchanged. No rules or permissions changes; packing output still excludes supplier/cost fields. No live documents created/edited.

Seven added real-component regressions cover quote-to-order auto-pack and actual carton save, explicit blank/snapshot precedence and exact-ID recovery, single/mixed PDF and actual XLSX remark association, packing editor clear override, and bilingual PO clean/save-to-PDF/XLSX including long multiline Chinese/literal formula-like text. Total prebuild90 (39search/filter+9quote PDF+6quote Excel+19invoice+17packing/PO), zero failures. Lint,11Firebase config tests, production build8.21s and diff checks passed. Browser-reviewed offline packing/PO print fixtures and independent XLSX PDF rendering under /private/tmp/v818-evidence.

Code820bd7f, candidate6ad0d8be6399b9cee0eb2f77. Candidate/production role gates pending.

## Candidate PASS — 16 October 2026, Australia/Sydney

Deploy6ad0d8be6399b9cee0eb2f77, served /assets/index-D-81PCA_.js, V8.18 ·16Oct00:44; configuration probe200.

Admin claude-qa@crystocraft.com fresh password login PASS: dashboard96pipeline, Settings access,294/294figurine products713SKUs before/after refresh, no runtime errors. Existing packing7L0z8J3SiyjZ5KuunLDu (QU260709) PDF view and actual XLSX retain1200Set,7cartons,83.8kg,.5427CBM and new Q9Tier remarks. Existing PO mcsL3ayn8WbhpLu7FSWR /PU260073 PDF view and actual XLSX retain500pcs,unit price2,amount1000 and G11Tier remarks. Remark-bearing fixtures cover new behavior because existing live records have no saved tier remark. No business records edited. Screenshot logistics-remarks-candidate-admin.png.

Customer customer-qa@crystocraft.com fresh password login PASS: expected QA-only storefront,24figurine cards before/after refresh, Sacred Angel detail/finish prices, no admin/supplier/cost controls or runtime errors. Supplier PO print route redirected to /shop. Screenshot logistics-remarks-candidate-customer.png. Both QA sessions signed out; owner session preserved. Production verification pending.

## Production PASS — 16 October 2026 00:52 AEDT

Release598a57fc465ee4c2096307beaaafc99eec1c54fb, deploy6ad0d99a0929a04b249a4940 published00:49:04AEDT. Both production hostnames serve /assets/index-Dbm3trJy.js, V8.18 ·16Oct00:48; both Firebase configuration probes200. GitHub Actions run38745806290/job116459018911 completed success; logs confirm90tests (39+9+6+19+17), zero failures.

- Admin claude-qa@crystocraft.com fresh real-page password login PASS on Netlify production origin: correct dashboard96pipeline/Settings navigation, catalogue294/294products713SKUs and refresh, no runtime errors. Existing packing QU260709 and supplier PO PU260073 PDF views and actual Download Excel actions passed. Both live workbooks reopened/asserted: new Tier remarks headers at Q9/G11, original1200Set/83.8kg/.5427CBM and500pcs/amount1000 unchanged. New remark-bearing behavior verified by real-component offline fixtures because no live records were altered to fabricate remarks. Evidence logistics-remarks-production-admin.png.
- Customer customer-qa@crystocraft.com fresh real-page password login PASS: expected approved QA-only storefront,24cards before/after refresh, Sacred Angel detail/finish prices, no admin/supplier/cost controls or runtime errors. Supplier PO print URL redirected to /shop. Evidence logistics-remarks-production-customer.png.

Both QA sessions signed out; owner's working session preserved. Temporary fixture server stopped. No business record, rules, role/profile or supplier data changes. PO tier remarks require entry on the independent PO line; no quote/order-to-PO mapping was invented. Closure commit skips Netlify to preserve this verified app build.
