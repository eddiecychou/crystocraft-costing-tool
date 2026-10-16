# DSH integration findings — OC candidate, 16 October 2026

Status: implemented and tested locally on codex/v818-marketing-review, based on
f96bf61b. NOT pushed or deployed. No production batch decisions, WordPress plugin
files, host caches, customer roles, credentials or Firebase rules were changed.
The dirty primary checkout remains untouched.

## Findings and changes

1. Deadlock: unused approved work may be withdrawn through op:withdraw or the UI,
   or superseded by an overlapping pending replacement requiring fresh approval.
   No results AND no execution claim is required. No-result does not mean idle:
   protocol-2 op:claim atomically sets executing/execution_started_at before writes.
   Claim and withdrawal/supersession serialize on the same batch. Existing receipts
   prevent claiming/replaying even if an obsolete client resets status to approved.
   Results are transactional and cannot revive withdrawn work. Legacy polls fail
   409; DSH must integrate claim before this candidate goes live.
2. expectedFields:['meta'] now covers concrete nested metadata, like meta_data.
   Narrow dotted declarations remain preferred. Unrelated drift remains blocked.
3. Metadata-only brand preservation explicitly skips with an untouched-copy reason.
   Body/title/name/description/Elementor writes, including empty body replacements,
   still detect dropped brands. Other metadata/language checks remain active.
4. Corrected page-Yoast guidance: auth_callback is write permission, not read
   visibility. Require edit-only REST schema and capability-filtered responses;
   test anonymous/customer single/collection/embedded routes and authorised edit.
   DSH owns the installed WordPress plugin; its reported 17 tests are not an OC
   live certification. Our anonymous network probe returned HTTP 403 with an empty
   body, so this session could NOT independently verify the live metadata response.
5. REST cache guidance now covers /wp-json/ including single/collection/query/language
   variants at every cache layer, canonical cached and fresh responses, and host
   exclusion of REST/authenticated edit responses where possible. No purge was run.
7. Added read-only release-pinned check-vendor-sync.mjs. It reads five artifacts
   from the full immutable intended release SHA, ignores the working checkout,
   checks every supplied vendor directory, and never prints copy commands.
8. Reviewed target and safeWrite pre/post reads must use authorised context=edit.
   A missing private field is not an empty field. Do not omit/replace reviewed
   snapshots to bypass missing data; integration must assert complete target keys.

## Verification

- Full prebuild suites: 375 assertions/tests, zero failures (130 application;
  validator 147; standalone safeWrite 49; batch guards 13; Node SEO/UI/HTTP 36).
- Production Vite build passed; required src/netlify no-undef lint passed;
  git diff whitespace check passed.
- Injected transaction tests cover both claim-versus-withdraw/supersede orders,
  failed claims, zero-receipt locks, partial/recorded-result refusal and fresh
  replacement review. These are not live Firestore contention tests.
- HTTP handler tests cover legacy protocol rejection, claim, withdrawal, result
  gating and no resurrection. Real React UI tests cover old active approvals
  outside the history window and a claim occurring after render but before click.
- Browser fixture: batch ID visible, approved -> withdrawn, original approval/diff
  retained, withdrawal button removed, no browser errors. Evidence:
  /private/tmp/dsh-review-approved.png and /private/tmp/dsh-review-withdrawn.png.
- Immutable vendor checker tested with deliberately stale working source and
  correct release-pinned vendor, wrong/missing bytes, and refused HEAD/main pins.
- No deployment or fresh admin/customer login was performed for this local candidate.

## Coordinated rollout and DSH test checklist

Pause and drain old workers, discard cached approved payloads, then integrate:

- Poll with execution_protocol:2 for discovery only. Claim by id with protocol 2
  immediately before execution. Write ONLY the successful claim response's approved
  items without results. Failed/uncertain claim means zero writes. Do not auto-release
  claims on a timer; inspect WordPress/receipts after a worker failure.
- Re-vendor validator + test and safeWrite + test into BOTH active directories;
  keep Yoast helper identical. Replace the working-copy-based sync policy with
  the immutable release checker. Pin only the intended deployed release SHA
  supplied in the eventual release handoff; do not pin this local candidate as live.
