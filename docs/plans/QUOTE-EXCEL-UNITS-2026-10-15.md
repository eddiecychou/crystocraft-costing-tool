# V8.18 Excel quote quantity units

QuoteExport exported numeric quantities but omitted each line's saved product_unit. Every quantity tier now displays the selected unit through a custom number format; underlying quantities and prices stay numeric, preserving calculations. Older lines default to pcs as in the editor/PDF. No quote records, financial values, security rules or permissions changed.

Three automated tests click the actual Excel download and load the generated workbook. They cover all seven units, custom/catalogue lines, multi-tier quantities, decimal/zero/large values, arithmetic, legacy fallback and existing worksheet headers/geometry. They run in prebuild and GitHub Actions alongside39 search/filter tests and5 PDF tests. Build, no-undefined-reference lint and11 Firebase configuration tests pass.

Candidate and production role verification pending.

## Candidate PASS

Code2159c64, deploy6ad0abff2e090c7f79decfca, https://6ad0abff2e090c7f79decfca--ua-product-manager.netlify.app, served/assets/index-DTSI9z0s.js, V8.18 ·15Oct20:16. Configuration probe200.

Admin claude-qa@crystocraft.com: fresh password login to dashboard, Settings navigation, catalogue294products/713SKUs, refresh and runtime PASS. Actual Mandy Pong Excel download has numeric80 in E9:E12 with General plus pcs display format; prices90/94/47/70 unchanged. All four unit labels confirmed in independently rendered workbook print preview. Customer customer-qa@crystocraft.com: fresh password login to approved QA-only home, catalogue and Sacred Angel detail, refresh in correct shell, Settings redirected to shop, no admin/private controls and runtime PASS. Both QA sessions signed out; owner session preserved. Screenshots excel-units-candidate-admin.png, excel-units-candidate-customer.png, mandy-excel-candidate.png under/private/tmp/v818-evidence. Artifact-tool import/render was attempted but did not reproduce custom formatting/blank cells faithfully; LibreOffice print conversion independently confirmed correct actual workbook display. Excel desktop launch was unavailable; no workbook changes made there.

## Production PASS — 15 October 2026, 21:42 AEDT

Deploy `6ad0acdab474e5dcea19cfcb`, release commit `84ec8d5698cd11ab9ce315cd0b8f87004ed4a243`, published 21:38:01 AEDT. Both production hostnames serve `/assets/index-FM61OcPc.js`, V8.18 · 15 Oct, 21:37; configuration probes returned200. QA used the Netlify production hostname to preserve the owner's portal session.

- Admin `claude-qa@crystocraft.com`: fresh real password sign-in, dashboard data, Settings access, catalogue294products/713SKUs, refresh and runtime PASS. Actual production Excel download contains four numeric80 quantities, each formatted with pcs, and numeric prices90/94/47/70. Five embedded images (logo plus four products) remain. Independent print conversion and both rendered pages confirm unit labels, images, pricing, payment snapshot and footer. Quote fields/tiers/units were not edited.
- Customer `customer-qa@crystocraft.com`: fresh real password sign-in to approved QA-only home, catalogue24 rendered cards, Sacred Angel detail and prices, refresh in correct shell, Settings redirected to shop, no admin/private controls and runtime PASS. Both completed QA sessions signed out; owner session preserved.
- GitHub Actions https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38721559523 PASS:39search/filter checks,5PDF checks,3Excel checks;47passed,0failed. Production build and lint passed;11configuration tests passed separately. No Firebase rules or permission changes.

Evidence in `/private/tmp/v818-evidence/`: `excel-units-production-admin.png`, `excel-units-production-customer.png`, `mandy-excel-production-1.png`, `mandy-excel-production-2.png`. Corrected actual production download saved to `outputs/01a13b22-c93b-79f2-9f8b-551754486033/Mandy Pong - 2026-10-15 - units.xlsx` (ignored deliverable). Closure commit skips Netlify to retain the verified app build.
