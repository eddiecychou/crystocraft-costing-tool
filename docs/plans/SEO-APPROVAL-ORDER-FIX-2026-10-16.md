# SEO Review approval regression — 16 October 2026

Owner screenshot: unchanged pending batch DQX2cxoG761CRH4v6f0a could not be
approved; UI reported "Review decisions changed. Reload the queue before
continuing". No owner batch decisions were changed while diagnosing.

Root cause: JSON.stringify map-key ordering was treated as a review revision.
A realistic reordered-map transaction fixture reproduced the exact failure before
the fix. Replaced it with recursive value equality in src/domain/seoReview.js;
actual changed values/decisions/arrays/timestamps still fail, as do superseded or
claimed states. Corrected the companion blank baseline display for flat metadata
and display raw authored text instead of an entire REST body where raw is present.

Tests: real React click flows under reordered reads cover single approval, bulk
approval and release to approved; every stale data/decision/array/state fixture
leaves the batch unchanged. Firestore Timestamp equality, numeric values, flat/
nested/Woo baselines and explicit empty strings are covered. Mocked state only;
no live approvals, batch creation, WordPress writes or role/rules changes.

Release evidence to be appended after candidate/production two-role verification.

## Local verification and release status

377 assertions/tests passed (130 application, validator 147, standalone safeWrite
49, batch guards 13, Node SEO/UI 38). Full Vite build passed in 8.24 seconds;
required src/netlify no-undef lint and git diff whitespace checks passed.
Browser fixture with reordered transaction maps: individual Approve changed the
count to 1 approved, then Send to DSH moved the isolated batch to approved without
errors. Evidence: /private/tmp/approval-button-fixed.png. Stale payload, decisions,
array order, superseded and claimed fixtures still reject changes.

Automatic approval review rejected the combined commit/deploy action because the
latest user message did not explicitly authorize deploying this new regression
fix. That command did not execute: no commit, push or hosted deployment occurred.
Local source changes remain reviewable. Owner permission is required to release;
then follow fresh candidate and production admin/customer verification, including
customer product detail. No live batch was approved or otherwise changed.

## Release authorised — 16 October 2026

Owner subsequently explicitly authorised push/deploy and queue/admin/customer
verification. App commit f9998fba9c36b01fed648d55f150c17ccbb53592 was created and
pushed to main after candidate verification. Unrelated dirty primary checkout
changes were preserved; this release worktree had no remote divergence.

Live read-only Firestore confirmation using the approved admin QA identity:
pending batch 6nDGsKswgpQbrAkPqGHh, query versus transaction read:
mapOrderDiffers=true, reviewValuesMatch=true, documentWrites=0. This confirms the
reported root cause on real stored data rather than only a mock reproduction.
The owner/DSH changed the active batch independently since the screenshot; OC
made no batch decisions, edits, withdrawals or WordPress writes.

Candidate 6ad1914f25af59acf94c470e:
https://6ad1914f25af59acf94c470e--ua-product-manager.netlify.app
served asset /assets/index-CiIM6m0u.js. Firebase configuration probe HTTP 200;
configuration tests 11/11. Fresh real-page password sign-ins PASS for admin
claude-qa@crystocraft.com and approved customer customer-qa@crystocraft.com.
Admin /dashboard navigation and /range loaded 296 products/720 SKUs and persisted
after refresh. Queue loaded pending batch, enabled Approve, no false stale error;
layout Before now shows len 14661 and authored content is readable. No Approve
button was clicked on live data. Isolated React/browser fixtures verify actual
single/bulk approvals and Send to DSH. App error logs empty.
Customer /shop route and QA-company/USD header correct; catalogue 24 cards before
and after refresh, Sacred Angel Freestand detail loaded with prices and
"Made to order — ~9 weeks, MOQ 100". No admin Settings links; direct /settings
redirected to /shop. No admin controls/costs/internal notes; error logs empty.
Both QA roles signed out. Owner browser/session untouched.

Production deployment and repeated fresh-login evidence follows below.

## Production verification — complete, 16 October 2026, 14:00 AEDT

Production deploy 6ad1922a9c09894303c63860 is ready/published from app commit
f9998fba9c36b01fed648d55f150c17ccbb53592. Published at
2026-10-16T02:56:20.803Z (13:56:20 AEDT). Both portal.crystocraft.com and
ua-product-manager.netlify.app serve /assets/index-o__D6Dx9.js with Firebase
configuration probe HTTP 200. Build marker V8.18 · 16 Oct, 13:55.

GitHub Actions run 38842922281, job 116786868846: completed SUCCESS, exact job
logs confirm 377 assertions/tests with zero failures (130 application, validator
147, standalone safeWrite 49, batch guards 13, Node SEO/UI 38).
https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38842922281

Fresh real-page password sign-ins on PRODUCTION:
- Admin claude-qa@crystocraft.com: PASS. /dashboard correct admin shell and
  Settings navigation; /range loaded 296 products/720 SKUs and 25 visible links
  before/after refresh. Queue loaded current pending batch with Approve enabled,
  no stale-review error, Before layout len 14661 / After len 14977 and readable
  raw authored content. Queue read only; no live approval/release was made.
- Approved customer customer-qa@crystocraft.com: PASS. /shop route and QA/USD
  company header correct; /shop/figurine 24 product cards before/after refresh.
  Sacred Angel Freestand detail loaded, Chrome Bohemia USD 6.44 and Made to order
  ~9 weeks/MOQ 100 visible. No admin Settings link or supplier/internal cost
  controls; direct /settings redirected to /shop. App error logs empty.

Both roles also passed on candidate (recorded above); both signed out after QA.
No passwords, profiles, roles, Firebase rules or live batch decisions were changed.
Owner working Chrome/session not disturbed. Shared validator/writer artifacts and
DSH protocol 2 are unchanged by this UI fix. Approval click transitions verified
using isolated React/browser fixtures, supplemented by the real read-only
transaction comparison; this is not a claim that the owner's live batch was approved.

Screenshots:
/private/tmp/approval-button-fixed.png (isolated approval)
/private/tmp/approval-candidate-admin.png
/private/tmp/approval-candidate-review.png
/private/tmp/approval-candidate-customer.png
/private/tmp/approval-production-admin.png
/private/tmp/approval-production-review.png
/private/tmp/approval-production-customer.png

Application release complete. User should reload SEO Review once to replace any
old in-memory frontend, then review/Approve and Send to DSH. Firebase rules were
not deployed. This closure is documentation only and skips Netlify re-deployment.
