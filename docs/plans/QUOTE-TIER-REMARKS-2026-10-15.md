# V8.18 quotation PDF tier remarks

The supplied Mandy Pong PDF includes quantity/price tiers but omits each saved tier.remarks. QuoteDetail already saves this field; QuotePDF never rendered it. The PDF now groups each tier's quantity/unit, price, amount and optional remark together, printing the remark directly beneath its own price row. Shared tier groups preserve numeric alignment when remarks wrap. Product-level remarks and quote-wide notes remain separate. Numeric calculations, primary-tier grand total and selected units are unchanged; no quote data writes or migration.

Four added regressions verify tier association, blank remarks, quote/product notes, Chinese fallback selection and real multipage rendering of long/multiline remarks. Existing PDF unit checks remain. Full prebuild suite now74checks. Rendered fixture `/private/tmp/v818-evidence/quote-tier-remarks-regression.pdf` and PNG show wrapped remarks with aligned numbers and clear tier association.

Candidate and production verification pending.

## Candidate PASS — 15 October 2026

Code `728a86f`, verified deploy `6ad0ccaa92e342fe3b7ee1b2`, https://6ad0ccaa92e342fe3b7ee1b2--ua-product-manager.netlify.app; served `/assets/index-Cr1mvg2y.js`, V8.18 ·15Oct23:52; configuration probe200. All74 regressions, successful production build/lint and11configuration tests PASS. Initial build hit a managed-worktree write restriction and was rerun with correct access; only the successful rebuilt candidate was verified for publication.

Admin `claude-qa@crystocraft.com`: fresh password login/dashboard/Settings, catalogue294products/713SKUs, refresh and runtime PASS. Correct current Mandy Pong quote is `OVw097L6LEHJFvgtgdMF` (6items, Sent), distinct from earlier4-item draft. Actual candidate PDF download contains all12 tier remarks (each packaging note six times). Both pages rendered and inspected; photos, descriptions, numbers, units, payment snapshot, stamp and footer remain. Numeric financial-token counts and12 quantity/unit labels match the supplied PDF. No quote fields or show-total checkbox edited.

Customer `customer-qa@crystocraft.com`: fresh password login to approved QA-only home,24catalogue cards, Sacred Angel detail/prices, refresh, no private/admin controls and runtime PASS. Admin quote route redirects to shop. Both QA sessions signed out; owner session preserved. Screenshots/evidence under `/private/tmp/v818-evidence/`: tier-remarks-candidate-admin.png, tier-remarks-candidate-customer.png, mandy-tier-remarks-candidate.png, mandy-tier-remarks-candidate-page2.png. Rules/profiles unchanged.
