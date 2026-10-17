# Dashboard summary preview release — 18 October 2026

Owner authorized push/deployment and fresh admin/customer login verification.

## Change and source

- App source `35b26911e3bbb648ec4373e4476c0a4e4f5c8030`, branch `codex/dashboard-summary-preview`, based on upstream `cd4ba3d8`.
- Dashboard-only `collapseSummary` on shared CustomerWorkspace. Long summaries show about 500 characters with accessible Show more/Show less. Full saved text remains intact; no AI call, inbox sync or save on toggle. Customer-detail summaries remain full; tasks/notes stay visible. New digest/period resets expansion.
- Primary dirty checkout untouched; isolated worktree `/private/tmp/costing-summary-release`.

## Automated/local checks — PASS

- Customer workspace suite: 70 passed, 0 failed, including actual component expansion/collapse, retained task controls, short/empty/full customer-page summaries and reset after summary/window replacement.
- Full prebuild suites and production build passed; Node test runner totals 314 (additional standalone/Python suites also executed by prebuild).
- Firebase client-config suite 11 passed; standard no-undef lint on changed components and whitespace check passed.
- Branch GitHub Actions `39048814585`: completed/success before production push.
- Fictional local browser preview: expanded full final detail, collapsed back, task/note controls retained. No live writes used to prepare preview.

## Candidate — PASS

- Netlify site `4a234708-a213-477f-91a5-97cdc939c1db`, deploy `6ad39fc417862d924ab4b09c`.
- Existing QA alias https://dsh-images-20261018--ua-product-manager.netlify.app reused; served bundle `/assets/index-C-bTCb9x.js`, V8.18 · 18 Oct, 00:13 HKT. Firebase config probe HTTP200, separately from authentication evidence.
- Fresh admin email/password sign-in (`claude-qa@crystocraft.com`) → `/dashboard`, Settings/Portal intact. Real saved one-year summary: collapsed495 characters → full652 characters → identical collapsed495 characters, Add task retained. Reload kept correct admin shell. Range297/297 products,722SKUs. No console errors.
- Fresh approved customer email/password sign-in (`customer-qa@crystocraft.com`) → `/shop`, QA-only customer identity; Range295 designs. Mini Butterfly Music Box detail/reload loaded ChromeUSD12.51, GoldUSD12.84 and ~9weeks/MOQ100. No admin/cost/internal-note controls. `/settings` redirected `/shop`. No console errors. Both QA sessions signed out.
- Candidate screenshots in task artifact folder `dashboard-summary-release-2026-10-18`.

## Production

PASS — independently verified after publication.

- Netlify production deploy `6ad3a0681f672c236137b259`, app source `35b26911e3bbb648ec4373e4476c0a4e4f5c8030`, published 18 October 2026 00:22:11 HKT (`2026-10-17T16:22:11.964Z`).
- Served production bundle `/assets/index-CS5sAkZ2.js`; sidebar V8.18 · 18 Oct, 00:21 HKT. Firebase config probe HTTP200; not substituted for sign-in tests.
- Fresh admin email/password sign-in (`claude-qa@crystocraft.com`) → `/dashboard`; correct Settings/Portal navigation. Actual saved one-year summary expanded495→652 characters and collapsed back to identical495-character preview. Add task and Add note remained visible. Reload retained admin shell; Range297/297 products,722SKUs. No console errors. Signed out.
- Fresh approved-customer email/password sign-in (`customer-qa@crystocraft.com`) → `/shop` with correct QA-only identity. Range295 designs. Mini Butterfly Music Box detail and reload passed, ChromeUSD12.51 / GoldUSD12.84 and ~9weeks/MOQ100. No admin/cost/internal-note controls; `/settings` redirected `/shop`. No console errors. Signed out.
- Main Actions `39049010068`: completed/success; branch run `39048814585` also success.
- Screenshots: production-summary.png, production-admin.png, production-customer.png in the task artifact folder `dashboard-summary-release-2026-10-18`. Saved summary text/customer records were not changed.
- Evidence finalized 18 October 2026 HKT. Subsequent evidence-only commit uses `[skip netlify]` so the verified app remains the published build.

## Boundaries

No account/credential/role changes, AI generation, task/note saves, product/image
approvals, publishing or message sends. Normal QA sign-in activity may update login
stamps. No rules deployment. Firestore SHA256
`bdb17d665871f01a2726f01c6ccc8d623a29c432274412053dc1f6a710f04548`;
Storage `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c` unchanged.
