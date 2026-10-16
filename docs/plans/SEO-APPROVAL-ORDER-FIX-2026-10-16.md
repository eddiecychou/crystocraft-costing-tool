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
