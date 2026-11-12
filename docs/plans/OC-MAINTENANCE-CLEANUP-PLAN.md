# OC maintenance and code cleanup plan

**12 November — Invoice follow-up reviewed.** Fictional Chrome shutdown tests
confirmed that failed follow-ups stay pending and that a delayed write can
reach the original invoice after manual review and a split. Make the write and
review coordinate at the SQL boundary before adding automatic retries. The
proposed worker is limited to issued and linked invoices. Packing/Freight
ownership remains the next separate review.
[Findings and proposed fix](V8.20-INVOICE-FOLLOWUP-BROWSER-CLOSURE-REVIEW.md).

**12 November — SH-07 released as `443173e`.** Direct Invoice follow-up recovery,
manual/PI/copy requests and the 20 MB original-file limit are published after both
exact-SHA jobs and fresh candidate/production roles. Intentional repeats and
split/reissued invoices remain independent; no historical backfill or test issuance
in production. [Migration and evidence](V8.20-SHIPPING-RECOVERY-RELEASE.md).
The subsequent [credit-note permission fix](V8.20-CREDIT-NOTE-PERMISSION-REVIEW.md)
is applied and verified. The current invoice follow-up review is linked above.

**12 November — SH-07 release-readiness review complete; publication on hold.**
Existing combined suites/build and 11 Chrome scenarios pass, including intentional
repeat orders and split/reissued invoices. A newly reproduced initial Direct
Invoice completion shortcut leaves financial follow-up pending; correct its
status/retry path before release. PI originals also lack an explicit size ceiling.
Application source and production are unchanged. [Findings and next steps](V8.20-SHIPPING-RECOVERY-RELEASE-READINESS.md).
Saved-order concurrent-edit protection was already released as `55ee1d3`;
the older 9 November proposal below is historical. After SH-07, independently
review durable financial follow-up, then Packing/Freight async ownership.

**9 November — Concurrent saved-order editing reviewed.** Ten actual SDK/rules
scenarios confirm commercial last-writer loss and online/offline mixed states.
The proposed next correction adds a coherent edit baseline, commit-enforced
commercial version and retained-draft conflict review. Implementation follows
review of the writer map and offline/legacy rollout contract.
[Reproductions and proposed repair](V8.20-SAVED-ORDER-CONCURRENCY-REVIEW.md).

**9 November — Saved-order request list loading corrected locally.** The shared
Shipping/Direct Invoice panel now abandons old reads on close, unmount and
operator change, serializes pagination and retries the failed cursor. Five
component regressions and the full 1,141-test prebuild/build pass. This joins
the local SH-07 work awaiting release. Its current readiness findings are linked
above; the concurrent-edit fix was subsequently released separately.
[Finding, ownership and verification](V8.20-SAVED-ORDER-REQUESTS-LOADING.md).

**9 November — General Create recovery is implemented locally.** Manual orders, PI imports, Duplicate Order and initial Direct Invoice now have recoverable requests. The next separate review is concurrent editing of an existing order. [Manual and PI recovery](V8.20-MANUAL-ORDER-PI-RECOVERY.md) · [Duplicate Order](V8.20-DUPLICATE-ORDER-RECOVERY.md) · [Initial Direct Invoice](V8.20-INITIAL-DIRECT-INVOICE-RECOVERY.md).

**8 November — General Create recovery reviewed (SH-07).** Start with a
recoverable request for manual orders and PI imports, then reuse it for Duplicate
UC allocation and initial Direct Invoice creation. Existing saved-order invoice
recovery passes its split and reissue regressions. Concurrent saved-order editing
and durable financial follow-up remain separate reviews.
[Fictional findings, rollout boundaries and proposed sequence](V8.20-GENERAL-ORDER-CREATE-RECOVERY-REVIEW.md).

**8 November — SH-08 released:**
[Quote → Order durable recovery](V8.20-QUOTE-ORDER-CONVERSION-RECOVERY.md) is live
as dd053d7 / production `6af0400b2d921e13640ca822`. Per-intent atomic recovery,
explicit additional orders, retained legacy links and quote-copy lifecycle pass
30 unit/page, 29 real SDK, 13 Chrome and existing Shipping/RBAC/save/invoice checks.
Both exact-SHA jobs, fresh candidate/production roles, actual SDK Retry, read-only
live status/customer denial, rules readback and artifact identity PASS. Storage/
SQL and historical records unchanged. Refresh old tabs; broader SH-07 manual-
Create identity remains separate. The dated read-only review below is historical.

