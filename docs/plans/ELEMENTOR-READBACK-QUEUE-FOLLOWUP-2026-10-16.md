# Elementor read-back / queue follow-up — 16 October 2026

## Evidence and scope

Owner supplied DSH's execution report. It reports four layout writes stored
correctly but flagged unverified because PHP escapes slashes in _elementor_data.
The report separately shows genuinely missing page Yoast fields and two pending
obsolete batches: 5NAQFO65EQ7Pnr22UkIv and u101nULG54qzgR9Ys88p.
Treat these as DSH-reported production evidence, not independent verification.
No existing result has been relabelled successful; no pending batch has been
approved, rejected or superseded by this implementation.

## Implemented locally

- safeWrite parses/canonicalises only valid Elementor arrays, preserving array
  order and all authored values, sorting object keys recursively. Applies the
  same semantic comparison to requested-field verification, drift and no-op.
  Ordinary HTML/text remains exact. Invalid JSON is not repaired.
- Optional expectedBefore checks the exact reviewed RAW target-field snapshot
  before PUT. DSH must wire it; omission is backward-compatible and does not
  provide stale-source protection. Existing expectedFields/backups/read-back,
  variation safety and mandatory Yoast invalidation remain intact.
- Batch create transaction refuses overlapping pending/approved entities.
  Optional batch.supersedes atomically withdraws overlapping UNEXECUTED pending
  batches and creates a replacement requiring fresh review. It cannot withdraw
  approved/in-flight/partial/executed work. Whole batches are replaced: DSH must
  carry forward every wanted change.
- Superseded originals retain their reviewed payload and decisions, recording
  superseded_by/at. Poll cannot release them even if an old UI resets status.
  Review transactions refuse changed or non-pending/superseded records.
  Results cannot revive superseded or unreleased work.

## DSH rollout after OC release

1. Copy safe-write.mjs + safe-write.test.mjs verbatim to EVERY active vendor
   directory. Do not alter the validator or Yoast invalidation helper.
2. Verify vendor sync and hashes. Run the standalone safe-write tests (47/47)
   and the repository SEO suite including new escaping/queue tests.
3. Feed expectedBefore the reviewed raw target values, not hashes/rendered
   content or a fresh snapshot substituted after approval. A stale preflight
   must perform zero PUT calls. Rebuild and re-review after failure.
4. Handle 409 conflicts explicitly. Combine edits or use batch.supersedes for
   pending work. Never re-execute cached poll responses or retry failed writes
   automatically. A superseded batch is not an approval of its replacement.
5. Human should reject the two obsolete batches above, or DSH should explicitly
   supersede them with a complete fresh replacement. This has NOT happened yet.
6. Historical partial results stay historical. Reconcile actual raw layout and
   genuinely missing fields; do not replay the old layout simply to obtain green
   results. Submit a fresh narrowly scoped SEO metadata batch after the
   WordPress prerequisite below is resolved.
7. Test slash and Unicode escaping, object-key reordering, unchanged/no-op
   layouts, changed values/array order, ignored Yoast fields, stale preflight,
   409 overlap, supersession audit links, old-tab approval rejection, and fresh
   human approval for replacements. Keep safeWrite failure stop behaviour.

## Page Yoast: separate WordPress owner/DSH action

The OC release cannot register metadata on the WordPress host. DSH's report is
site-specific; do not assume all Yoast installations behave identically.
Recommended durable route: DSH prepares a small page-only metadata registration
change for owner review. Register ONLY _yoast_wpseo_title and
_yoast_wpseo_metadesc for the page subtype using register_post_meta, single string
values, appropriate text sanitisation, REST edit-context exposure and an
auth_callback enforcing the existing user's permission to edit THAT page.
Confirm page custom-fields support and existing registered schemas first;
preserve existing sanitisation/authorization where already correctly registered.
Do not expose all private metadata, add roles/capabilities or bypass REST auth.

Before production installation, test in the actual WordPress environment:
- authorized editor sees both fields with context=edit and can save/read back;
- anonymous and customer-only accounts cannot write; public responses do not
  expose private raw metadata;
- existing post/product behavior and unrelated page metadata remain intact;
- exact owner-reviewed title/description land via the approved safeWrite path;
- Yoast invalidation is confirmed, caches refreshed, and public title/meta
  description match expected output without changing the current Elementor tree.

WordPress references:
https://developer.wordpress.org/reference/functions/register_post_meta/
https://developer.wordpress.org/rest-api/extending-the-rest-api/modifying-responses/
Current Yoast implementation:
https://github.com/Yoast/wordpress-seo/blob/trunk/inc/class-wpseo-meta.php

No WordPress plugin/configuration, WP-CLI operation, permissions or page content
was changed here. No PHP runtime or actual WordPress integration test was run.
An owner-operated WP-CLI correction is an alternative only with explicit approval;
it is not part of this local OC fix.

## Exact artifacts

