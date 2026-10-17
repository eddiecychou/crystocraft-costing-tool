# New product/template and spec sheet navigation — 18 October 2026

## Implementation

Shared Projects / Design tools navigation added to New Product, New Template,
New Spec Sheet and Spec Sheet Detail/editor. It remains available during loading,
missing-record and no-reference-photo states. The new-template route selects
JSON templates even under /design/products; spec sheets select Gallery.
Navigation is hidden from print. Existing forms and save/AI actions are retained.

New Template analysis/JSON columns and the spec editor stack on narrow screens.
The spec preview scrolls within its own container; its full-resolution layout,
PNG generation target and print stylesheet are unchanged. Missing product/sheet
lookups now show the missing-record view rather than staying on Loading.

Work used /private/tmp/costing-summary-release on isolated branch
codex/design-create-spec-navigation, based on upstream
eb02ced76f7e780215808253aa817d6e31f59e4c. Original dirty checkout untouched.
App source: e5469120119122cee809b22ba9df55c45149218b.

## Verification

- Full production build and all prebuild checks PASS, including 350 Node tests,
  zero failures, plus existing standalone/Python checks.
- Product Design tests: 42 PASS, mounting actual pages with fictional reads and
  blocked writers, including missing/no-photo/loading states and selected tools.
  Included in existing GitHub Actions via test:design-projects.
- Firebase login configuration: 11 PASS. Navigation no-undef lint and diff check
  PASS.
- Browser layout audit: 52 PASS (13 actual pages × 320/375/414/1280 CSS pixels),
  with fictional reads only. Checks overflow, alignment, selected routes, 44px
  navigation targets, disclosure and Projects return. Viewport tests, not a
  claim of physical-device testing.
- Branch Actions 39057485526 SUCCESS.

## Candidate — PASS

Netlify site ua-product-manager (4a234708-a213-477f-91a5-97cdc939c1db), deploy
6ad3bbee80c125d574dd9295 at
https://dsh-images-20261018--ua-product-manager.netlify.app .
Served bundle /assets/index-s8exC32D.js; sidebar 18 Oct 02:17 HKT.
Firebase project crystocraft-costing, served-config probe HTTP200 (supplemental).

Admin claude-qa@crystocraft.com: fresh email/password sign-in PASS, /dashboard
and Settings/Portal admin shell PASS, reload PASS. Range catalogue 297/297 and
722 SKUs loaded. New Product, New Template and New Spec Sheet opened read-only;
selected tools, disclosure, switch to JSON templates and return to Projects
PASS. Live missing-spec route shows Spec sheet not found with Gallery selection
and working Projects return. No runtime errors before sign-out.

No existing spec-sheet link was found among the three current design sources.
The populated saved-sheet editor was therefore tested with the actual component
and fictional fixture, plus its live missing-record route. No live spec record
was created to manufacture a test. No Save, Analyze, upload, export or print
was invoked on production data.

Customer customer-qa@crystocraft.com: fresh email/password sign-in in a separate
clean tab PASS to /shop, approved QA-only storefront and reload PASS. Catalogue
and Mini Butterfly Music Box detail loaded; Chrome USD12.51, Gold USD12.84,
~9-week/MOQ100 information present. Admin Settings absent; direct New Product
route redirects to /shop. Runtime error log empty before sign-out. QA tabs closed.

## Production — PASS

https://portal.crystocraft.com, deploy 6ad3bcb8a910da0f6c41e8f3, source
e5469120119122cee809b22ba9df55c45149218b, published 18 Oct 2026 02:22:52 HKT.
Served bundle /assets/index-jfD1wPFD.js; sidebar 18 Oct 02:22 HKT.
Firebase project crystocraft-costing, served-config probe HTTP200 (supplemental).
Main Actions 39057745256 SUCCESS.

Admin claude-qa@crystocraft.com: fresh email/password sign-in to /dashboard
PASS; Settings/Portal/admin shell, reload and Range catalogue 297/297 products,
722 SKUs PASS. Opened New Product, New Template, New Spec Sheet and missing-spec
route without saving. Correct Gallery/JSON templates selection, menu collapse
and reopen, tool navigation, and Projects returns PASS. Missing spec correctly
shows not found. Runtime error log empty before sign-out.

Customer customer-qa@crystocraft.com: fresh email/password sign-in in separate
clean QA tab to /shop PASS; approved QA-only profile, reload, catalogue and Mini
Butterfly Music Box detail PASS. Chrome USD12.51, Gold USD12.84, ~9 weeks and
MOQ100 remain visible. No Settings/admin links; direct /design/products/new
redirects to /shop. Runtime error log empty before sign-out.

All required candidate and production login gates PASS on the published build.
QA tabs signed out/closed; temporary local preview server stopped. The populated
saved-spec editor coverage is from the actual-page fictional fixture, not a
newly created live record. Evidence is a separate documentation-only commit
with [skip netlify] so the verified application build remains published.

## Separate states and evidence

No Firebase rules, QA identities/permissions or environment variables changed.
No live product/template/spec sheet created, edited, published or deleted.
Original checkout status fingerprint remains
fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846.

Evidence:
/Users/eddie/.codex/visualizations/2026/10/14/01a13b22-c93b-79f2-9f8b-551754486033/create-spec-navigation-2026-10-18 .
