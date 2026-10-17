# Customer Pipeline — 17 October 2026

## Definition and operator workflow

One customer counts once. Specific product, sample, price or quotation requests qualify. AI suggests additions, updates and closures from shared email / WhatsApp summaries. A human confirms every change. Routine correspondence, past orders and historical interaction statuses do not count.

1. Refresh **Customer Summary & To-do** when newer conversations are needed.
2. Click **Suggest from summaries**. All saved summaries are reviewed in bounded batches; the category chips filter the displayed customer list.
3. **Review suggestion**, check the reason and verbatim evidence, edit if necessary, then **Confirm active customer** or **Confirm closure**. Cancel saves nothing; Dismiss leaves the confirmed position unchanged.
4. Keep every unresolved repeat-order request in the position. An agreed order proceeds through Orders but does not automatically remove the customer.
5. Open a customer (or select one on Dashboard) to add/edit a position manually. Tasks, notes and interaction history remain preserved.

The new count starts at zero until customers are confirmed. Old interaction matches are not migrated into approved Pipeline. Refreshing summaries, order confirmation and falling outside the summary's 30-day window never close a customer. Existing digest policy excludes Retail-tagged customers from AI summaries; their Pipeline remains manually manageable. AI is advisory and can miss requests.

Clicking any dashboard figure opens its content immediately below the figures, replacing the general summary view while selected. Click again or use **Back to summaries**. Overdue content reuses shared task controls and shows overdue tasks only. Other order/due count definitions are unchanged by this release.

## Data and safeguards

- Customer `sales_pipeline`: confirmed status/detail, optional proposal, revision, reviewed summary hash, actor/time, action and stable event id. Normal customer form edits preserve this map.
- `customers/{id}/pipeline_history/{eventId}`: immutable before/after audit, written atomically with the position. Admin/CRM-capable staff only. Customer, anonymous and supply-only roles denied; no new portal grant.
- Customer revision + merge lock checked transactionally. Editor revision frozen at open; stable event IDs prevent duplicate retries. AI staging and confirmation check the current cached summary hash. Stale results cannot overwrite human decisions.
- `POST /api/pipeline-suggestions`: customers-module authorization, existing DeepSeek server secret, at most six customers per call, bounded strings, complete JSON required, one retry, exact IDs and verbatim evidence validation. Unsupported batches save nothing; prior successful batches resume on retry.
- Reviewed/dismissed summary hashes are not suggested again until changed. A newer proposal replaces only the proposal, never the confirmed position.
- Customer merges keep an active position from either record, combine both active request texts, bump revision, invalidate proposals and preserve both full audit histories collision-safely. Private original merge snapshots remain intact.
- No live fixture customers or actual customer Pipeline decisions during QA.

## Verification and release

Final release evidence pending. CI includes transition/AI/UI regressions and local Firestore emulator cases for atomic history, retries, concurrency, stale summaries, merge locks, role separation and both merge directions.
Fictional visual QA: `node qa/customer-pipeline-preview.mjs` (port 5191); its mocked data API cannot write to Firebase.
