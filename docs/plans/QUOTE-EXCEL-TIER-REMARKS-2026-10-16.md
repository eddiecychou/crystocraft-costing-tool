# V8.18 quotation Excel tier remarks

QuoteExport did not read tier.remarks. Added a Tier remarks column (G) beside the existing numeric quantity/unit (E) and price (F), with one unmerged remark cell per tier. Text wraps with row height allowance; whitespace-only remarks leave a blank cell. Numeric types, selected-unit number format, product/photo/description merging and source snapshots remain unchanged. Header/footer spans now cover the new column. No quote data writes, migration or permission changes.

Three added real-download XLSX regression tests cover correct tier/product association, unmerged remark cells, wrapped long/multiline/Chinese text, literal formula-like strings, blanks and retained numeric quantities/prices. The existing suites bring prebuild/CI to77checks. Fixture workbook inspected with ExcelJS, artifact-tool and independent LibreOffice print conversion; visual review added a small indent to separate remarks from right-aligned prices.

Candidate and production verification pending.
