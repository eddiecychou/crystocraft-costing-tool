# V8.18 quote picker search repair — 15 October 2026

## Cause and change

The Gift Range picker used product ID + SKU as both React row identity and selection identity. A read-only catalogue audit found 713 variant rows across 294 designs, with 129 repeated SKU rows across 79 designs. Repeated SKUs may have distinct prices/brands. In a local browser reproduction, searching `ball` retained a Butterfly row and React reported duplicate child keys.

Rows now include the exact source variant index in their identity, matching the index already snapshotted in existing quote lines. Indexed existing lines exclude only their own variant; older SKU-only lines conservatively exclude that SKU without guessing a variant. Variant details are visible alongside SKU/category/price. Design-code search now receives the design code. No catalogue/quote data migration or security-rule change.

## Local verification

- 53/53 domain/config regressions passed, including five new quote-search/identity tests and existing quote currency/PI checks.
- Production build and no-undefined-reference lint passed; existing large-bundle advisory remains.
- Browser mock reproduced the failure before the change. Afterward: repeated `ball`, clear, uppercase/whitespace, design-code, exact-SKU and no-match searches passed; corporate search and mixed-catalogue selection passed. Same-SKU Bohemia USD4.11 and Asfour USD3.61 remained independently selected with their original prices. No duplicate-key/browser errors after repair.
- Live Mandy Pong quote left unchanged. Fixture selections are memory-only.

Candidate/production evidence follows after verification.

## Candidate PASS — 15 October, 18:53 AEDT

- Code commit `8e65273`; candidate `6ad0850a7b6b8238510ce9b0`, `https://6ad0850a7b6b8238510ce9b0--ua-product-manager.netlify.app`.
- Served `/assets/index-Cc-KAUA2.js`, V8.18 · 15 Oct 18:46; public Firebase config probe HTTP200.
- Admin `claude-qa@crystocraft.com`: fresh real-page password login to dashboard, admin Settings/Portal navigation present, loaded catalogue294/294 and713SKUs, refresh retained admin shell. Existing Mandy Pong quote read only: empty query713 rows, `ball`12, repeated-SKU `D0006-001-C`2, impossible query0, uppercase/padded `BALL`12. Zero selections/additions/saves. No console errors. Evidence `/private/tmp/v818-evidence/quote-candidate-admin.png`, `quote-candidate-search.png`.
- Customer `customer-qa@crystocraft.com`: fresh real-page password login to QA-only customer home; customer catalogue/detail loaded, Hymn Book stock G50/max50 and no sold-out Chrome choice, refresh retained storefront, `/settings` redirected to `/shop`; no admin navigation/private costs/internal notes or console errors. Evidence `/private/tmp/v818-evidence/quote-candidate-customer.png`.
- Secure availability parity/privacy API check passed independently for both Sacred Angel products, including per-finish lead times; anonymous401/private components403. Rules unchanged.
