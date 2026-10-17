# Dashboard task-button release — 17 October 2026

Owner approved push/deploy and verification of Add task / Add note and both logins.
App source: `5e68a07aea4ee249a99fcad4b1a263d68d699aff`.

## Scope

Chosen customer appears immediately below the picker, even outside active type
filters; their other list entry is omitted to avoid duplicate editors. Existing
shared task/note forms, persistence, audit/history and Pipeline logic are reused.
No Product Design import or catalogue change.

## Automated checks

493 prebuild checks PASS (265 Node tests + 228 standalone checks), Vite production
build PASS, no-undef lint PASS, Firebase login config 11 PASS. Existing chunk-size
advisory remains. Source regression covers selected customer outside active type
filter, pinning, no duplicate workspace, both editors and no Pipeline leakage.

## Security and original checkout

Firestore and Storage rules unchanged; no rule deployment in this release.
Hashes: Firestore `92e35cd019e7be61a4f676131bcffad72c7b56e0cba427f52225cb89992b2468`;
Storage `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`.
Original dirty checkout status SHA-256 still
`fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`.

## Candidate — PASS

- Deploy `6ad3468c0faa99f045d3048d`, served `/assets/index-A02ctKYJ.js`.
  https://6ad3468c0faa99f045d3048d--ua-product-manager.netlify.app
- Public Firebase configuration probe HTTP 200 after one transient network timeout
  and retry; no configuration/authentication change was required.
- Fresh admin email/password `claude-qa@crystocraft.com`: correct OC shell and
  Settings/Portal controls; 297/297 Range products / 722 SKUs loaded. Selecting
  dedicated QA customer pins Add task / Add note above summaries and keeps them
  visible even with Distributor filter. Pipeline remains absent by default.
- Created labelled test task and note only on `qa_customer_release_testing`.
  Both saved and survived full reload. Completed the task and archived the note;
  reopening showed no outstanding items, and two completed/archived history items.
  No real-client tasks or notes were edited.
- Fresh approved customer email/password `customer-qa@crystocraft.com`: correct
  QA wholesale shell, 295 designs, real Mini Butterfly Music Box detail with
  Chrome USD 12.51 and made-to-order ~9 weeks / MOQ 100. Refresh preserved detail.
  /dashboard redirects to /shop, with no Settings or Add task controls. No private
  supplier costs/internal notes visible, and no runtime errors for either role.
- Both QA sessions signed out after checks; owner session untouched.
- Branch GitHub Actions `39023017138` PASS.

## Production — PASS

Final checks completed approximately 21:12 AEDT (Sydney), 17 October 2026.

- Deploy `6ad348169572266f246d358f`, source `5e68a07aea4ee249a99fcad4b1a263d68d699aff`.
- Published 17 October 2026 10:04:58 UTC / 21:04:58 AEDT (Sydney).
- https://portal.crystocraft.com serves `/assets/index-CLY6MLaa.js`; sidebar V8.18 /
  17 Oct 21:04. Public Firebase configuration probe HTTP 200.
- Fresh admin `claude-qa@crystocraft.com` email/password PASS: correct OC identity,
  Settings/Portal controls and 297/297 Range products / 722 SKUs. Selected QA-only
  workspace appears immediately below the picker, unaffected by Distributor chip;
  Pipeline remains absent by default. Refresh preserves correct admin shell.
- Actual production Add task and Add note both PASS: created clearly labelled
  QA-only items, saw both saved, fully reloaded, reselected QA company and saw both
  persisted. Existing add/cancel also works. Completed QA task and archived QA note.
  Reopening Dashboard confirmed no outstanding QA work and four completed/archived
  items (two candidate plus two production). Nothing was hard-deleted; no real
  client tasks/notes, Pipeline decisions or product data were changed.
- Fresh approved customer `customer-qa@crystocraft.com` email/password PASS:
  expected QA wholesale company/customer shell, catalogue and actual Mini Butterfly
  Music Box detail, Chrome USD 12.51 / Gold USD 12.84, ~9 weeks / MOQ 100. Refresh
  retained product detail. /dashboard redirects to /shop with no Settings or Add
  task controls, supplier costs or internal notes. No runtime errors for either role.
- Branch Actions `39023017138` and main Actions `39023487855` both PASS.
- QA sessions signed out; owner browser session untouched. Normal sign-in stamps
  and the explicitly tested QA-only work items are the only test writes.
- No Firestore/Storage deployment was needed. No Product Design project import.

Evidence: task artifact folder `dashboard-task-button-release-2026-10-17`, separate
candidate/production admin saved-items screenshots and customer detail screenshots.