**8 November — SH-08 reviewed, not implemented:**
[Quote → Order conversion recovery](V8.20-QUOTE-ORDER-CONVERSION-RECOVERY-REVIEW.md)
reproduces re-entry, two-tab/backlink and inherited quote-copy ownership gaps.
Sixteen real-page/Router characterizations, seven actual SDK/current-rules demo
cases and 191 existing Shipping regressions pass. Proposed next: durable intent
per order, atomic SO/order/lines/receipt/link, existing-order Open/Resume and
explicit additional-order intent. No one-order-per-quote constraint, historical
deduplication or live data change. Migration, stale-tab limits and acceptance
gates are documented before implementation; no application code or deployment.

**8 November — SH-06 released:** [Quote initialization/Retry](V8.20-QUOTE-INITIALIZATION-FIX.md)
is live as 97cbf5d / production `6af0018353779a88119df400`. Complete read attempts
precede editing/Create; failures have Retry and abandoned callbacks cannot
replace edits. Twenty new cases, 191 Shipping cases, twenty Chrome cases and
1,099 prebuild/build/lint pass. Both exact-SHA jobs, fresh candidate/production
roles and actual SDK missing-source/Retry/refusal checks PASS; no real order or
financial number created. No rules/SQL changes. Next: separately review SH-08
conversion re-entry/backlinks and intentional multiple-order policy.

**8 November — SH-05B released:** [durable retry/recovery](V8.20-INVOICE-RETRY-RECOVERY.md)
is live as `9a5d93a` / production `6aefde0cde2e82d8e4dbb8d0`, after both exact-SHA
jobs and fresh candidate/production admin/customer gates. Native PostgreSQL,
actual Firebase/SQL, real-form/UI and 1,079 prebuild cases/build/lint pass.
Rules/SQL readbacks and candidate/production artifact matches pass; no production
numbers or customer emails used. Explicit split/reissued and historical invoices
are preserved. Next: fresh bounded review of SH-06/07/08 Create/conversion policy.

**8 November — SH-05A released:** the owner-approved permission-only transaction
is applied and [verified](V8.20-INVOICE-ALLOCATOR-PERMISSIONS.md). Effective public
roles are refused; the server grant and function identity/body are preserved.
Eighteen real PostgreSQL cases, 58 combined cases, 1,071 prebuild cases/build/lint,
both exact-SHA jobs and fresh candidate/production role/gateway checks pass. No
production number or financial-row write was used. Existing app/rules publication
is unchanged. **Next: SH-05B durable per-intent retry/relink recovery**, preserving
split/reissued invoices. The dated 7 November review below is historical.

**7 November follow-up:** SH-03 customer accounting-payable PDF/Excel correction
is [released as 96ba538 and verified](V8.20-CUSTOMER-INVOICE-PAYABLE-FIX.md): 68 invoice
cases, 1,027 prebuild cases, 26 local PDF/XLSX pairs, both exact-SHA jobs and fresh
candidate/production admin/customer gates pass. Ten further served-renderer
fictional export pairs pass. No live financial records/numbers or rules changed.
The [SH-05 read-only deployed review and recovery plan](V8.20-INVOICE-ALLOCATION-RECOVERY-REVIEW.md)
is complete: first review/test service-only allocator execution hardening, then
durable per-intent recovery. PUBLIC execution remains a confirmed open gap;
no grants/schema changed and split/reissued invoices remain supported by design.

**6 November stopping point:** the owner requested a documented handoff before
switching to Crystal Components. [Current cleanup handoff](V8.20-CLEANUP-HANDOFF-2026-11-06.md)
consolidates released work through final financial Re-sync `3022bfe`, remaining
SH-03/05/06/07/08 findings and lessons. Customer export correction is deferred;
the separately authorized Crystal Components feature does not close Shipping
debt or authorize deployment. Earlier entries below retain their dated sequence.

Updated 6 November 2026 (Sydney). Goal: make changes easier to understand and
verify while preserving existing functions, screens and commercial behaviour.
This is a staged maintenance plan, not a rewrite or permission to execute every
future batch. The first CRM batch and separately requested fixes are released;
the Daily Drafts targeting and Sent-history/source-badge slices are released
and verified after both exact-SHA jobs and fresh candidate/production role gates.
Remaining work and release status are distinguished below.
The standing-rules, topic-composer, attachment-control and master-refinement
presentation slices, followed by Pending Review cards and the bulk toolbar, are
released and verified under the owner's subsequent explicit requests.

**3 November health review:** the existing suites/build, exact-SHA jobs and fresh
production role checks pass, but new actual-page checks expose an invoice-save
regression from the separate Woo repair and older hidden save-error/customer
navigation defects. Pause further extraction for bounded corrective work:
invoice save validation/feedback, then customer read/state isolation, then
Schedule & Terms. None is repaired or released by the audit.
[Findings, reproductions and limits](V8.20-CLEANUP-HEALTH-REVIEW-2026-11-03.md).

