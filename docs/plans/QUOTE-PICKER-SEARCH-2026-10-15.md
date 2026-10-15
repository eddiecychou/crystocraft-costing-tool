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
