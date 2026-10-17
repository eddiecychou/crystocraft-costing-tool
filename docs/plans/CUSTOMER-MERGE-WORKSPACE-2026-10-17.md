# Customer merges preserve both workspaces — 17 October 2026

Owner request: keep all tasks, notes and interaction history whichever customer survives, then test and deploy. Supersedes the previous workspace merge restriction.

## User behaviour

An administrator opens Merge on the duplicate and chooses the record to keep. Preview includes tasks (including completed), notes (including archived), interactions and email/WhatsApp/Alibaba history. The surviving customer's existing entries stay intact. Conflicting IDs produce distinct preserved entries; no text-based deduplication discards history. Both customer-level notes are retained with source attribution. Existing scalar fields on the survivor win; blank fields, flags, contact lists and linked marketing-contact history are merged using the shared preview/server policy. Contact-ID collisions preserve both people and remap source contact references.

The merge automatically continues in bounded server requests for large histories. On interruption, reopen the SAME customer pair and retry; completed transfers are not duplicated. Other merges involving either locked customer are refused until this operation finishes. The source leaves the customer list only after destination content and audit copies have been verified.

## Implementation and boundaries

- `/api/customer-merge`: authenticated Firebase session with revoked-token check and server-read **admin** profile. No shared secret, client-supplied fields or arbitrary destination paths. Staff/customer/anonymous calls denied. Admin-only because it also reassigns portal customer ownership; no roles, approval or pricing fields change.
- Server-only Admin SDK copies work_items, enquiries, email_threads, whatsapp_threads, alibaba_threads and assets. WhatsApp media URL spill documents are copied under the corresponding destination thread. Blob paths/URLs and attachments remain unchanged.
- Original dates, authors, revision numbers, completion/archive state, due dates, descriptions and legacy follow-up metadata are preserved. Original unmodified records are retained privately under `customer_merges/{sourceId}/history`, with parent snapshots and per-entry destination/fingerprint receipts. Client access to that audit tree is denied by default.
- Each transfer transaction writes destination + audit + receipt and removes the source entry atomically. Same-ID collisions use a deterministic source-path hash. An occupied collision destination fails closed. Finalization verifies every receipt, destination and original audit fingerprint, checks for late source inserts/references, merges customer notes, clears survivor lock and removes source parent together.
- Both customer workspaces are frozen through a server-owned customer_merge_lock. Client rules prevent forging/clearing the lock, stale task/interaction writes and orphan creation after a merge. Internal data stays customers-capability only; no new portal access. Storage rules unchanged.
- Lease/token ownership prevents overlapping workers; expired/interrupted requests can resume. Batch work is bounded and continuations retain receipts. Imported email/WhatsApp background workers using Admin SDK are outside client rules; source changes before finalization are rechecked. Source-specific local archive manifests remain operator-owned; no local files or third-party services are modified by this endpoint.
- Orders, quotes, portal customer_id and branded-photo customer tags are reassigned as before, with their other fields untouched. Source customer notes and contacts are included in private pre-merge snapshots.
- Browser never performs the destructive transfer itself. No live customer merge is performed as release QA.

## Checks

- `npm run test:customer-workspace`: existing shared UI tests plus merge field/auth/continuation regressions.
- `qa/customer-merge-emulator.mjs`: actual Admin SDK/Firestore transactions, both survivor directions, complete/archived and same-ID work items, interaction attachments/dates, all message channels and WhatsApp media, private original audit, account role/pricing retention, idempotent replay, failure/retry, lock conflict, >500 entries and invalid targets. Refuses non-local emulator targets.
- `qa/rbac-rules.test.mjs`: full Firestore/Storage regression suite, including server-owned merge locks and stale/orphan write denial.
- GitHub Actions runs the merge emulator suite in a separate Java/Firebase emulator job; no production credentials or fixtures.

Release commit, deploys, test counts and two-role login evidence appended after verification.

Local verification: 446 prebuild checks passed; 17 customer-workspace/merge unit and UI tests included. Firestore/Storage RBAC suite: 112 passed, zero failed. Merge emulator: seven actual-transaction cases, including both survivor directions, 505 entries and concurrent request refusal. Production Vite build, changed-code no-undef lint, 11 Firebase configuration tests and diff checks passed. Release browser checks follow.