The owner subsequently authorized those corrections. Save and customer-navigation
fixes are released as 37ea5b2a after both exact-SHA jobs, full build and fresh
candidate/production role/feature gates. [Correction evidence](V8.20-SAVE-AND-CUSTOMER-NAVIGATION-FIXES.md).
The owner authorized [Schedule & Terms](V8.20-SCHEDULE-TERMS-CLEANUP.md) as the next extraction.


Start with [CLAUDE.md](../../CLAUDE.md), the
[maintenance map](../reference/MAINTENANCE-MAP.md),
[architecture boundaries](../skills/ARCHITECTURE-RULES.md) and
[current handoff](V8.20-SESSION-HANDOFF-2026-11-01.md).
The [code/data baseline](../reference/OC-SIZE-SNAPSHOT-2026-11-01.md) explains
the scope and measurement limits. Large files identify places to inspect;
line count alone does not justify a rewrite, deletion or changed data model.

## Order and status

| Batch | Status | Deliverable and reason | Risk / completion gate |
|---|---|---|---|
| 0 — ownership and baseline | Complete | Maintenance map, feature routing, source/data snapshot and release evidence links | Keep facts dated; do not call historical measurements current |
| 1 — CRM viewers, cards and dialogs | Released | Independent components in src/components/crm; pages retain subscriptions, saves and workflow composition | Original extraction parity, real component tests, workspace/emulator checks and two-role release gates passed |
| 2 — Daily Drafts presentation | Eight planned presentation slices released; workflow logic retained | Targeting, Sent/reply, rules, topic/master fields, attachments, master chat, cards and bulk controls extracted; parent retains state, generation and writes | All eight slices pass source/visual checks, real-page tests, exact-SHA CI and fresh candidate/production admin/customer gates |
| 3 — repeated server authentication helpers | Both pilot endpoints released/verified; broader convergence proposed | Drafting and refinement use the existing marketing helper; other endpoints require separate caller/capability review | 38 contracts, auth-only source restoration, both exact-SHA jobs and fresh candidate/production role gates pass; QA audit repair retains every assertion/deadline |
| 4 — shipping and finance page internals | Presentation, import, creation/save mappings and classification released; lifecycle corrections released and verified | Page retains workflow sequencing and state; focused helpers own field mapping and classification | Per-slice original/extracted form and Chrome checks, invoice/packing regressions, exact-SHA CI and fresh role/shipping gates pass |
| 5 — prototypes, imports and obsolete paths | Proposed audit first | Map routes/imports/external callers, identify active/paused/archive candidates | No removal from file size or old comments alone; reversible archival only after usage review |
| 6 — storage retention | Separate proposed business/data track | Read-only ownership/reference/duplicate review, with evidence and proposed actions | No file deletion, lifecycle policy, stock correction or record migration without specific review/authorization |

The suggested order balances benefit and blast radius. It is not a promise to
complete all rows in one release. Each batch starts by checking current source,
usage and tests again; the remaining plan is not implementation approval.

## Completed first batch and subsequent repairs

[CRM maintenance](V8.20-CRM-MAINTENANCE.md) moved four lead viewers and independent
customer cards/dialogs, keeping original function bodies and compatibility
exports. CustomerDetail still owns customer subscriptions, task/summary/link
composition, page saves and invitation handling. MarketingContactDetail imports
dedicated components rather than a list page. No mass domain-module split or
new global state system was introduced.

Two later owner-requested corrections are separate from the extraction:
[customer section spacing](V8.20-CUSTOMER-SECTION-SPACING.md) and
[lead interaction history](V8.20-LEAD-INTERACTION-HISTORY.md). The latter restored
the missing collection-scoped date indexes and added read-error/Retry handling;
it was not silently folded into a behaviour-preserving move. Release identities,
checks and results are in those reports, not inferred from the cycle label.

## Batch 2 — presentation, targeting and Sent released

On 2 November the owner requested the next cleanup task. The
[targeting-panel slice](V8.20-DAILY-DRAFTS-TARGETING-CLEANUP.md) is implemented
and verified, then pushed/deployed under the owner's explicit release request
after both GitHub jobs passed. The rest of the batch remains open. The following
describes the boundary for subsequent slices.

The [Sent-history slice](V8.20-DAILY-DRAFTS-SENT-CLEANUP.md) is now implemented
and released. It moves presentation and the shared source label only; reply
handlers/state and writes remain in the page. Source/desktop/mobile parity,
16 real-page cases, both exact-SHA GitHub jobs and fresh candidate/production
admin/customer gates pass. Live reply forms were opened/changed/cancelled;
no reply submitted or email sent. Further slices remain open, not authorized
automatically by this roadmap.

The [standing-rules slice](V8.20-DAILY-DRAFTS-STANDING-RULES-CLEANUP.md) is
implemented and released. It preserves the two-step approval gate and all
parent handlers/state; only presentation moves. Twenty-eight real-page cases,
source/visual checks, exact-SHA CI, clean build and candidate/production role
gates pass. Live checks only opened/changed/cancelled unsaved input. Next possible presentation
slices are topic composition and individual Pending draft cards, selected and
verified separately; no change to AI prompts, recipients or sending is implied.