- Stub all WordPress PUTs while testing withdrawal, approved supersession, two
  workers claiming, claim-vs-withdraw, failed claim, stale baseline, blocked
  validation and receipt history. Assert zero PUTs for every losing/blocked path.
- Build a fresh metadata-only item with complete edit-context before keys and no
  brand exception. Verify exact metadata readback, Yoast indexable invalidation,
  no body/layout drift, and backups. Do not replay historical partially executed
  batches to manufacture a green outcome.
- Verify REST privacy on previously cached canonical single AND collection URLs,
  query/language/embedded variants and fresh URLs, plus authorised edit readback.
  Purge cached REST responses at host/CDN or exclude those routes. Never infer
  public visibility from auth_callback alone.

After producer integration: candidate fresh admin AND approved-customer sign-ins,
role routing, data loading, access separation and refresh; then explicitly authorised
production release and the same checks again. No previous login evidence is reused.

Full operational contract and official WordPress references:
../../seo-control-plane/README.md.

## Authorised release closure — 16 October 2026, 12:58 AEDT

Owner explicitly requested push/deploy, fresh admin/customer login and DSH message.
App commit e516a1c9e9763a661e9191803de7a3d53000c685 pushed to main; latest main
was the expected base (one local commit ahead, no remote divergence).

- Candidate deploy 6ad182be5b8f490e133ce57c:
  https://6ad182be5b8f490e133ce57c--ua-product-manager.netlify.app
  asset /assets/index-CbChMJJ4.js; marker V8.18 · 16 Oct, 12:47.
- Production deploy 6ad183af9c09894303c35bbc, ready and published at
  2026-10-16T01:54:47.201Z (12:54:47 AEDT), app commit e516a1c9.
  Both portal.crystocraft.com and ua-product-manager.netlify.app serve
  /assets/index-Bmg7knIE.js; marker V8.18 · 16 Oct, 12:54.
- Configuration tests 11/11. Served Firebase probes HTTP 200 on candidate and both
  production origins; unauthenticated production batch requests HTTP 401.
- GitHub Actions run 38837577385, job 116770022501: completed SUCCESS, all 375
  assertions/tests confirmed from job logs; zero failures.
  https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38837577385

### Fresh browser sign-ins (real pages and passwords)

| Surface | Role / approved QA identity | Result |
|---|---|---|
| Candidate | admin claude-qa@crystocraft.com | PASS |
| Candidate | customer customer-qa@crystocraft.com | PASS |
| Production | admin claude-qa@crystocraft.com | PASS |
| Production | customer customer-qa@crystocraft.com | PASS |

Admin: fresh sign-in routed to /dashboard with Settings/Portal admin navigation;
/range loaded 296 of 296 products and 720 SKUs and persisted after refresh. Updated
/seo-review loaded real batches, visible batch ID IneCJ45qIECrLO2eyvGl and Withdraw
unused batch. Production list showed one pending review and historical states;
no approved/executing badges were present at inspection. No live batch decisions
or withdrawals were made. Candidate admin initially had a transient connection
error; retry succeeded without any configuration or credential changes.

Customer: fresh sign-in routed to /shop with approved QA company/USD header;
/shop/figurine loaded 24 product cards before and after refresh, no admin Settings
link. Direct /settings redirected to /shop on both surfaces. No admin shell, supplier
costs or internal notes appeared. Browser app error logs empty. Both roles signed
out after testing. The owner's working Chrome/custom-domain session was untouched.

Evidence (screenshots):
/private/tmp/dsh-worker-candidate-admin.png
/private/tmp/dsh-worker-candidate-customer.png
/private/tmp/dsh-worker-candidate-review.png
/private/tmp/dsh-worker-production-admin.png
/private/tmp/dsh-worker-production-customer.png
/private/tmp/dsh-worker-production-review.png

Application release is complete. Firebase rules/Auth/roles/credentials unchanged.
DSH's worker is NOT changed by this release: legacy polls intentionally fail 409.
The required protocol-2 producer update and real end-to-end WordPress tests remain
DSH's work. No WordPress plugins, writes, caches or Workbench files were modified.
Live WP privacy response remains uncertified here (anonymous probe HTTP 403).
