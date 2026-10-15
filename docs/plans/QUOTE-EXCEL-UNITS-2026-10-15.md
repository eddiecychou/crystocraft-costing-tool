# V8.18 Excel quote quantity units

QuoteExport exported numeric quantities but omitted each line's saved product_unit. Every quantity tier now displays the selected unit through a custom number format; underlying quantities and prices stay numeric, preserving calculations. Older lines default to pcs as in the editor/PDF. No quote records, financial values, security rules or permissions changed.

Three automated tests click the actual Excel download and load the generated workbook. They cover all seven units, custom/catalogue lines, multi-tier quantities, decimal/zero/large values, arithmetic, legacy fallback and existing worksheet headers/geometry. They run in prebuild and GitHub Actions alongside39 search/filter tests and5 PDF tests. Build, no-undefined-reference lint and11 Firebase configuration tests pass.

Candidate and production role verification pending.