Suggested separate QA follow-up before further cleanup: investigate the
recurring workspace emulator stall recorded in [TECH-DEBT.md](../../TECH-DEBT.md).
Both recent releases needed unchanged-SHA retries after the last reported
workspace case 20. The cause is unconfirmed; retain all assertions and mandatory
release gates while reproducing/instrumenting it. The investigation repaired
the confirmed missing await/process deadlines; both GitHub jobs passed on
31dbd725, first attempt. All assertions remain and production is unchanged.
The original intermittent trigger was not reproduced and remains open; a
future failure should now name its step or bounded test process before any
release proceeds. Further presentation slices remain separately proposed.
[Evidence and limits](V8.20-WORKSPACE-CI-RELIABILITY.md).

The authorized topic-composer slice moves only topic/saved-template controls
and master subject/body fields into DailyDraftsComposer.jsx. State, AI/prompt
assembly and template handlers stay in the page. Nine new real-page cases and
source/desktop/mobile parity pass. Both exact-SHA jobs and fresh candidate/
production admin/customer gates pass in the
[composer record](V8.20-DAILY-DRAFTS-COMPOSER-CLEANUP.md). Product/link/media
presentation is covered by the attachment slice below.

The newly authorized attachment slice moves product/link controls and master
image presentation into DailyDraftsAttachments.jsx. Storage, gallery visibility,
state, the two-image cap and payloads stay in the page. Eleven new cases, exact
source recovery, six desktop/mobile screenshot pairs, both exact-SHA jobs and
fresh candidate/production role gates pass in the [attachment record](V8.20-DAILY-DRAFTS-ATTACHMENTS-CLEANUP.md).

The newly authorized master refinement-chat slice moves controlled markup to
DailyDraftsMasterChat.jsx. State, discussDraft payload/history, master updates and
rule approval stay in the page. Twelve new cases, whole-page source recovery,
six desktop/mobile screenshot pairs, both exact-SHA jobs and fresh candidate/production role gates pass in the
[refinement record](V8.20-DAILY-DRAFTS-REFINEMENT-CLEANUP.md).
Pending Review cards were authorized separately and are recorded below.

The authorized Pending Review slice moves card presentation to
DailyDraftReviewCard.jsx. The page retains derived fields, state and every action/
write handler. Twenty-two new cases, exact whole-page source recovery, six
pixel-identical desktop/mobile states, both exact-SHA jobs and fresh deployed
role gates pass in the [Pending Review record](V8.20-DAILY-DRAFTS-PENDING-CLEANUP.md).
No subsequent presentation or server-helper slice is authorized by this plan.

The newly authorized bulk-toolbar slice moves header/count, editor/progress/error
and Clear-control markup into DailyDraftsPendingToolbar.jsx. The page retains
all sequencing, snapshots, edit/history updates and confirmation/deletion.
Twelve new cases, six pixel-identical desktop/mobile states, both exact-SHA jobs
and fresh candidate/production role gates pass in the [bulk record](V8.20-DAILY-DRAFTS-BULK-CLEANUP.md).
The owner subsequently authorized the access-control allow/deny contract matrix,
implemented as a tests/docs-only batch in the [contract record](V8.20-ACCESS-CONTRACTS.md).
It changes no application code or rules. Further shared-auth migrations, permission policy
changes, import repair and storage deletion remain separate proposed work.

Start in src/marketing/DailyDrafts.jsx and the existing outreach domain/API
helpers. The page combines topic composition, recipient selection, generation,
draft editing, media and human-reviewed sending. First extract a self-contained
display/editor surface whose inputs and callbacks can remain identical. Keep
subscriptions, async orchestration, generation sequencing and send handlers in
the parent for this batch. Review desktop/mobile spacing, open/close state,
unsaved text and busy/error behaviour against the existing screen.

Before moving eligibility or payload logic in a later slice, characterize its
current behaviour using fictional data: customer versus lead identity, same-email
deduplication, suppression, already-contacted checks, cooldowns, candidate limits,
attachment ownership and original response/prompt contracts. Preserve current
values (including the current 14-day general and 21-day topic cooldowns), random
tie behaviour and per-recipient decisions. Avoid combining a presentation move
with changed AI prompts, recipient rules or automatic sends.

Acceptance: editing the approved master topic still precedes personalization;
users can review/refine each draft; generation/skip/reply status and explicit
send semantics are retained. Existing outreach-time and AI-writer checks remain;
add focused real-component/fixture coverage for the moved responsibility where
it exercises actual behaviour. Sending tests use fictional recipients and a
mock provider; live smoke checks never send to real customers.

## Batch 3 — server helper convergence

