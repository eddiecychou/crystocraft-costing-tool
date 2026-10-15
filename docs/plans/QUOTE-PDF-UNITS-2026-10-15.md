# V8.18 quote PDF quantity units

The supplied Mandy Pong export prints numeric quantities only. QuoteDetail already saves the chosen unit on each line's `product_unit`; QuotePDF omitted that field. The PDF now prints the saved unit beside each quantity tier, defaulting to pcs for older lines exactly as the editor does. The quantity column gains24pt from the description column, preserving the total table width and price/amount alignment. Snapshot values, prices and totals remain unchanged; no quote/catalogue data migration or rules changes.

Five regressions inspect the actual PDF component for all seven selectable units, multi-tier labels, legacy fallback and primary-tier totals, and generate a real mixed-unit PDF using local brand fonts. The suite runs before builds and in GitHub Actions. All39 existing search/quote/filter checks and5 PDF checks passed; production build and no-undefined-reference lint passed. Extracted PDF text and a rendered PNG confirmed units from80pcs through10000pair remain legible and aligned with prices/amounts. Evidence `/private/tmp/v818-evidence/quote-units-regression.pdf` and `.png`.

Candidate and production verification follows.
