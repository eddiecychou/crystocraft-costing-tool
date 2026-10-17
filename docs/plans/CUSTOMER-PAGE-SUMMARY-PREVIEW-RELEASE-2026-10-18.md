# Customer-page summary previews — 18 October 2026

Owner authorized implementation, tests and deployment. Original dirty checkout
unchanged; isolated branch `codex/customer-summary-preview` in
`/private/tmp/costing-summary-release` based on upstream `a5a3f654`.

## Source and behavior

App source `96c78d40896e4508b4e88b190b3d81bfce33466e`.
Customer Detail enables the existing approximately500-character Show more/Show
less preview for the combined Customer Summary & To-do. Shared SummaryText also
previews individual email/WhatsApp/Alibaba summary and recent-activity text.
Short and empty values need no button; null channel text is safe. Task/note
controls, open commitments, source history and summary metadata remain visible.
Full text is already loaded; toggles do not generate AI, import messages or save
data. Changed summaries reset expansion. Existing Dashboard behavior retained.

## Automated checks — PASS

- Workspace/domain suite73 passed. Actual component tests cover both page modes,
  full expansion/collapse, retained task controls, independent channel previews,
  commitments retained, null/short values, refreshed summary/window reset and page
  wiring for all three channels.
- Full prebuild and production build passed (Node-runner totals317; standalone
  and Python suites also executed). Firebase configuration suite11 passed.
- Required no-undef lint on changed components and whitespace checks passed.
- Branch Actions `39049540953` completed/success before main push.

## Candidate — PASS

- Netlify site `4a234708-a213-477f-91a5-97cdc939c1db`, deploy `6ad3a230d0087c414c28b8cc`; existing QA alias https://dsh-images-20261018--ua-product-manager.netlify.app .
- Served bundle `/assets/index-BmNxJ1El.js`, V8.18 · 18 Oct, 00:27 HKT. Served Firebase configuration probe200, separately from actual sign-in evidence.
- Fresh admin email/password sign-in `claude-qa@crystocraft.com` → `/dashboard`, correct Settings/Portal/admin shell. Actual customer record `/customers/WfSo1i560L4wRsj9vyj9` combined one-year summary expanded495→652characters, collapsed back to identical495characters, Add task visible. Reload retained customer page/admin shell. Individual email text499characters and recent activity280characters displayed fully with no unnecessary toggle. Range297/297products,722SKUs loaded; no console errors. Signed out.
- Fresh approved-customer email/password sign-in `customer-qa@crystocraft.com` → `/shop`, correct QA-only identity. Range295designs; Mini Butterfly Music Box detail/reload, ChromeUSD12.51 / GoldUSD12.84 and ~9weeks/MOQ100 passed. No admin/cost/internal-note controls. Direct internal customer-record URL redirected to `/shop`; no console errors. Signed out.
- Screenshots candidate-customer-page.png, candidate-admin.png, candidate-customer.png in task artifact folder `customer-summary-release-2026-10-18`.
- Long individual channel text is tested in actual rendered component regression tests; no live summary was regenerated or edited to manufacture a long example.

## Production

PASS — independent checks after publication.

- Production deploy `6ad3a2e457bf69a6c0d4ab39`, app source `96c78d40896e4508b4e88b190b3d81bfce33466e`, published 18 October2026 00:32:36HKT (`2026-10-17T16:32:36.581Z`).
- Served bundle `/assets/index-Uf9mTVR3.js`, V8.18 · 18 Oct,00:31HKT. Served Firebase config probe200, not substituted for sign-in evidence.
- Fresh admin email/password sign-in `claude-qa@crystocraft.com` → `/dashboard`, Settings/Portal intact. Live internal customer page combined summary expanded495→652characters and collapsed back identically; Add task and Add note visible. Reload retained correct customer detail/admin shell. Individual email499characters/recent activity280characters remained full with no unnecessary toggle. Range297/297products,722SKUs loaded. No console errors. Signed out.
- Fresh approved customer email/password sign-in `customer-qa@crystocraft.com` → `/shop`, correct QA-only identity. Range295designs; Mini Butterfly Music Box detail/reload and ~9weeks/MOQ100 passed, ChromeUSD12.51/GoldUSD12.84 loaded. No admin/cost/internal-note controls. Direct internal customer URL redirected to `/shop`. No console errors. Signed out.
- Main Actions `39049789398` and branch Actions `39049540953`: completed/success.
- Production screenshots: production-customer-page.png, production-admin.png, production-customer.png in task artifact folder `customer-summary-release-2026-10-18`.
- Evidence finalized 18October2026HKT. Subsequent documentation-only evidence commit uses `[skip netlify]`, leaving this verified app deployed.

## Boundaries

No summary regeneration, inbox import, task/note saves, customer/profile/credential
changes, account creation, product/image approvals/publication or messages sent.
QA sign-ins may stamp login activity. Firestore/Storage rules unchanged and not
deployed: SHA256 `bdb17d665871f01a2726f01c6ccc8d623a29c432274412053dc1f6a710f04548`
and `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`.