The [Daily Drafts pilot matrix](../reference/ACCESS-CONTROL-MATRIX.md) now pins
human role/module decisions, real signed-session verification, endpoint responses
and relevant Firestore/Storage read/create gates. It records CRM-versus-marketing
keys, profile-error behaviour and service/account-lifecycle limits. The owner
subsequently authorized the first [topic-endpoint migration](V8.20-TOPIC-AUTH-CLEANUP.md);
implementation, parity, exact-SHA CI and all candidate/production role gates pass.
The subsequently authorized [refinement migration](V8.20-REFINEMENT-AUTH-CLEANUP.md)
now passes parity/contracts, both exact-SHA jobs and all fresh role gates. Other endpoint
migrations remain proposed work, with caller-specific capability review required.

Start with the duplicate-helper entry in [TECH-DEBT.md](../../TECH-DEBT.md),
netlify/edge-functions/lib/auth.js and the endpoint's actual callers/Gate keys.
Record current status codes, payload shape, token validation, module keys and
allowed roles before replacing one local helper. Prove admin, staff with the
required module, staff without it, approved customer, unauthenticated and invalid
token outcomes. Preserve module any-match semantics where an array is used.

Do not infer identical permissions from a helper named isAdmin or isFrontOffice.
Do not retag an endpoint to another module during the extraction. Node Admin-SDK
initialization and Deno authentication are different boundaries; do not merge
them into one generic abstraction. The three deliberately open legacy endpoints
in TECH-DEBT remain an accepted owner decision unless separately reconsidered.
No broad auth/rules migration belongs in this cleanup batch.

## Batch 4 — shipping and finance

The owner authorized the first [shipment display slice](V8.20-SHIPMENT-DISPLAY-CLEANUP.md).
It extracts ERP comparison and the stock-state badge only, with exact source /
visual parity and independent display coverage. Parent calculations, subscriptions,
adoption and transactions remain. Both exact-SHA jobs and all fresh candidate /
production role/shipping gates pass; no financial or stock data was edited.
Further panels and pure-helper work remain proposed, separately bounded work.

The owner next authorized [Document References](V8.20-SHIPMENT-REFERENCES-CLEANUP.md).
Its controlled markup is extracted with original-page/actual-page, ref/focus,
allocation/error/write-boundary and source/visual parity checks. Parent number
and revision handlers, reads and writes remain unchanged. Both exact-SHA jobs,
the full build and all fresh candidate/production role/reference/focus checks
pass; the slice is released. A newly characterized saved WooCommerce total/HKD-payout gap is
separate financial work in TECH-DEBT, not silently fixed in the extraction.

The owner then authorized the bounded [Woo metadata repair/audit](V8.20-WOO-INVOICE-DATA-FIX.md):
preserve recorded checkout/HKD settlement data and guard unknown totals, retaining
allocator/backend/calculations. Historical discrepancies remain review-only;
no backfill or guessed conversion. Exact-SHA/build/fresh candidate/production
gates pass and the runtime fix is released. Dated snapshots preserve concurrent
non-QA finance activity; historical review remains separate.
[Schedule & Terms](V8.20-SCHEDULE-TERMS-CLEANUP.md) moves controlled markup only;
status confirmation, header state and all writes remain parent-owned.

[Destination and Remarks](V8.20-DESTINATION-REMARKS-CLEANUP.md) are released as
controlled panels. The form tests cover customer autofill and save/reopen.
The Proforma and Sales Invoice tests cover remarks and quantity visibility.

The [Line Items header](V8.20-LINE-ITEMS-HEADER-CLEANUP.md) is released.
ShipmentForm supplies the Add line and Re-match callbacks and warning count.
The form fixtures cover classification, removal and preservation of manual
classifications during matching.

The [Line row editor](V8.20-LINE-ROW-EDITOR-CLEANUP.md) is released.
ShipmentForm owns row identity, matching, image selection and persistence.
Form fixtures cover save and reopen, picker targeting and charge behavior.

The [read-only Order Totals rows](V8.20-ORDER-TOTALS-ROWS-CLEANUP.md) are
released. ShipmentForm calculates and formats the values, and owns the
editable financial controls.

The [Discount row](V8.20-SHIPMENT-DISCOUNT-CLEANUP.md) is released.
ShipmentDiscountRow renders the two controlled inputs. ShipmentForm retains
subtotal selection, both conversions, rounding and persistence.

[Accounting Total](V8.20-SHIPMENT-ACCOUNTING-TOTAL-CLEANUP.md) is released.
ShipmentAccountingTotal renders the amount, signed adjustment and reason.
ShipmentForm owns invoice visibility, calculations, validation and writes.
[Deposit Paid](V8.20-SHIPMENT-DEPOSIT-PAID-CLEANUP.md) is released.
ShipmentDepositPaid renders the amount, error and outstanding balance.
ShipmentForm retains state and persistence. The payment helpers and existing
PDF and Excel export behavior were verified with fictional invoices.