safe-write.mjs SHA-256:
b9f18f27f404a55897e5abc7b0fecffe8c3e3c76d6c20dbe240d20954a55d3a7
safe-write.test.mjs SHA-256:
fd29ef05c7f1ab00bbb7a0ca08e654c97a3b1199fcf87e37bb23e4666a93daa2

Validator remains 713ceb69fd16; Yoast helper remains 28eba647fe55.
Local tests/build and release status are recorded below.

## Local verification and release boundary

- 360 regression assertions/tests passed, zero failed: 130 application,
  validator 144, existing safe-write 47, batch guard 13, Elementor/UI + new
  read-back/queue tests 26.
- Production build passed. Undefined-identifier lint passed with inline
  directives disabled (the scratch lint install does not include the hooks
  plugin referenced by existing unrelated comments). Whitespace check passed.
- Portable package standalone test: 47/47 passed.
- No application push/deploy, Firebase rules deployment, candidate/production
  fresh login checks, real Firestore transaction test or WordPress integration
  test performed for this follow-up. Unit transaction tests use an injected
  in-memory store; production transaction/concurrency still needs release QA.
- Code is prepared for owner review. Previous release login evidence does not
  apply to these changes. Before publication run the mandatory fresh candidate
  and production admin/customer checks in RELEASE-WORKFLOW.md.
- Package: output/DSH-Elementor-readback-followup-2026-10-16.zip (contains writer,
  standalone test, handoff and SHA256SUMS). It is prepared locally, not sent.

## Release authorized — 16 October 2026

Owner explicitly requested push/deploy, fresh admin/customer login verification
and the DSH update/testing message. App commit:
89e207e1aa015051ae5aab01d2ceec730a2d499a. Latest main checked before release:
one ahead, no divergence; unrelated primary checkout changes preserved.

Candidate: 6ad11668bc6a612f27eb8103, /assets/index-CLIzwnDD.js,
V8.18 · 16 Oct, 05:05. Firebase configuration probe HTTP 200; 11/11 config tests.
- Admin PASS: fresh password sign-in claude-qa@crystocraft.com -> /dashboard,
  Settings/Portal available; catalogue fully loaded 296/296 products, 715 SKUs,
  correct shell after refresh; application error log empty. Signed out.
- Customer PASS: fresh password sign-in customer-qa@crystocraft.com -> /shop,
  approved QA company and correct customer navigation. Range loaded 24 cards,
  remained populated after refresh. Sacred Angel Freestand detail loaded customer
  prices and made-to-order availability (~9 weeks, MOQ 100); no internal notes
  or supplier costs. /settings redirected to /shop; application error log empty.
  Signed out.
- Screenshots: /private/tmp/v818-evidence/readback-candidate-admin.png and
  /private/tmp/v818-evidence/readback-candidate-customer.png.

Implementation pushed to main. Production deployment and fresh login checks
completed; closure below. Earlier local-only status above records the pre-release stage.

## Production closure — 16 October 2026, 05:15 AEDT

- Application commit 89e207e1aa015051ae5aab01d2ceec730a2d499a pushed to main.
- Netlify production 6ad1170c577af7c395d474d0, ready/published
  16 October 2026, 05:11:19 AEDT (2026-10-15T18:11:19.050Z).
- Served build V8.18 · 16 Oct, 05:10, /assets/index-B_We9wrl.js.
  Both production origins serve it; both Firebase config probes HTTP 200.
  Candidate and production /api/seo-batch reject unauthenticated POST with 401.
- GitHub Actions run 38783401357 completed successfully: 360 assertions/tests,
  zero failures:
  https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38783401357
- Admin PASS: fresh password login claude-qa@crystocraft.com -> /dashboard,
  approved admin shell, Settings/Portal available; catalogue 296/296 products,
  715 SKUs; refresh retained correct shell and populated products. SEO Review
  loaded existing batches; historical partial receipts remained partial.
  Application console error log empty. Explicit sign-out completed.
- Customer PASS: fresh password login customer-qa@crystocraft.com -> /shop,
  approved QA company and correct customer shell. Range loaded 24 cards before
  and after refresh. Sacred Angel Freestand detail loaded prices and made-to-order
  availability (~9 weeks, MOQ 100); no supplier costs or internal notes.
  /settings redirected to /shop, with zero Settings links. Application error
  log empty. Explicit sign-out completed.
- Screenshots: /private/tmp/v818-evidence/readback-production-admin.png,
  /private/tmp/v818-evidence/readback-production-customer.png,
  /private/tmp/v818-evidence/readback-production-review.png.
- No live batch decisions/results, WordPress settings/content, Firebase rules,
  credentials or customer roles were changed by release QA. Owner session
  preserved. No authenticated create/supersede request or live concurrency
  exercise was used as QA; those paths have injected-transaction regression
  tests and still require DSH producer integration tests.
- DSH message prepared in DSH-READBACK-RELEASE-MESSAGE-2026-10-16.md and portable
  writer package prepared locally; neither sent externally. DSH re-vendoring
  and expectedBefore wiring remain required. WordPress page-Yoast registration
  remains a separate owner/DSH prerequisite, not fixed by the OC release.
