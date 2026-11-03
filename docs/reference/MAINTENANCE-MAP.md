# OC maintenance map

Current cycle: V8.20. The newest entry in [PROJECT-PLAN.md](../../PROJECT-PLAN.md)
and its linked release record identify what is actually published. Version alone
does not identify a deployment. The feature-area router in
[the master skill](../skills/SKILL.md#5-feature-area-router) remains the detailed
map of pages, business logic, endpoints and collections; this page explains
ownership and the checks to use before changing those areas.
The [staged cleanup plan](../plans/OC-MAINTENANCE-CLEANUP-PLAN.md) is the ordered
backlog; [1 November handoff](../plans/V8.20-SESSION-HANDOFF-2026-11-01.md) links
completed work and [size baseline](OC-SIZE-SNAPSHOT-2026-11-01.md). Plans and
historical measurements do not authorize subsequent implementation or deletion.

The [access-control pilot matrix](ACCESS-CONTROL-MATRIX.md) maps actual client,
shared-helper, two Daily Drafts endpoint and Firebase rule contracts. Its
[QA-only record](../plans/V8.20-ACCESS-CONTRACTS.md) distinguishes test/docs work
from future application/auth migrations; marketing and CRM capabilities differ.
The first authorized [topic-auth migration](../plans/V8.20-TOPIC-AUTH-CLEANUP.md)
reuses the existing marketing helper in one endpoint; consult its release record
for actual deployment and fresh-role evidence. Other endpoint migrations remain
separate work.
The separately authorized [refinement migration](../plans/V8.20-REFINEMENT-AUTH-CLEANUP.md)
now uses the same marketing helper; its record distinguishes local proof from
candidate/production release verification. No client/rules change is included.

## Ownership and change boundaries

| Area | Start here | Preserve and verify |
|---|---|---|
| App shell, routes, access | src/App.jsx, src/access.js, src/components/Layout.jsx | Admin/staff/customer routing, capability keys, refresh and lazy loading; Firebase rules remain the data boundary |
| Corporate Gifts and costing | Products/ProductDetail/ProductForm, domain/customer.js, pricing.js, pricingCore.js | Structured component quotes, stored precision, customer-price snapshots, product search and supplier-quote regressions |
| Crystocraft Range | Range/RangeForm/RangeCosting, rangePersistence.js, rangeBomScope.js | Explicit variants, shared/per-colour BOM, code identity, visibility and costing; range/search/image checks |
| Crystal Components and Fabric | CrystalComponents/CrystalComponentForm/SwatchLibrary, domain/crystalProducts.js, domain/crystalFabric.js | Separate own/clearance provenance, enquiry-first Fabric, immutable media, publication and private stock links; crystal product/swatch checks |
| CRM and dashboard | CustomerDetail, MarketingContacts, MarketingContactDetail, CustomerWorkspace, domain/customerWorkItems.js | Customer/lead separation, linked histories, task-first order and summary update state across navigation; customer-workspace and emulator checks |
| Daily Drafts and marketing | marketing/DailyDrafts, domain/outreachDrafts.js, MARKETING-WORKFLOW.md | Human review before sending, cooldowns, lead/customer linking and sender identities; this cleanup does not move sending logic |
| Suppliers, purchasing and stock | SupplierQuoteForm, purchaseOrders.js, poReceiptModel.js, poReceive.js, orderStock.js | Attachment-only saves, exact stock identity, append-only movements and transaction/idempotency boundaries; supplier quote, PO and reservation checks |
| Orders, shipping and finance | ShipmentForm, shipping.js, invoicePayments.js, invoiceExcel.js, SalesInvoicePrint | Quote/order snapshots, deposits, accounting value, UC identity and PDF/Excel parity; invoice/packing checks |
| Catalogues and proposals | CatalogueProductPages, catalogueLayout.js, cataloguePrintStyles.js, ProposalEditor | Complete images/specifications, image sizing and named portrait/landscape pages; catalogue tests plus real PDF inspection when output changes |
| Portal accounts | AccountEdit, PortalAccountFollowup, portalInviteApi.js, Node portal-invite and lib/portalAccountFollowup.js | Approval, pricing, customer link and follow-up are separate; revision/lease/idempotency rules; portal-followup checks with fictional mail boundaries |
| Product Design | pages/pd, lib/firestore, domain/pdProjects.js | Private projects, immutable history and real customer/supplier references; design-project and emulator checks |
| WooCommerce / SEO | WooCommerceSync/WooCatalogue, SeoReview, seo-control-plane | Cache versus posted records, review before external writes, per-field verification; SEO and search regressions |

Runtime page code is under src/pages, src/customer and src/marketing. Business
operations live in domain modules or the existing feature helpers. Components
own their local presentation state. Move one responsibility at a time and keep
existing import contracts until callers have been checked. Similar-looking
features can have different privacy, pricing or lifecycle rules; do not merge
their data models as part of a file extraction.

## Shipping presentation ownership

Shipping presentation ownership is now explicit in
components/shipping/ShipmentReconciliation.jsx: ERP comparison (controlled onUse)
and stock-status badge (existing domain labels/detail). ShipmentForm retains all
state, subscriptions, import/adoption, financial calculations, confirmations and
writes. See [display scope/release](../plans/V8.20-SHIPMENT-DISPLAY-CLEANUP.md).
Run test:shipment-display plus invoice/packing regressions and normal release gates.

The next controlled card, components/shipping/ShipmentDocumentReferences.jsx,
owns SO/UC/invoice/PO/revision inputs and source-PI presentation. Original number
allocation, revision update, invoice ref/focus, lifecycle, validation and all
saves remain in ShipmentForm. Nineteen additional real-page cases run through
test:shipment-display. [Scope/release](../plans/V8.20-SHIPMENT-REFERENCES-CLEANUP.md).

The separate [Woo metadata fix](../plans/V8.20-WOO-INVOICE-DATA-FIX.md) preserves
total_amount in the header and woo_net_payout_hkd in canonical normalization;
parent allocation/registry orchestration gains an unknown-total guard. Real
mapper/model/page/save regressions run in the shipping command. Historical
review is separate from runtime field preservation.

The [save/navigation correction](../plans/V8.20-SAVE-AND-CUSTOMER-NAVIGATION-FIXES.md)
adds current-total form validation and submit-adjacent errors without changing
saved Woo allocation amounts. CustomerDetail keys customer-scoped page state and
guards abandoned initial reads; CustomerCollapsible keys section state by the
existing storageKey. Run customer-workspace (including actual-page navigation)
and shipping regressions; no financial or customer writes during live QA.

[Schedule & Terms](../plans/V8.20-SCHEDULE-TERMS-CLEANUP.md) is a controlled
presentation component; ShipmentForm still owns status confirmation and all
state, calculations and writes. Shipping regressions cover the full page.

[Destination and Remarks](../plans/V8.20-DESTINATION-REMARKS-CLEANUP.md)
render through ShipmentOrderDetails.jsx. The parent owns customer autofill
and persistence. Shipping form and invoice print fixtures cover the boundary.

## CRM component ownership — first cleanup batch

All paths below are under src/components/crm. During the original first batch,
component bodies and existing props, markup, state and side effects moved intact.
Later requested spacing/history corrections are recorded separately in the
[spacing](../plans/V8.20-CUSTOMER-SECTION-SPACING.md) and
[history](../plans/V8.20-LEAD-INTERACTION-HISTORY.md) release reports.

| File | Responsibility and consumer |
|---|---|
| ContactEmailThreads.jsx | Lead email subscription, expansion and summary refresh; MarketingContactDetail |
| ContactWhatsAppThreads.jsx | Lead WhatsApp subscription, migrated-thread filtering, media, individual transcription and summary refresh; MarketingContactDetail |
| ContactAlibabaThreads.jsx | Lead pasted-chat editor/history and summary refresh; MarketingContactDetail |
| ContactInteractionLog.jsx | Lead interaction list, loading/error/Retry and stale-response guards, manual add and confirmed delete; MarketingContactDetail |
| CustomerCollapsible.jsx | Customer section visibility and existing per-customer/session storage keys; CustomerDetail |
| BrandProposalCard.jsx | Brand asset thumbnails, proposal status and capability-gated design profile; CustomerDetail |
| ProductDesignConceptsCard.jsx | Approved design concepts and existing detail/download links; CustomerDetail |
| MergeCustomerModal.jsx | Survivor selection and preview before explicit merge; CustomerDetail |
| InvitePricingDialog.jsx | Existing currency/rate/discount/markup controls before explicit invitation; CustomerDetail |
| crmDates.js | Existing Timestamp and ISO date display helpers; customer page and extracted viewers/cards |

MarketingContacts retains its former named viewer exports for compatibility.
MarketingContactDetail imports the components directly rather than importing a
list page. CustomerDetail still owns its customer subscriptions, linked-lead
history, task/summary composition, saves and invitation handler. No routes,
Firestore paths, field shapes, permission rules, sending policy, migration or
stock/pricing operation changes are included in this batch.

## Verification and releases

- npm run test:customer-workspace includes the isolated real-component CRM
  tests, task/summary/pipeline tests and navigation-update lock regressions.
  The CRM fixture replaces only external boundaries and uses fictional records;
  its mutations cannot reach Firebase, mail, transcription or AI services.
- npm run test:workspace-sync exercises actual Dashboard and CustomerDetail
  pages with real listeners/transactions against a loopback Firestore emulator.
  Keep CustomerCollapsible and the shared dates real in the fixture so the task
  section is not accidentally hidden by a generic component stub.
- Existing feature suites remain required. Build and the whole-source no-undef
  check catch missing imports; an isolated parse is insufficient. The lint command
  is documented in qa/README.md.
- Before every candidate or production deployment, BOTH product-search and
  customer-merge-emulator must pass on the exact clean source commit. Then
  fresh admin and approved-customer sign-ins, data/access/refresh/runtime checks
  are required on candidate and production. Follow
  [RELEASE-WORKFLOW.md](../skills/RELEASE-WORKFLOW.md); no alternative process
  is defined here. Use fictional/local fixtures for write/send behaviour.

Lead interaction history uses domain/interactionLog.js and a date-desc query on
one enquiries collection. Its firestore.indexes.json single-field override must
retain COLLECTION and COLLECTION_GROUP ascending/descending indexes. The
dry-run-first scripts/repair-enquiries-date-index.mjs pins the production field,
preserves live specs and gates --apply on exact-SHA CI; apply requires an already
authorized index-deployment credential, not the read-only audit key. Never
expand permissions automatically. Verify READY indexes and actual ordered live
queries separately from emulator tests; see the
[history repair evidence](../plans/V8.20-LEAD-INTERACTION-HISTORY.md).

## Daily Drafts presentation

src/components/marketing/DailyDraftsTargeting.jsx owns audience/category,
targeting-note, prior-contact checkbox and generation-button markup only.
src/marketing/DailyDrafts.jsx retains all state/setters, category definitions,
eligibility, async generation, payloads, subscriptions and writes/sending.
qa/daily-drafts-targeting.test.mjs exercises the real page through fictional
service/data boundaries and runs in test:ai-writer (prebuild and product-search
CI). No live sends/business-record writes. First slice released after both
exact-SHA GitHub jobs and fresh candidate/production role checks:
[evidence and limits](../plans/V8.20-DAILY-DRAFTS-TARGETING-CLEANUP.md).

The released Sent slice puts rows/engagement/reply markup in DailyDraftsSentHistory.jsx
and the shared Pending/Sent source label in DailyDraftSourceBadge.jsx, both under
src/components/marketing. The page retains reply state/channels and handleLogReply
with its existing draft/CRM writes. Eight Sent cases share the real-page harness
with the eight targeting cases and run in test:ai-writer. Source/visual parity,
both exact-SHA GitHub jobs and fresh candidate/production role gates pass:
[scope/evidence](../plans/V8.20-DAILY-DRAFTS-SENT-CLEANUP.md).

DailyDraftsStandingRules.jsx now owns standing-rules markup only. The page
keeps loading, state, active/pending filters, MAX_ACTIVE_RULES, all rule handlers
and prompt assembly. Twelve new real-page cases pin callback payloads,
explicit approval before prompt inclusion, unsaved edits, busy/error/retry and
confirmation. Source/desktop/mobile checks, both exact-SHA jobs and fresh
candidate/production admin/customer gates pass; no live rules changed:
[scope/evidence](../plans/V8.20-DAILY-DRAFTS-STANDING-RULES-CLEANUP.md).

DailyDraftsComposer.jsx contains the topic/saved-template controls and master
subject/body fields only. DailyDrafts keeps state, template CRUD, drafting,
active-rule prompt assembly and generation. Product/link/media and master chat
presentation are covered by the later slices below. Nine fictional real-page
composer cases run in test:ai-writer/prebuild/product-search CI. In that release,
live QA changed no templates and made no AI calls or email sends. Both exact-SHA jobs and fresh
candidate/production role gates pass.
[Scope and release state](../plans/V8.20-DAILY-DRAFTS-COMPOSER-CLEANUP.md).

DailyDraftsAttachments.jsx owns product/link controls and master image upload/
gallery/selection markup only. State, loaders, public-image filtering, storage,
the two-image limit and createDrafts attachment payload stay in DailyDrafts.
Eleven new real-page cases run through fictional storage/data boundaries in
test:ai-writer/prebuild/product-search CI. Source/visual checks, both exact-SHA
jobs and fresh candidate/production role gates pass, without live uploads or sends.
[Scope and release state](../plans/V8.20-DAILY-DRAFTS-ATTACHMENTS-CLEANUP.md).

DailyDraftsMasterChat.jsx owns the master-message refinement toggle, history,
input and Send/remember controls only. DailyDrafts retains chat state, AI request/
history payloads, master updates, errors and rule approval. Twelve new real-page
cases use fictional AI/rule services in test:ai-writer/prebuild/product-search CI.
Source/visual checks, both exact-SHA jobs and fresh candidate/production roles
pass; live chat used unsaved QA-only copy with no recipient drafts/emails.
[Scope and release state](../plans/V8.20-DAILY-DRAFTS-REFINEMENT-CLEANUP.md).

DailyDraftReviewCard.jsx owns each Pending Review card's markup, including
editing, attachments, actions, WhatsApp controls, customer-link form and chat.
The page retains the map/derived fields, state, all handlers, uploads, AI, writes
and send/skip workflow. Props group unchanged view values, callbacks and limits;
there is no new state owner. Twenty-two fictional real-page cases run in
prebuild/product-search CI. Source/layout checks, both exact-SHA jobs and fresh
candidate/production role gates pass. Live queues were empty; populated actions
used fictional services only, with no live emails or business writes.
[Scope and release state](../plans/V8.20-DAILY-DRAFTS-PENDING-CLEANUP.md).

DailyDraftsPendingToolbar.jsx owns the Pending Review heading/count, bulk toggle,
Clear control and rewrite editor/progress/error markup. The page retains all
state, sequential AI work, target snapshots, edits/history, confirmation/delete
and reload handlers. Twelve fictional cases pin these contracts in prebuild/CI.
Source/layout checks, both exact-SHA jobs and fresh candidate/production role
gates pass. Live queues were empty; no Apply/Clear actions or emails were used.
[Scope and release state](../plans/V8.20-DAILY-DRAFTS-BULK-CLEANUP.md).

## Subsequent cleanup batches

The [cleanup plan](../plans/OC-MAINTENANCE-CLEANUP-PLAN.md) keeps further Daily Drafts
presentation work open, then one-at-a-time server helper convergence and shipping/
finance internals. Prototype/import usage audit and storage retention are
separate reviewed tracks. The first CRM batch and Daily Drafts targeting/Sent/
standing-rules/topic-composer/attachment/master-refinement/Pending Review/bulk
slices are released.
Further presentation slices and later batches remain open; a separate recurring
workspace CI stall is in TECH-DEBT.
The confirmed QA deadline gaps are repaired and exact-SHA CI verified, with
the triggering intermittent stall still open:
[QA safeguards and limits](../plans/V8.20-WORKSPACE-CI-RELIABILITY.md).
Each has its own scope, invariants and acceptance checks. A file's size or an
old comment is not evidence that a feature, stored file or import is unused.
