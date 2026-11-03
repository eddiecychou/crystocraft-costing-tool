# OC maintenance and code cleanup plan

Updated 3 November 2026 (Sydney). Goal: make changes easier to understand and
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
| 4 — shipping and finance page internals | First display slice released/verified; further panels proposed | ERP comparison and stock badge move to controlled presentation; page retains all workflows and calculations | Exact restoration, 13 before/after cases, invoice/packing regressions, eight pixel-identical pairs, both exact-SHA jobs and fresh role/shipping gates pass |
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