The [Shipping Customer card](V8.20-SHIPMENT-CUSTOMER-CARD-CLEANUP.md) is
released. ShipmentCustomerCard renders the existing customer and contact
controls and the unlinked PI prompt. ShipmentForm owns customer loading,
destination autofill, creation and order persistence.

The [PI Upload panel](V8.20-SHIPMENT-PI-UPLOAD-CLEANUP.md) is released.
ShipmentPiUpload renders the existing file controls, extraction feedback
and ERP comparison. ShipmentForm owns processing, extraction, matching,
ERP adoption and writes. Fictional PDF and PNG browser tests intercepted
requests on the candidate and production.

[PI file preparation](V8.20-SHIPMENT-PI-FILE-PREPARATION-CLEANUP.md) is
released. preparePiUploadFile owns PDF byte preservation and image resizing,
grayscale conversion and encoding. ShipmentForm still owns extraction and
applies parsed fields, matching and ERP checks. Browser fixtures matched
outgoing bytes and decoded image pixels before and after extraction.

[PI field mapping](V8.20-SHIPMENT-PI-HEADER-MAPPING-CLEANUP.md) is released.
applyExtractedPiHeader owns the precedence rules for customers, references,
schedule, terms and stated amounts. ShipmentForm applies it to the latest
draft and owns the request, line matching, ERP comparison and writes.
Fictional responses verified the original overwrite behavior.

[WooCommerce UC Registry autofill](V8.20-WOO-REGISTRY-PAYLOAD-CLEANUP.md)
is released. wooRegistryAutofillFields prepares the metadata payload.
ShipmentForm owns allocation, immediate number persistence, channel and
registry-id gates, missing-total guard and failure handling. Fictional
allocation flows preserved payload values, issued numbers and error feedback.

[Existing-order saved fields](V8.20-SHIPMENT-SAVE-PAYLOAD-CLEANUP.md)
are released. orderSaveFields prepares the updateOrder header patch.
The original mapping release retained validation/calculations and save
sequencing in ShipmentForm. The subsequent lifecycle repair replaced parallel
writes/timeout success with acknowledged atomic header/line saves; invoice
follow-up and navigation remain page-owned. Fictional save/reopen
fixtures verify complete payloads, retries and persisted field behavior.

[Invoice registry mapping](V8.20-INVOICE-REGISTRY-MAPPING-CLEANUP.md)
is released. invoiceRegistryFields prepares the financial-index payload
after a saved order. ShipmentForm owns the invoice guard, sequencing and
navigation. Fictional real-form and Chrome cases preserve computed and PI
fallback totals, metadata and the UC client's asynchronous failure behavior.

[New-order mapping](V8.20-SHIPMENT-CREATE-PAYLOAD-CLEANUP.md) is released.
orderCreateFields prepares source, file identity and normalized draft values.
ShipmentForm owns uploads, validation, the creation transaction, subsequent
invoice allocation, quote linkage and navigation. Fictional manual, PI,
direct and quote cases preserve payloads and failure behavior.

[Line classification](V8.20-SHIPMENT-LINE-CLASSIFICATION-CLEANUP.md) is
released. lineClassificationPatch prepares the field changes for a chosen
type using the existing matcher and packable lookup. ShipmentForm owns
state updates and persistence. Fictional matched/unmatched and type-switch
cases preserve descriptions, product links, packing flags and re-matching.

The [Shipping lifecycle review](V8.20-SHIPPING-LIFECYCLE-REVIEW-2026-11-06.md)
is complete on 4d675ce. Six faulty loading scenarios and two normal controls
were reproduced with actual Chrome/React Router. A fictional Save after a
stale response wrote A's data to B's mocked record. Eight controlled save
cases characterized partial completion, the six-second timeout and late
failures, including a line read that has not constructed any writes.

The owner authorized both corrections after that review. Route-scoped loading,
abandoned-response guards, missing/error Retry, atomic saves and acknowledged
pending/committed/error feedback are implemented in the
[correction record](V8.20-SHIPPING-LIFECYCLE-FIX.md), with release gates tracked
there. The relevant defective orchestration predates the cleanup.

Begin with an independent ShipmentForm display section or read-only summary.
Use existing helpers such as src/shipping.js, src/packing.js,
src/invoicePayments.js and src/invoiceExcel.js instead of inventing a second
calculation layer. A later pure-helper extraction must preserve inputs,
precision, currency, stored snapshots, line/source identity, document labels,
discount/deposit treatment and complete PDF/Excel output.

Keep Firestore transactions and stock/reservation/receipt idempotency together.
Do not split an atomic write into UI-level saves or recompute historical quotes
from current supplier prices. Relevant invoice, quote, packing/PO and stock
emulator checks remain mandatory. Export changes also require real saved PDF/
Excel inspection, including blank/zero deposit, long specs and mixed orientations
when those outputs are touched. Use fictional write fixtures and view-only live QA.

