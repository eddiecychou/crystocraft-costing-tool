# Dashboard and Product Design Projects release — 17 October 2026

Owner authorised push/deployment of Dashboard and Product Design together.
Draft project records remain review-only and were not imported; no live fixture
or real project/product/customer/Pipeline changes were made for testing.

## Release scope and source

- Combined app commit `fe18e79286018956bffa2cc751fe9dcbaa8ffa0e` contains Dashboard
  commit `13c0d521` and Product Design implementation cherry-picked from `fa2dd565`.
- Dashboard defaults to Customer Summary & To-do; Pipeline is click-only, with
  Back/toggle restoring summaries. Scoped Conversation window and explicit
  Update AI summaries distinguish cached reads from AI work; inbox sync is separate.
- Product Design opens Projects, preserving gallery, templates, generations and
  guide. It writes only private project roots and immutable history on explicit
  Save. No automatic draft import or catalogue publication.
- Primary dirty checkout and original Product Design worktree preserved.

## Automated verification

- Combined prebuild: 492 PASS (264 Node tests + 228 standalone checks).
- Vite production build, no-undef lint and diff checks PASS; existing bundle-size
  advisory only. Firebase login config tests 11 PASS.
- Local emulators: 112 existing RBAC/Storage assertions, 11 Product Design
  scenarios, 7 merge and 7 Pipeline scenarios PASS. No live emulator writes.
- Branch GitHub Actions `39015947823` PASS.

## Rules

Firestore rules compiled/uploaded/released successfully before app publication,
limited to new private `pd_projects` rules. Hash:
`92e35cd019e7be61a4f676131bcffad72c7b56e0cba427f52225cb89992b2468`.
Existing compiler advisory at 225:112 remains. Storage rules unchanged and not
deployed (hash `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`).

## Candidate — PASS

Final deploy `6ad32d524096acb754a3e165` at
https://6ad32d524096acb754a3e165--ua-product-manager.netlify.app
Served asset `/assets/index-CpfJiTYb.js`; public Firebase probe HTTP 200.

- Admin `claude-qa@crystocraft.com`: fresh email/password sign-in PASS; expected OC
  dashboard, Settings/Portal navigation, loaded catalogue, refresh preserves
  admin shell/default summaries. Pipeline absent initially, click opens it and
  hides summaries, Back removes it. Private Projects loads empty with no permission
  failure; retained gallery/tools links available. No application errors.
- Approved customer `customer-qa@crystocraft.com`: fresh email/password sign-in
  PASS; expected QA-only wholesale company and customer navigation. 295 designs,
  actual Mini Butterfly Music Box detail, USD 12.51/12.84 prices, ~9 weeks and MOQ
  100 load. Refresh preserves customer shell/detail. Private Product Design route
  redirects to /shop; no project/admin/cost controls or application errors.
- Both QA sessions signed out after checks. Owner browser session untouched.
- Earlier draft deployment failed the customer availability check because the
  linked node_modules directory omitted external firebase-admin from the server
  package. No production publication occurred from that candidate. Replaced link
  with normal local dependencies, forced function packaging, verified anonymous
  availability HTTP 401 (expected), and repeated BOTH fresh role checks on the
  corrected final candidate above. No app source/security bypass was needed.

## Production — PASS

Verification completed 17 October 2026 approximately 19:18 AEDT (Sydney).

- Netlify production deploy `6ad32e2704e3134362efae16`, app source `fe18e79286018956bffa2cc751fe9dcbaa8ffa0e`.
- Published 17 October 2026 08:14:27 UTC / 19:14:27 AEDT (Sydney).
- https://portal.crystocraft.com serves `/assets/index-pRuf0jHQ.js`;
  sidebar V8.18 / 17 Oct 19:13; Firebase configuration probe HTTP 200.
- Main GitHub Actions `39016553048` PASS, branch run `39015947823` PASS.
- Admin `claude-qa@crystocraft.com`, fresh email/password: PASS. Correct OC
  dashboard/identity and Settings/Portal controls. Summary heading count 1 and
  Pipeline heading 0 by default; clicking Pipeline gives 1/0, Back gives 0/1.
  Refresh keeps admin and default summaries. 297 of 297 Range products / 722 SKUs
  load. Projects overview loads with empty state; New project opens and Cancel
  returns without saving. Gallery & design tools expand and existing gallery
  loads real existing sources. No runtime errors.
- Approved customer `customer-qa@crystocraft.com`, fresh email/password: PASS.
  Correct QA wholesale company/customer shell, 295 designs, real Mini Butterfly
  Music Box detail with Chrome USD 12.51, Gold USD 12.84, made-to-order ~9 weeks /
  MOQ 100. Refresh retains detail and both prices. Both /dashboard and
  /design/projects redirect to /shop; no private-project or Settings controls,
  no supplier costs/internal notes, no runtime errors.
- Admin and customer QA sessions signed out. Owner browser untouched. Normal
  sign-in stamps may occur; no business fixtures/saves, AI regenerations,
  Pipeline decisions, imports or publications were performed.
- Product Design write, history and concurrency checks used local emulators;
  production verification deliberately opened/cancelled forms without saving.
- Screenshots: task artifacts `dashboard-pd-release-2026-10-17` with per-role
  candidate-final and production captures, separate Pipeline and Projects views.
- Original dirty checkout porcelain hash remains
  `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`.

Deployment is approved and complete. The four draft starting projects still need
owner review/explicit import approval before creation; B0016 customer/internal
ownership remains unresolved. Existing catalogue/MCP write approvals remain
unchanged.

