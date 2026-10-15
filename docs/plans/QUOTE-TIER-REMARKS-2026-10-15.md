# V8.18 quotation PDF tier remarks

The supplied Mandy Pong PDF includes quantity/price tiers but omits each saved tier.remarks. QuoteDetail already saves this field; QuotePDF never rendered it. The PDF now groups each tier's quantity/unit, price, amount and optional remark together, printing the remark directly beneath its own price row. Shared tier groups preserve numeric alignment when remarks wrap. Product-level remarks and quote-wide notes remain separate. Numeric calculations, primary-tier grand total and selected units are unchanged; no quote data writes or migration.

Four added regressions verify tier association, blank remarks, quote/product notes, Chinese fallback selection and real multipage rendering of long/multiline remarks. Existing PDF unit checks remain. Full prebuild suite now74checks. Rendered fixture `/private/tmp/v818-evidence/quote-tier-remarks-regression.pdf` and PNG show wrapped remarks with aligned numbers and clear tier association.

Candidate and production verification pending.

## Candidate PASS — 15 October 2026

Code `728a86f`, verified deploy `6ad0ccaa92e342fe3b7ee1b2`, https://6ad0ccaa92e342fe3b7ee1b2--ua-product-manager.netlify.app; served `/assets/index-Cr1mvg2y.js`, V8.18 ·15Oct23:52; configuration probe200. All74 regressions, successful production build/lint and11configuration tests PASS. Initial build hit a managed-worktree write restriction and was rerun with correct access; only the successful rebuilt candidate was verified for publication.

Admin `claude-qa@crystocraft.com`: fresh password login/dashboard/Settings, catalogue294products/713SKUs, refresh and runtime PASS. Correct current Mandy Pong quote is `OVw097L6LEHJFvgtgdMF` (6items, Sent), distinct from earlier4-item draft. Actual candidate PDF download contains all12 tier remarks (each packaging note six times). Both pages rendered and inspected; photos, descriptions, numbers, units, payment snapshot, stamp and footer remain. Numeric financial-token counts and12 quantity/unit labels match the supplied PDF. No quote fields or show-total checkbox edited.

Customer `customer-qa@crystocraft.com`: fresh password login to approved QA-only home,24catalogue cards, Sacred Angel detail/prices, refresh, no private/admin controls and runtime PASS. Admin quote route redirects to shop. Both QA sessions signed out; owner session preserved. Screenshots/evidence under `/private/tmp/v818-evidence/`: tier-remarks-candidate-admin.png, tier-remarks-candidate-customer.png, mandy-tier-remarks-candidate.png, mandy-tier-remarks-candidate-page2.png. Rules/profiles unchanged.

## Production PASS — 16 October 2026

Deploy `6ad0cdc17257a29d7201e8d3`, release commit `1cc802aca40ef3f38f3ef2112122926def86027e`, published15Oct23:58:25AEDT. Both production hostnames serve `/assets/index-DeTrMg2K.js`, V8.18 ·15Oct23:57; both configuration probes200.

- Admin `claude-qa@crystocraft.com`: fresh real password login/dashboard/Settings, catalogue294products/713SKUs, refresh and runtime PASS. Real production download from the6-item Mandy Pong sent quote contains both saved tier remarks on each product:12remarks total. Both pages rendered and visually inspected; number alignment, all6photos, descriptions, bank details, signature/stamp and footer remain correct. Financial numeric-token counts and12 quantity/unit labels match the supplied PDF. No quote edits or total-toggle changes.
- Customer `customer-qa@crystocraft.com`: fresh real password login to approved QA-only home,24catalogue cards, Sacred Angel detail/prices, refresh in correct shell and no runtime errors PASS. Admin quote route redirects to shop; no private/admin controls. Both QA sessions signed out; owner session preserved.
- GitHub Actions https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38738701870 PASS:39search/filter,9quote PDF,3quote Excel,13invoice and10packing/PO checks =74passed,0failed. Successful production build/lint and11configuration checks passed separately. No rules, roles, profiles or data changes.

Corrected actual production PDF saved as `output/pdf/Mandy Pong - 2026-10-15 - tier remarks.pdf` (ignored deliverable). Evidence under `/private/tmp/v818-evidence/`: tier-remarks-production-admin.png, tier-remarks-production-customer.png, mandy-tier-remarks-production-1.png, mandy-tier-remarks-production-2.png. Closure documentation skips Netlify to keep the verified production build current.