## Batches 5 and 6 — prove what is unused

Inventory static imports, route strings, scheduled jobs, deployment config,
external API callers and document links. Graphify must be refreshed before use
and does not prove runtime/route/external reachability. The paused Fly renderer
is distinct from the live Firebase swatch catalogue; the paused workbench is not
permission to delete all customizer files. Existing import tools may be rare
but necessary for operational recovery. Prefer a documented status first.

For files, map each Storage object/prefix to its owning record, references,
visibility, immutable generation and historical attachment/audit requirements.
Equal filenames, large byte counts or old timestamps do not prove duplication.
Separate confirmed candidates from unknown ownership; do not remove quote PDFs,
stock evidence, customer assets or shared originals as a code-cleanup side effect.
Any later archival/deletion proposal needs its own concrete reviewed list and
recovery/retention approach. This plan does not authorize execution of that list.

## Definition of done for each implementation slice

1. Pin a clean starting SHA, map consumers/data/write boundaries and record a
   small scope with unchanged contracts. Preserve unrelated work.
2. Extract one responsibility. Keep compatibility exports/call signatures where
   consumers need them; avoid unrelated naming/style/formatting churn.
3. Compare rendered behaviour and source/payload/query contracts. Exercise empty,
   populated, loading, error/retry, navigation/unmount and unsaved states as
   applicable. Keep real stateful hooks in emulator fixtures.
4. Run relevant existing regressions, full prebuild/build, whole-source no-undef
   and required configuration checks. Production index readiness needs live
   ordered-query evidence; an emulator pass alone does not establish it.
5. For an authorized release, follow [RELEASE-WORKFLOW.md](../skills/RELEASE-WORKFLOW.md):
   both exact-SHA GitHub jobs PASS before any deploy, immediate upload preflight,
   then fresh admin and approved-customer gates on candidate and production,
   reusing the verified candidate artifact. Rules/index changes are separate.
6. Update ownership, feature routing, lessons and a release report with evidence,
   exceptions and remaining work. Documentation-only closeout must not republish
   an unverified app. The plan itself does not authorize pushing or deploying.

Success is a clearer ownership boundary, easier review and unchanged existing
functions with evidence. A lower total line count, fewer files or a single
universal helper is not an acceptance criterion. If a pre-existing bug is found,
record/reproduce it against the baseline and handle it as a separately scoped
fix; do not mislabel a changed workflow as extraction parity.

The owner subsequently authorized both lifecycle repairs and their release.
Route-isolated loading/error/Retry and atomic header/line saves are implemented;
slow saves stay pending until acknowledged. Financial follow-up occurs afterward.
[Correction tests, offline/concurrency limits and release state](V8.20-SHIPPING-LIFECYCLE-FIX.md).
These repairs are released as 0fec1ff9 after both exact-SHA jobs, full build,
SDK/offline evidence and fresh candidate/production roles/readback. Further
cleanup remains a separately scoped slice, with concurrency/outbox work open.

## Saved-order header mapping follow-up

Following the released Shipping lifecycle repairs, the owner authorized the
[saved-header mapping slice](V8.20-SHIPMENT-HEADER-MAPPING-CLEANUP.md). The exact
editable-field whitelist now belongs to orderEditFields in shipping.js; the page
retains record isolation, guarded reads, Retry and acknowledged atomic-save
sequencing. Full field/default and legacy/Woo contracts are verified with fictional
records before the normal exact-SHA and two-role release gates. Release status is
tracked in that record. Concurrent editing and durable cross-system financial
synchronization remain separately scoped design tasks.

Saved-header mapping is released as 6a232360 after byte-identical source
restoration, eleven Chrome parity cases, twenty identical screenshot pairs,
full build, both exact-SHA jobs and fresh candidate/production role/shipping gates.
The next cleanup slice remains a separately reviewed scope.

## Page header/navigation and Shipping checkpoint

The owner authorized [page header/navigation cleanup](V8.20-SHIPMENT-NAVIGATION-CLEANUP.md).
One controlled component owns title/actions/feedback/tabs, while ShipmentForm
retains state, allocation, saves, route isolation and actual tab content. Existing
callbacks/disabled states and ordinary print links remain unchanged. Source,
real-form/Router and desktop/mobile parity precede the exact-SHA and role gates.

After its release, pause routine Shipping presentation extraction for a bounded
health/ownership review. Select broader roadmap work by measured maintenance
burden. Quote conversion/creation orchestration, totals composition, concurrent
editing and durable financial synchronization require separately reviewed scopes.

Header/navigation is released as af53c1b3 after exact source restoration,
17 Chrome cases, 44 identical screenshot pairs, full build, both GitHub jobs and
fresh candidate/production admin/customer plus real-tab/readback checks. The next
step is the separately proposed bounded Shipping health/ownership review.

