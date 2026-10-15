# V8.18 Excel quote quantity units

QuoteExport exported numeric quantities but omitted each line's saved product_unit. Every quantity tier now displays the selected unit through a custom number format; underlying quantities and prices stay numeric, preserving calculations. Older lines default to pcs as in the editor/PDF. No quote records, financial values, security rules or permissions changed.

Three automated tests click the actual Excel download and load the generated workbook. They cover all seven units, custom/catalogue lines, multi-tier quantities, decimal/zero/large values, arithmetic, legacy fallback and existing worksheet headers/geometry. They run in prebuild and GitHub Actions alongside39 search/filter tests and5 PDF tests. Build, no-undefined-reference lint and11 Firebase configuration tests pass.

Candidate and production role verification pending.

## Candidate PASS

Code2159c64, deploy6ad0abff2e090c7f79decfca, https://6ad0abff2e090c7f79decfca--ua-product-manager.netlify.app, served/assets/index-DTSI9z0s.js, V8.18 ·15Oct20:16. Configuration probe200.

Admin claude-qa@crystocraft.com: fresh password login to dashboard, Settings navigation, catalogue294products/713SKUs, refresh and runtime PASS. Actual Mandy Pong Excel download has numeric80 in E9:E12 with General plus pcs display format; prices90/94/47/70 unchanged. All four unit labels confirmed in independently rendered workbook print preview. Customer customer-qa@crystocraft.com: fresh password login to approved QA-only home, catalogue and Sacred Angel detail, refresh in correct shell, Settings redirected to shop, no admin/private controls and runtime PASS. Both QA sessions signed out; owner session preserved. Screenshots excel-units-candidate-admin.png, excel-units-candidate-customer.png, mandy-excel-candidate.png under/private/tmp/v818-evidence. Artifact-tool import/render was attempted but did not reproduce custom formatting/blank cells faithfully; LibreOffice print conversion independently confirmed correct actual workbook display. Excel desktop launch was unavailable; no workbook changes made there.
