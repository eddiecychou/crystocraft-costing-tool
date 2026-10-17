# Customer workspace sync regressions — 17 October 2026

Test-only update. No production source, rules or data changes; no app deployment.

## Coverage

`qa/customer-workspace-sync-emulator.mjs` mounts actual `Dashboard.jsx` and
`CustomerDetail.jsx` simultaneously. Their actual shared workspace component,
projections, hook, Firestore SDK, subscriptions, transactions and repository rules
run against the local emulator. `customer-workspace-sync-fixture.mjs` replaces
only unrelated integrations, permission-display hooks and Firebase bootstrap;
no workspace save/listener implementation is mocked.

Nine cases cover task/note creation from either real page, live edits in both
directions (text, due date, Waiting/To do), completion/archive/reopen both ways,
persistence after remount, stale editor rejection with draft retention, legacy
conversation preservation, route/customer isolation and anonymous/customer denial. Route switching uses real in-place React Router navigation; it does not recreate the page to hide stale subscriptions.
Cross-page observations occur without remounting or manually refreshing data.

The suite refuses to run without a loopback FIRESTORE_EMULATOR_HOST before fixture
setup. It uses fictional customer IDs and authenticated emulator identities,
requires no secrets and reads no .env or live credentials. Each case unmounts both
pages and resets fictional database state. Existing live data is never reached.

## Integration

`npm run test:workspace-sync` is appended to the existing GitHub Actions emulator
job after RBAC, merge, Pipeline and Product Design. Applicable push, PR and manual
triggers already cover source, QA, rules, package and workflow changes. Existing
job IDs/read-only permissions are preserved. Fast prebuild workspace tests remain
independent of Java and the emulator. Run instructions are in qa/README.md.

## Local verification

- Nine new real-page emulator tests PASS (combined run about 5 seconds, final in-place navigation run about 8 seconds).
- Existing workspace suite: 53 PASS.
- Exact complete CI emulator sequence PASS: 112 RBAC/Storage assertions; 7 merge,
  7 Pipeline, 11 Product Design and 9 workspace sync cases.
- No-emulator safety refusal verified; syntax and diff whitespace checks PASS.
- Primary dirty checkout untouched. Netlify production app and security rules
  remain at the preceding verified release.

## Remote verification — PASS

Final test revision `7b150d95a18d034b3b2d21ba84e14f31784789b0` is pushed to main
and the working branch. Both complete workflows, including the emulator sequence
and existing product/document/AI/MCP regressions, passed:

- Main: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39027602036
- Branch: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39027602578

Both commits used [skip netlify]. Read-only deployment inspection confirms
production remains deploy `6ad348169572266f246d358f`, app source `5e68a07a`;
no application or rules deployment and no live test writes occurred. The dirty
original checkout remains unchanged (status SHA-256
`fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`).
