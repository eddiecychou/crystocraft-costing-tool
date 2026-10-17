# Dashboard summary controls — 17 October 2026

> Release update: app and required Firestore rules published on 17 October 2026.
> See [combined release evidence](DASHBOARD-PRODUCT-DESIGN-RELEASE-2026-10-17.md).
> The local-only statements below describe the implementation review stage.
> Draft project import remains unapproved and has not occurred.

Local implementation only. Branch `codex/dashboard-summary-controls` starts from
upstream main `5f5c2294`. No push, deployment, rules change or live customer update.
The dirty primary checkout and separate Product Design Projects work are untouched.

## Behaviour

- Customer Summary & To-do is the default. Only clicking Pipeline shows its
  panel; Back or clicking the tile again restores summaries. Selecting a customer
  for tasks/notes does not insert their Pipeline controls into summaries.
- Conversation window (2 weeks / 1 month / 3 months) lives inside the summary
  section. Selection reads the chosen saved cache only. Tasks and dashboard
  figures are independent of this window; confirmed Pipeline positions do not expire.
- Pipeline separately labels its input as Use saved summaries from. Preparing
  suggestions is still explicit and never confirms a customer position.
- Removed the top partial Refresh and focus-triggered interaction resubscription.
  Existing Firestore listeners continue updating saved data automatically.
- Update AI summaries explicitly regenerates the selected period from already
  ingested email, WhatsApp and CRM interactions. It does not sync inboxes or
  prepare Pipeline suggestions. No new backend or collection.

## Verification

- All 481 prebuild checks pass (253 Node tests + 228 standalone checks), including
  real Dashboard regression assertions for default/tile/back views, customer
  selection, period switching and separate AI actions with selected-day arguments.
- Production Vite bundle and source undefined-identifier lint pass. First bundle
  attempt correctly rejected missing public Firebase configuration; rebuilt with
  the existing valid gitignored public configuration. Existing chunk-size warnings remain.
- Real browser fictional fixture: default summaries, Pipeline click/back, desktop
  and 375px phone views. Phone viewport/content both 375px in both views.
- Fictional fixture replaces Firebase and writers; no real summary generation,
  suggestion staging, approval, dismissal or closure occurred.
- `git diff --check` passes. Original checkout status hash remains
  `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`.

Run `node qa/dashboard-summary-preview.mjs` for the local-only preview on port
5196 (`--build-only` builds without listening). Evidence is in the task artifact
folder `dashboard-summary-controls-2026-10-17`.

Production release remains subject to explicit push/deploy approval and the
normal fresh candidate and production admin/customer sign-in gates.
