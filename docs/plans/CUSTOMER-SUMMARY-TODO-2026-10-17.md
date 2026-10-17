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
