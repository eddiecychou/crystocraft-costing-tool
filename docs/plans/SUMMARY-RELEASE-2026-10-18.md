# Summary windows release — 18 October 2026

Owner authorized summary push/deployment and fresh admin/customer verification.

## Exact release

- Source: `4cbaddf06b4ede6397ac527a195708920bc64373` on `codex/summary-release-20261018`, fast-forwarded to main.
- Base: current upstream `6abec8af`; local importer commits `24603316` / `c40f0d5f` excluded.
- Candidate: `6ad391dcaef40bd78dd9be20`, https://6ad391dcaef40bd78dd9be20--ua-product-manager.netlify.app .
- Candidate bundle: `/assets/index-CiAmg8FT.js`; sidebar V8.18 · 17 Oct, 23:18 HKT.
- Netlify site: `4a234708-a213-477f-91a5-97cdc939c1db` (`ua-product-manager`).
- Production deploy: `6ad392d24670db5048ba0b99`, published 17 October 2026 23:23:58 HKT (15:23:58 UTC).
- Production bundle: `/assets/index-7KhU8RnF.js`; sidebar V8.18 · 17 Oct, 23:23 HKT.

## Checks before publication — PASS

- Clean upstream-based worktree production build and all prebuild suites passed.
- Summary regression suite: 16 passed, including large sources, split recovery, missing/duplicate/foreign IDs, malformed/truncated replies and all-or-nothing cache preservation.
- Firebase login config suite: 11 passed; no-undef lint and whitespace checks passed.
- Firestore/Storage RBAC: 112 passed; Pipeline emulator: 8 passed; real Dashboard/CustomerDetail: 21 passed.
- Follow-ups Due timezone suite: 11 cases in each of UTC, Sydney and Los Angeles passed.
- Branch Actions `39044481983`: success.
- Candidate served Firebase config probe: HTTP 200 (supplemental, not login proof).
- Authenticated candidate AI endpoint: 180-day and 365-day fictional requests both HTTP 200, complete matching customer ID and factual summary. No Firestore/cache writes; no real customer conversation sent to AI.

## Candidate role gates — PASS

Fresh email/password sign-ins from signed-out dedicated QA tabs; owner browser untouched.

- Admin: `claude-qa@crystocraft.com` → `/dashboard`, admin sidebar with Settings/Portal; Dashboard data loaded (3 due, 20 Pipeline, 11 production, 13 orders). Both 180/365 choices selected without error; year selection persisted after refresh. QA customer page `/customers/qa_customer_release_testing` offers and selects both periods. Admin Range 297/297 products, 722 SKUs. No console errors.
- Approved customer: `customer-qa@crystocraft.com` → `/shop`, QA company label; Range 295 designs. Mini Butterfly Music Box detail loaded Chrome USD12.51 / Gold USD12.84 and ~9 weeks/MOQ100. Refresh kept customer shell. No admin/CRM/cost controls; `/settings` redirected to `/shop`. No console errors. QA signed out after tests.
- Evidence screenshots: candidate-admin.png and candidate-customer.png in the task's `summary-release-2026-10-18` artifact folder.

## Firebase rules — released separately

Rules compiled, uploaded and released to `crystocraft-costing` before main push.
Only existing Pipeline source-cache allowlist gained `customer_summary_180` and `customer_summary_365`; no role/data visibility changes.
Firestore SHA256 `bdb17d665871f01a2726f01c6ccc8d623a29c432274412053dc1f6a710f04548`.
Storage unchanged/not deployed, SHA256 `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`.

## Production gates

PASS — repeated after the current production deployment at approximately 23:24–23:27 HKT, 17 October 2026.

- Admin `claude-qa@crystocraft.com`: fresh email/password sign-in → `/dashboard`; expected admin navigation and data. Both new periods selected on Dashboard and QA customer detail. Year selection persisted after reload. Admin Range 297/297 products, 722 SKUs; no runtime errors.
- Approved customer `customer-qa@crystocraft.com`: fresh email/password sign-in → `/shop` with expected QA company. Range 295 designs. Mini Butterfly Music Box detail loaded prices Chrome USD12.51 / Gold USD12.84 and ~9 weeks/MOQ100. Reload preserved customer shell and data. No admin/cost/internal-note controls. `/settings` redirected to `/shop`; no console errors. QA signed out after checks.
- Served-bundle Firebase configuration probe HTTP200; real browser sign-ins above independently verified authentication.
- Authenticated production AI endpoint: 180-day and 365-day fictional requests both HTTP200 and complete factual summaries, including completed first order and separate outstanding repeat pricing. No Firestore/cache saves.
- Main Actions `39044794919`: completed success; branch Actions `39044481983`: completed success.
- Evidence: production-admin.png, production-customer.png, synthetic API results and verification logs in the task artifact folder.
- Firestore rules and app release PASS. Storage rules were not changed/deployed. Original dirty checkout status hash remained `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`.

This evidence-only follow-up uses `[skip netlify]`; deployed application source remains `4cbaddf06b4ede6397ac527a195708920bc64373`.

## Data boundary

No customer summary refresh, Pipeline suggestion/confirmation, customer task/note change, marketing send, live test catalogue record, or import job execution was part of this release. New period caches remain empty until an operator chooses Update AI summaries. Fictional emulator data proves cache selection and saves without production data changes. Existing customer summary caches and all other customer records remain intact apart from normal sign-in activity stamps.
