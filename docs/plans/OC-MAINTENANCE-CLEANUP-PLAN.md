# OC maintenance and code cleanup plan

Updated 2 November 2026 (Sydney). Goal: make changes easier to understand and
verify while preserving existing functions, screens and commercial behaviour.
This is a staged maintenance plan, not a rewrite or permission to execute every
future batch. The first CRM batch and separately requested fixes are released;
the Daily Drafts targeting and Sent-history/source-badge slices are released
and verified after both exact-SHA jobs and fresh candidate/production role gates.
Remaining work and release status are distinguished below.
The standing-rules, topic-composer, attachment-control and master-refinement
presentation slices are also released and verified under the owner's subsequent
explicit requests.

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
| 2 — Daily Drafts presentation | Targeting, Sent, rules, composer, attachments and master refinement released; broader batch open | Targeting, Sent/reply, standing-rules, topic/master fields, attachments and master chat extracted; parent retains state, generation and writes | All six slices pass source/visual checks, real-page tests, exact-SHA CI and fresh candidate/production admin/customer gates |
| 3 — repeated server authentication helpers | Proposed | Migrate one endpoint at a time to the existing shared helper when behaviour is proved equivalent | Role/module allow/deny matrix and response parity; higher risk than UI extraction |
| 4 — shipping and finance page internals | Proposed | Separate independent display sections, then pure calculations only where a clear existing boundary exists | Pricing, quantities, invoice/export parity and transaction boundaries unchanged |
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
Pending-review cards remain the next separately proposed slice.

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
