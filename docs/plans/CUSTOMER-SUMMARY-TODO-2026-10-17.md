# Customer Summary & To-do — 17 October 2026

Owner request: consolidate the dashboard follow-ups and customer interaction workflow around the existing email/WhatsApp summary, with simple internal tasks and reference notes.

## Behaviour

- Both screens render `CustomerWorkspace`, using the same dashboard summary cache and the same saved work items. Dashboard refreshes the existing 30-day digest on demand; no background AI task generation or automatic completion.
- Add task: text, optional local-calendar due date, To do / Waiting / Done. Add note: text only; archive/reopen. Edit preserves kind and creator. Completed items are recoverable via Show completed / archived.
- Dashboard includes every customer with outstanding work even without activity in the last 30 days, sorts dated tasks first and offers a customer selector for quiet customers. Existing customer-category/retail and overdue filters apply to the shared panel.
- Existing interaction follow-ups are projected directly into tasks, under their existing interaction IDs. No migration or duplicate creation, no date cutoff, no bulk production writes. Editing/completing sets only `todo_*` metadata; original description/date/channel/sales status/attachments/follow_up_date remain intact. Already-cleared historic reminders are not recreated.
- Interaction history is retained, collapsed by default for new preferences, with an optional detailed interaction form for calls/meetings. Existing collapse preferences remain respected.
- Summary refresh cannot replace notes, change task status or clear due dates. AI remains factual context only. Tasks/notes are excluded from message-ingestion/outreach queries because they use a separate subcollection.

## Storage, permissions and concurrency

`customers/{customerId}/work_items/{uuid}`: kind, text (1–4000 chars), state, due_on (local YYYY-MM-DD or empty), revision, created_by, updated_by, createdAt, updatedAt.

Same `can('customers')` capability as CRM history, including collection-group read for the dashboard; never a customer-portal or dashboard-only staff grant. Anonymous/customer/no-CRM read/write denied. Fixed field set, immutable kind/creator/createdAt, authenticated updater and server timestamps, sequential revisions. No hard-delete control/rule; archive and reopen instead. Firestore rules release is required; Storage rules unchanged.

Transactions compare revisions and legacy projected values. A form UUID stays stable across retry, avoiding duplicate creates after uncertain success. Errors preserve the open draft. Both screens use live listeners. Dashboard uses aggregate reads rather than a separate task listener for every customer.

Customer merge refuses to delete a duplicate that has native saved tasks/notes: keep that record as the survivor. This prevents silent orphaning without adding a destructive task migration to this release. Existing interaction merge remains unchanged.

## Verification

- `npm run test:customer-workspace` — 12 tests: legacy carry-over/history preservation, dates/status/text validation, old/undated/waiting task ordering, revision conflicts, transaction retry idempotency, metadata-only legacy completion, shared UI, failed-save draft retention, archive/reopen.
- RBAC emulator: 102 passed, 0 failed (Firestore and Storage), including 20 added work-item assertions.
- New workflow tests run in prebuild and GitHub Actions.
- Production build, changed-code no-undef lint and fresh candidate/production two-role verification required before release closeout; evidence appended below.

## Candidate evidence

Application commit: `c685a5bc171c8173e912273f603755f2adc9eec6`.
Candidate: `6ad2d8e044f35119aac84255`, https://6ad2d8e044f35119aac84255--ua-product-manager.netlify.app . Served `/assets/index-GVS4yXH5.js`, Firebase configuration probe HTTP 200.

- Admin `claude-qa@crystocraft.com`: fresh email/password sign-in PASS, correct OC shell and Settings navigation, dashboard 23 shared workspace cards and exactly 4 carried legacy follow-ups. Widdop customer record shows matching summary/task and Interaction history (6); editor opened and cancelled without saving. Refresh persistence PASS; Range 297 products/722 SKUs. Runtime errors: none.
- Approved customer `customer-qa@crystocraft.com`: fresh email/password sign-in PASS, correct QA company/USD storefront. Range 295 eligible designs/24 initial cards. Mini Butterfly Music Box detail loads prices, finishes and made-to-order ~9 weeks/MOQ100 after availability resolves; refresh PASS. Internal CRM URL redirects to `/shop`; no workspace heading or Settings link. Runtime errors: none. Signed out after checks.
- No live task/product test records, customer-message sends, summary regeneration or approvals performed. Save/retry/conflict/completion semantics exercised in the isolated regression suite; actual authorization exercised in the emulator. Ordinary login activity stamps may occur.
- Full locked-dependency prebuild: 441 reported checks/tests passed; 11 Firebase login-config tests passed; Vite production build passed (existing large-chunk warnings). Changed-code no-undef lint and diff checks passed.
- Firestore rules `c593373aa54b13a0deecb6a4b5c65cee5fb36d5512cece01f8f9bd08d941bf08` compiled/uploaded and released to the existing crystocraft-costing default native instance before app publication. Storage rules unchanged/not deployed.
- GitHub Actions main run: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38994060572 — success.
- Primary dirty-checkout porcelain fingerprint remains `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`; no unrelated changes staged or reset.

## Production evidence — PASS

Production deploy `6ad2d9bcff2cbe081abb5749`, application commit `c685a5bc171c8173e912273f603755f2adc9eec6`, published 17 October 2026 13:16:38 AEDT (02:16:38 UTC). Served `/assets/index-CAlizMgv.js`; sidebar V8.18 · 17 Oct, 13:16. Public Firebase configuration probe HTTP 200.

- Admin `claude-qa@crystocraft.com`: fresh email/password sign-in PASS, correct OC shell and Settings navigation. Dashboard has 23 workspace cards, exactly 4 carried legacy follow-ups; overdue filter narrows to 4 cards. Widdop record shows same cached summary/task and Interaction history (6). Reference-note editor opened/cancelled without any record writes. Refresh retained correct admin route/data. Range loads 297 products/722 SKUs. Runtime errors: none. Signed out afterward.
- Responsive customer-record task editor: viewport 375 px, document width 375 px, workspace width 341 px, textarea/date/status right edges 329 px; no horizontal overflow. Temporary viewport reset.
- Customer `customer-qa@crystocraft.com`: fresh email/password sign-in PASS; correct approved QA company/USD storefront, 295 eligible Range designs and product detail. Mini Butterfly Music Box loads finish prices USD12.51/12.84 and resolves availability to ~9 weeks/MOQ100. Refresh PASS. Internal CRM URL redirects to `/shop`, with no workspace heading or Settings link. Runtime errors: none. Signed out afterward.
- Main and feature branch GitHub Actions both completed successfully: main `38994060572`, branch `38994057227`.
- Save/complete/reopen/retry/conflict verification was isolated/emulated; production feature verification was read-only (editors cancelled), with no customer work records or live task fixtures created/modified.
- Evidence screenshots: `production-dashboard.png`, `production-customer-record.png`, `production-mobile-editor.png`, `production-portal.png`, plus corresponding candidate screenshots; delivered in the task's visualization evidence folder.

Local application commit, remote main, Firestore rules release and Netlify app publication are separate verified states. This documentation-only follow-up uses `[skip netlify]` and does not replace the browser-verified production app.
