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

## Candidate evidence — PASS

Application commit `175f8818658abe0e1bec23671f1ddd2eaeea6951`.
Candidate deploy `6ad2de6dcaa270ee15f2250d`, https://6ad2de6dcaa270ee15f2250d--ua-product-manager.netlify.app ; served `/assets/index-DqEk8YuA.js`; public Firebase configuration probe HTTP 200.

- Fresh admin email/password sign-in (`claude-qa@crystocraft.com`): correct OC dashboard and admin navigation, four carried follow-ups, shared customer workspace and preserved history. Read-only merge preview shows the retained-history promise and full counts; preview cancelled without submission. Customer-record refresh PASS; Range 297 products/722 SKUs. No runtime errors.
- Fresh approved customer email/password sign-in (`customer-qa@crystocraft.com`): correct QA company/USD storefront; Range 295 designs and product detail/finish prices. Refresh PASS; availability resolves to ~9 weeks/MOQ100. Internal customer-record URL redirects to `/shop`; no Settings/admin navigation. No runtime errors. Both QA sessions signed out.
- Real endpoint authorization probes (supplemental to browser sign-ins): anonymous 401; valid admin with identical source/target IDs 400 before merge; valid customer 403 before merge. No merge or business-record writes possible for those requests. Auth tokens/credentials kept private.
- Firestore rules hash `f2d79f127524f1b53940359822ea28b778ae6a05efe477f1ba63e017476ea2ec` compiled/uploaded and released before app publication. Storage rules unchanged/not deployed.
- Feature branch GitHub Actions run `38995458218`: success, including the new emulator job.

All destructive-transfer tests used local emulator fixtures. No real customer records were merged during release verification. Normal QA login activity may be stamped.

## Production evidence — PASS

Production application deploy `6ad2df5106849e348ff19c3c`, commit `175f8818658abe0e1bec23671f1ddd2eaeea6951`, published 17 October 2026 13:40:11 AEDT (02:40:11 UTC). Served `/assets/index-BdWKraA0.js`; sidebar V8.18 · 17 Oct, 13:39. Public Firebase configuration probe HTTP 200.

- Admin `claude-qa@crystocraft.com`: fresh real-page email/password sign-in PASS; correct OC shell/admin navigation, four carried follow-ups and no workspace alert. Widdop customer record history (6) remains accessible. Merge preview shows the retained-history promise and full source counts (799 email threads at verification); cancelled without submitting. Refresh PASS; Range 297 products/722 SKUs. Runtime errors: none. Signed out.
- Approved customer `customer-qa@crystocraft.com`: fresh real-page email/password sign-in PASS; correct approved QA company/USD storefront. Range 295 designs and Mini Butterfly Music Box finish prices/lead time load. Product refresh PASS; availability resolves to ~9 weeks/MOQ100. Internal customer-record URL redirects to `/shop`; no Settings link or merge controls. Runtime errors: none. Signed out.
- Production real-token endpoint checks: admin invalid same-record input returns 400 before any merge; customer returns 403 before any merge. These supplement, not replace, fresh browser sign-ins. No business-record writes.
- GitHub Actions main `38995627078` and release branch `38995458218` both success, including the new merge-emulator job. Local tests: 446 prebuild checks, 112 Firestore/Storage assertions, 7 actual-transaction emulator scenarios, 11 Firebase config tests, production build and changed-code lint passed.
- Firestore rules were separately released at hash `f2d79f127524f1b53940359822ea28b778ae6a05efe477f1ba63e017476ea2ec`. Storage rules unchanged/not deployed.
- Screenshots: candidate/production preview (preview-only, cancelled), customer-record view and customer portal, in the task's visualization evidence folder. No live customers or work items were created, merged or modified for QA; ordinary login-activity stamps may occur.

Primary checkout remains untouched (porcelain fingerprint `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`). Evidence-only follow-up uses `[skip netlify]`; the verified application deployment remains unchanged.
