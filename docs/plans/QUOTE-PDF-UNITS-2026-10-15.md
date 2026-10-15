# V8.18 quote PDF quantity units

The supplied Mandy Pong export prints numeric quantities only. QuoteDetail already saves the chosen unit on each line's `product_unit`; QuotePDF omitted that field. The PDF now prints the saved unit beside each quantity tier, defaulting to pcs for older lines exactly as the editor does. The quantity column gains24pt from the description column, preserving the total table width and price/amount alignment. Snapshot values, prices and totals remain unchanged; no quote/catalogue data migration or rules changes.

Five regressions inspect the actual PDF component for all seven selectable units, multi-tier labels, legacy fallback and primary-tier totals, and generate a real mixed-unit PDF using local brand fonts. The suite runs before builds and in GitHub Actions. All39 existing search/quote/filter checks and5 PDF checks passed; production build and no-undefined-reference lint passed. Extracted PDF text and a rendered PNG confirmed units from80pcs through10000pair remain legible and aligned with prices/amounts. Evidence `/private/tmp/v818-evidence/quote-units-regression.pdf` and `.png`.

Candidate and production verification follows.

## Candidate PASS

Code `6f48db6`; deploy `6ad094bb7273a370c0714c46`, https://6ad094bb7273a370c0714c46--ua-product-manager.netlify.app. Served `/assets/index-Ba2xOBCb.js`, V8.18 ·15Oct19:53; Firebase configuration probe200.

Admin `claude-qa@crystocraft.com`: fresh password login/dashboard, admin Settings navigation, catalogue294products/713SKUs and refresh PASS. Real Mandy Pong PDF downloaded through the actual Export button; text and rendered page show80pcs on all4rows, original amounts7200/7520/3760/5600 and photos preserved. Quote fields/units not edited. No runtime errors. Existing react-pdf browser Buffer warnings did not prevent a complete PDF with images. Download event wait timed out in automation, but the saved Downloads file confirmed successful export; inspected that actual file.

Customer `customer-qa@crystocraft.com`: fresh password login to approved QA-only customer home, catalogue and Sacred Angel detail load, refresh retains storefront, Settings redirects to shop, no private/admin controls or runtime errors. Screenshots `quote-units-candidate-admin.png`, `quote-units-candidate-customer.png` and `mandy-quote-units-candidate.png` under `/private/tmp/v818-evidence/`. Roles, accounts and rules unchanged.

## Production PASS — 15 October, 20:05 AEDT

Deploy `6ad095e3fa816786c0d0c489`, release commit `55d8a9a601f84c3afce7e0c8f6c7e75c103cb55c`, published20:00:03 AEDT. Both production hostnames serve `/assets/index-DO05s1-Z.js`, V8.18 ·15Oct19:59, config probes200. QA uses the Netlify production hostname to preserve the owner's separate working session on portal.crystocraft.com.

- Admin `claude-qa@crystocraft.com`: fresh password sign-in, dashboard data and Settings access, live catalogue data and refresh in correct shell PASS. Production Mandy Pong Export → Download PDF completed. Both PDF pages rendered and inspected: all4quantities show80pcs; prices/amounts, photos, bank details and signature/stamp remain. Text-token comparison after removing the4 added unit labels matches the supplied PDF; extraction order differs because of column width. No runtime errors; existing non-fatal react-pdf Buffer warnings as on candidate. No quote fields, units, tiers or product data changed.
- Customer `customer-qa@crystocraft.com`: fresh password sign-in to approved QA-only home, catalogue and detail load, refresh remains customer shell, Settings redirects to shop, no admin/private data or runtime errors PASS.
- GitHub Actions run https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38709607556 PASS, including39 search/quote/filter checks and5 PDF checks. PDF checks also pass under local Node20. No Firebase rules deployment/access changes.

Corrected real production export: `output/pdf/Mandy Pong - 2026-10-15 - units.pdf` (ignored local deliverable). Evidence under `/private/tmp/v818-evidence/`: `quote-units-production-admin.png`, `quote-units-production-customer.png`, `mandy-quote-units-production-1.png`, `mandy-quote-units-production-2.png`. Completed QA sessions signed out; owner session preserved. Closure commit skips Netlify to retain the verified app build.
