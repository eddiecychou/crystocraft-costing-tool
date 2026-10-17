# Customer Pipeline — 17 October 2026

## Definition and operator workflow

One customer counts once. Specific product, sample, price or quotation requests qualify. AI suggests additions, updates and closures from shared email / WhatsApp summaries. A human confirms every change. Routine correspondence, past orders and historical interaction statuses do not count.

1. Choose **2 weeks**, **1 month** or **3 months** on Dashboard or the customer page. The period is remembered on this browser. Refresh **Customer Summary & To-do** on Dashboard when newer or fuller conversations are needed. Each period keeps its own saved summaries; selecting a period does not spend an AI call.
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

## Expanded summary periods

14/30/90-day source cutoffs apply to CRM, email and WhatsApp. The legacy `weekly_summary` cache remains the 30-day cache; `customer_summary_14` and `customer_summary_90` are separate. New summaries request 3–6 factual sentences covering requests, decisions and outstanding matters. Large sources use dated excerpts spread across the period, prioritizing current activity, and display a coverage notice. All active customers are processed in batches of six; nothing silently stops at 40 customers. Complete validated batches are required before replacing any saved period. A failed run preserves the previous cache. Old cached short summaries become fuller when refreshed. Pipeline suggestions record their source cache, and review verifies that exact period’s current source; changing the display period does not close or reset Pipeline/tasks.

## Candidate verification — PASS

- Application commit: `b2a419d82b3a9ebc060a4d5dc1dfcd49c7c53726` (includes Pipeline `5495a915`).
- Final candidate: `6ad2e987113353641a6fb0b4`, served `/assets/index-CAhhePP7.js`, sidebar V8.18 / 17 Oct 14:19 AEDT.
- 473 prebuild checks/tests; 112 Firestore/Storage access assertions; 7 real customer-merge cases and 7 Pipeline transaction cases; 11 Firebase-config tests; build, no-undef lint and diff checks passed.
- Branch GitHub Actions `38998573118`: success.
- Fresh admin email/password sign-in: PASS. OC dashboard, 297 Range products / 722 SKUs, Settings/Portal links, remembered summary period after reload, all 4 immediate tile drill-downs, customer page period choices and Add/Cancel, no runtime errors.
- Fresh approved customer email/password sign-in: PASS. Wholesale portal, 295 designs, actual product detail/pricing/9-week lead time/MOQ, correct shell after refresh, internal dashboard URL redirects, no supplier/internal controls, no runtime errors.
- Approved QA identities: `claude-qa@crystocraft.com` / `customer-qa@crystocraft.com`. Credentials were not recorded. Both candidate sessions signed out afterward.
- Live AI probes used fictional input with no business writes: Pipeline 200 / repeat request proposed active; 90-day summary 200 / 565 characters. Both endpoints anonymous 401, customer 403. These probes supplement, rather than replace, browser login evidence.
- Final Firestore rules deployed separately, hash `361ef64fec7427936723da2f670eb1f49fd68140f0ac736c65f5bbf4a3fc6ef3`; Storage unchanged.
- Desktop review, fictional review/confirmation and narrow 375px iframe layout verified. Screenshots live in the task evidence folder `customer-pipeline-2026-10-17`.
- Earlier candidate `6ad2e8570aef6e4e784a8f75` was superseded before release by the period-choice build; it is not the release proof.

## Production verification

PASS — production deployment `6ad2eab6bae85557f7dbaaeb`, application commit `b2a419d82b3a9ebc060a4d5dc1dfcd49c7c53726`, published 2026-10-17 03:29:05 UTC / 14:29:05 AEDT. Served `/assets/index-DHtoz7J3.js`; sidebar V8.18 / 17 Oct 14:28. Main GitHub Actions `38998737979` and branch `38998573118` both succeeded.

- Fresh admin email/password sign-in: PASS. Correct admin shell and identity, 297 Range products / 722 SKUs; Settings/Portal navigation, remembered 90-day period after reload, 14/30/90-day controls, all four figure drill-downs replacing general summaries (4 overdue tasks, 0 confirmed Pipeline customers, 11 active orders, 12 recent orders), customer-page Pipeline form opened and cancelled without saving, no runtime errors.
- Fresh approved customer email/password sign-in: PASS. Wholesale portal and QA company, 295 designs / 24 initial cards, real Mini Butterfly Music Box detail with prices USD 12.51/12.84, approximately 9 weeks / MOQ 100. Refresh preserved correct shell/detail. Internal dashboard URL redirected to storefront; no supplier/internal controls or runtime errors. Both QA sessions signed out afterward.
- Both production AI endpoints passed fictional-input tests without business writes: Pipeline proposed the unresolved repeat request as active (200); 90-day summary returned a fuller 479-character digest (200). Both endpoints denied anonymous (401) and customer (403) callers. Firebase public configuration probe passed (200); this was supplemental to the real-page sign-ins.
- Final Firestore rules hash remains `361ef64fec7427936723da2f670eb1f49fd68140f0ac736c65f5bbf4a3fc6ef3`; Storage rules unchanged/not deployed. No fixture customers, Pipeline approvals/closures, or live order/product writes were performed. Ordinary login activity may be stamped.
- Evidence: task-local `customer-pipeline-2026-10-17/{candidate-dashboard,candidate-customer,production-dashboard,production-customer,fictional-review,fictional-mobile}.png`.
- Original dirty checkout preserved; porcelain fingerprint `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`. Release record follow-up uses `[skip netlify]` to retain this verified application deployment.

## Evidence-check repair and completed transactions — 17 October

The read-only reproduction of the failed six-customer batch returned HTTP 200 from DeepSeek but proposed `active` with `request_kind:none` twice. After clarifying that rule, the model proposed `inactive` for an already-inactive customer. Both were correctly rejected; the generic error hid the actual contradiction. Completed transactions and fulfilment alone are not new buying requests or state changes. The corrected prompt and targeted validation feedback passed the same approved six-summary diagnostic with an empty suggestion list, no business writes.

The server now offers deterministic evidence passage IDs and copies the selected passage verbatim from the source digest. Unknown references, invented quotes, invalid IDs, unsupported closures and incomplete responses still fail closed. Legacy verbatim output remains strictly validated. Small two-customer calls split into singleton calls on AI 502 errors; an unsupported individual cannot stop unrelated customers. Remaining failures are reported explicitly with safe failure codes. Staging remains proposal-only with unchanged transaction/revision/hash/merge-lock safeguards.

**Transaction completed** appears on Dashboard and customer Pipeline panels. It opens an inactive-position review explaining that every buying request must be resolved and separate repeat requests keep the customer active. Cancel writes nothing; only **Confirm closure** writes the audited manual decision. Orders, invoices, tasks, notes and interactions are unchanged. No live closures/approvals are part of this repair.

Verification/release evidence to be recorded after candidate and production checks.
