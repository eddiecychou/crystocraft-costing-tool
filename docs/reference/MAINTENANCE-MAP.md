# OC maintenance map

Current cycle: V8.20. The newest entry in [PROJECT-PLAN.md](../../PROJECT-PLAN.md)
and its linked release record identify what is actually published. Version alone
does not identify a deployment. The feature-area router in
[the master skill](../skills/SKILL.md#5-feature-area-router) remains the detailed
map of pages, business logic, endpoints and collections; this page explains
ownership and the checks to use before changing those areas.

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

## CRM component ownership — first cleanup batch

All paths below are under src/components/crm. The component bodies and their
existing props, markup, local state and side effects were moved intact.

| File | Responsibility and consumer |
|---|---|
| ContactEmailThreads.jsx | Lead email subscription, expansion and summary refresh; MarketingContactDetail |
| ContactWhatsAppThreads.jsx | Lead WhatsApp subscription, migrated-thread filtering, media, individual transcription and summary refresh; MarketingContactDetail |
| ContactAlibabaThreads.jsx | Lead pasted-chat editor/history and summary refresh; MarketingContactDetail |
| ContactInteractionLog.jsx | Lead interaction list, manual add and confirmed delete; MarketingContactDetail |
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

## Subsequent cleanup batches

Daily Drafts decomposition, repeated server auth helpers, finance/shipping
internals, prototype archival and file-retention reviews are separate work.
They need their own bounded change and acceptance checks. A file's size or an
old comment is not evidence that a feature, stored file or import is unused.