## Shipping health/ownership checkpoint — reviewed, 6 November 2026

The owner authorized review/documentation with fictional records and a plan
before code changes. [Completed assessment](V8.20-SHIPPING-HEALTH-OWNERSHIP-REVIEW-2026-11-06.md):
149 existing Shipping cases pass; 33 additional characterizations reproduce
normal controls and uncovered correctness/recovery gaps. The affected mechanisms
predate recent cleanup. This is review-only; no runtime/test/config correction,
commit, push or deployment is included.

Prioritize bounded correctness work over more presentation extractions:

1. P1 PI file/result ownership and ERP response/adoption identity, including failed
   replacement; P1 complete financial Re-sync and customer payable/words/Excel
   parity independent of deposit. These can be separate small repair releases.
2. P1 direct-invoice allocation recovery, with read-only deployed-contract discovery
   and an explicit operation identity before any backend migration.
3. P2 quote initialization pending/error/Retry, Create completion/submit guards,
   conversion re-entry/backlink recovery with intentional split-order policy.
4. Separate concurrency/offline conflict and durable financial-follow-up designs.
   Re-sync must first be faithful before relying on it as complete recovery.
5. Reproduce Packing/Freight async risks, then select a workflow extraction by
   maintenance benefit; proceed to the read-only active/paused/obsolete inventory
   when the higher-value correctness work is closed. No deletion is authorized.

The review supplies ownership, concrete reproductions and acceptance gates for
each proposed slice. It does not authorize executing the plan. Future authorized
releases still require both exact-SHA GitHub jobs before deploying, then fresh
candidate/production admin/customer and feature verification. Fictional tests
must not issue real invoice numbers, stock writes or customer emails.

The next owner-authorized repair is now [SH-01/02 PI source/ERP ownership](V8.20-SHIPPING-PI-OWNERSHIP-FIX.md).
It retains the existing page/domain boundary, uses an attempt identity and
committed source association, and guards ERP comparison/adoption against stale
imports/SOs. Its permanent fictional regressions join the normal prebuild/CI
suite. Release status is in that record; the remaining financial, SI recovery,
quote/Create, concurrency and durable-sync scopes are not authorized by this slice.

SH-01/02 is released as 6f3ec3e after 171 Shipping/876 prebuild cases, 22 fictional
Chrome cases, both exact-SHA jobs and fresh candidate/production admin/customer
gates. Actual production PI interactions also pass with fictional intercepted
responses and no write attempts. The next proposed bounded batch is financial
Re-sync: share complete source-field projection, detect all owned drift and expose
failed recovery. Customer no-deposit accounting-payable exports follow separately.
Keep original totals/approved amounts/null/zero and historical records intact;
no migration or live repair is authorized by the proposal.

## Financial recovery correction — authorized after PI release

The owner approved SH-04 next. [Implementation/release record](V8.20-INVOICE-RECONCILIATION-FIX.md):
one complete projection for normal save and saved-source recovery; raw preview
and strict server source facts; complete SI-targeted financial reads; authority
guards for unknown/ambiguous amounts and ownership; visible partial failure,
retry and readback. Existing display/export normalization, allocation and ordinary
best-effort save semantics remain unchanged. No historical writes are a test action.

The current local evidence is 40 real-page/client/edge cases, two actual SDK/rules
emulator cases, 38 Chrome cases and 916 prebuild tests/build. Exact-SHA CI and fresh
candidate/production role/feature gates remain mandatory. SH-03 customer payable
exports without deposits are the next separate proposed correction; no broader
concurrency/outbox or SI-allocation redesign is part of SH-04.

SH-04 is released as 3022bfe after both required jobs on that exact SHA, fresh
candidate/production admin/customer gates, complete targeted financial-read/API
checks and served-asset proof. Production 6aedaa36685b16f6596b98e9 supersedes the
initial 04a713e publication with the final known-accounting/unknown-ledger-base
guard. No historical financial upsert was performed during verification.

## Saved-order concurrent-edit correction

[Implementation and release evidence](V8.20-SAVED-ORDER-CONCURRENT-EDIT-FIX.md).
The form owns the user draft and comparison; `orderEditModel.js` owns version identity;
`shipping.js` and Firestore rules own coherent loading and atomic guarded writes.
`orderEditDrafts.js` stores per-operator/per-order/per-attempt device drafts.
Invoice claim/link transactions participate without merging commercial edits.

The saved-order concurrent-edit correction is released and verified with its lazy metadata migration and retained device drafts. The subsequent [Portal waiting-for-reply badge correction](V8.20-PORTAL-WAITING-REPLY-BADGE.md) is also released, using a private read-only status projection and the shared menu/banner count. Broader local creation-recovery changes remain outside these two releases.
