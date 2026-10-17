# Product and template detail navigation — 18 October 2026

## Scope

Shared Projects / Design tools navigation is now present on Product Detail,
Product Edit, Template Detail and Template Edit, including loading and missing
records. Gallery and JSON templates retain their selected-section indicators.
Product Edit's form keeps its narrower width while navigation uses the page
width. Template source/editor columns stack on phones; detail actions wrap.
No save, upload, generation, catalogue publication, access or data model changes.

The original dirty checkout was untouched. Work used the isolated
`/private/tmp/costing-summary-release`, branch `codex/design-detail-navigation`,
based on upstream `ff2c2dcc5f7fe1c36f7c4db684848f38ffa38c88`.
App source: `f011386b25b06478e3a8318c6048512e0ba1658a`.

## Automated and responsive verification

- Full production build and all prebuild checks passed; 338 Node tests, zero
  failures, plus existing standalone/Python checks.
- Product Design suite: 30 tests. Actual pages with fictional reads and blocked
  writers, selected routes, disclosure, Projects return, loading/missing states.
  Included in the existing GitHub Actions check via `test:design-projects`.
- Firebase login configuration suite: 11 passed; whitespace check passed.
- Real browser layout audit: 36 PASS across nine actual pages at 320, 375, 414,
  and 1280 CSS pixels. Checks page overflow, aligned navigation, 44px targets,
  selected tool, disclosure and Projects return. This is viewport testing,
  not a claim of physical-device testing. Fixture has no production connection.
- Branch Actions: run 39056430341 SUCCESS.

## Candidate — PASS

Netlify site ua-product-manager, `4a234708-a213-477f-91a5-97cdc939c1db`.
Deploy `6ad3b879b4ffcaa5c7bcf1fb` at
https://dsh-images-20261018--ua-product-manager.netlify.app .
Served bundle `/assets/index-D6jkcYIE.js`, sidebar 18 Oct 02:03 HKT.
Firebase project crystocraft-costing, configuration probe HTTP 200.

Admin `claude-qa@crystocraft.com`: fresh email/password sign-in PASS; dashboard,
Settings/Portal admin shell, reload and Range catalogue (297/297, 722 SKUs)
PASS. Existing product Hqvt7OcMz7pcjOvTFz2a and template
oi2XbiNU4q7jdyS99Frz detail/edit pages loaded, correct section selected,
Projects return PASS; no runtime errors during admin checks. No edits/saves.

Customer `customer-qa@crystocraft.com`: fresh email/password sign-in in a separate
clean QA tab PASS; approved QA-only storefront, reload, catalogue and Mini
Butterfly Music Box detail PASS. Chrome USD12.51, Gold USD12.84 and ~9-week/MOQ100
information present. No admin Settings link; direct admin template-edit route
redirected to /shop. No runtime errors in this clean-tab verification.
An earlier same-tab admin-to-customer transition produced a permissions log;
that mixed-role tab was discarded and the full customer gate repeated from a
fresh sign-in in a new tab, as required by the release workflow.

## Production — PASS

https://portal.crystocraft.com, Netlify deploy `6ad3b96ff5ff26b220777d1c`,
published 18 October 2026 02:08:39 HKT from source
`f011386b25b06478e3a8318c6048512e0ba1658a`.
Served bundle `/assets/index-VjbUSv_x.js`, sidebar 18 Oct 02:08 HKT.
Firebase configuration probe HTTP 200 (supplemental, not a sign-in claim).

Admin `claude-qa@crystocraft.com`: fresh email/password sign-in PASS to
/dashboard, Settings/Portal/admin shell present, reload PASS, Range catalogue
297/297 products/722 SKUs PASS. Both existing product detail/edit and template
detail/edit loaded with correct selected tool. Tools collapse/reopen, switch to
JSON templates and return from template editor to Projects PASS. No saves,
uploads, generation or publication; runtime error log empty before sign-out.

Customer `customer-qa@crystocraft.com`: fresh email/password sign-in in its own
clean tab PASS to /shop, approved QA-only storefront and reload PASS. Range
catalogue and Mini Butterfly Music Box detail PASS; Chrome USD12.51, Gold
USD12.84, ~9-week lead time and MOQ100 present. Settings/admin controls absent;
direct template-edit route redirected to /shop. Runtime error log empty before
sign-out. Both QA tabs signed out and closed.

Main Actions run 39056737141 SUCCESS. All candidate and production role gates
PASS on this published app. Release evidence/README are committed separately
with [skip netlify] to keep the verified app build in production.

## Separate infrastructure state

No Firebase rules, permissions, QA identities or environment variables changed.
Firestore SHA256 bdb17d665871f01a2726f01c6ccc8d623a29c432274412053dc1f6a710f04548;
Storage SHA256 94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c.
Original checkout status fingerprint unchanged:
fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846.

Evidence folder:
`/Users/eddie/.codex/visualizations/2026/10/14/01a13b22-c93b-79f2-9f8b-551754486033/product-template-navigation-2026-10-18`.
