# V8.18 quote PDF quantity units

The supplied Mandy Pong export prints numeric quantities only. QuoteDetail already saves the chosen unit on each line's `product_unit`; QuotePDF omitted that field. The PDF now prints the saved unit beside each quantity tier, defaulting to pcs for older lines exactly as the editor does. The quantity column gains24pt from the description column, preserving the total table width and price/amount alignment. Snapshot values, prices and totals remain unchanged; no quote/catalogue data migration or rules changes.

Five regressions inspect the actual PDF component for all seven selectable units, multi-tier labels, legacy fallback and primary-tier totals, and generate a real mixed-unit PDF using local brand fonts. The suite runs before builds and in GitHub Actions. All39 existing search/quote/filter checks and5 PDF checks passed; production build and no-undefined-reference lint passed. Extracted PDF text and a rendered PNG confirmed units from80pcs through10000pair remain legible and aligned with prices/amounts. Evidence `/private/tmp/v818-evidence/quote-units-regression.pdf` and `.png`.

Candidate and production verification follows.

## Candidate PASS

Code `6f48db6`; deploy `6ad094bb7273a370c0714c46`, https://6ad094bb7273a370c0714c46--ua-product-manager.netlify.app. Served `/assets/index-Ba2xOBCb.js`, V8.18 ·15Oct19:53; Firebase configuration probe200.

Admin `claude-qa@crystocraft.com`: fresh password login/dashboard, admin Settings navigation, catalogue294products/713SKUs and refresh PASS. Real Mandy Pong PDF downloaded through the actual Export button; text and rendered page show80pcs on all4rows, original amounts7200/7520/3760/5600 and photos preserved. Quote fields/units not edited. No runtime errors. Existing react-pdf browser Buffer warnings did not prevent a complete PDF with images. Download event wait timed out in automation, but the saved Downloads file confirmed successful export; inspected that actual file.

Customer `customer-qa@crystocraft.com`: fresh password login to approved QA-only customer home, catalogue and Sacred Angel detail load, refresh retains storefront, Settings redirects to shop, no private/admin controls or runtime errors. Screenshots `quote-units-candidate-admin.png`, `quote-units-candidate-customer.png` and `mandy-quote-units-candidate.png` under `/private/tmp/v818-evidence/`. Roles, accounts and rules unchanged.
