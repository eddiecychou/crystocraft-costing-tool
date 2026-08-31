# Operation Center — Master Index

**Purpose:** the fast path from "the user just described a bug / a feature" to
the exact doc, source files, edge functions and collections involved — plus the
mistakes already made here so they aren't made again. Read `CLAUDE.md` first
(the orientation map), then this.

This file is a router. It does not duplicate content — it points. When a
section says "see X", X is authoritative.

---

## 0. Start of every session

1. `cd ~/Developer/costing-tool && git status && git pull` — the other Mac's
   work arrives only through git (see `PROJECT-PLAN.md` top).
2. Read `CLAUDE.md`, then scan this file's §3 for the feature area in play.
3. Current cycle / version: `src/appInfo.js` (`APP_VERSION`). Bump it at cycle
   **start**, not close (memory: `version-bump-timing`).
4. Before any deploy: §6. Before telling the user to install anything:
   `LOCAL-TOOLS.md`.

---

## 1. The document set (what answers what)

| Doc | Use it when |
|---|---|
| `CLAUDE.md` | orientation, environment quirks, JES data facts, conventions |
| `INDEX.md` (this) | "which files does feature X touch?", "have we hit this bug before?" |
| `PROJECT-PLAN.md` | the running cycle log, newest first; permanent incident writeups near the top |
| `API-REFERENCE.md` | all edge functions — route, purpose, auth posture, caller |
| `FIRESTORE-COLLECTIONS.md` | every collection/subcollection — auth, owning file, pointer fields |
| `DOMAIN-MODULES.md` | what each `src/domain/*.js` owns and its exports |
| `TECH-DEBT.md` | known footguns / deliberate tradeoffs — check before "fixing" one |
| `JES-RETIREMENT-PLAN.md` | the 9-step route to switching the legacy ERP off |
| `V7.15_ERP_Inventory.md` | what the JES ERP actually contains, measured |
| `PBIS-IMPORT-FORMAT.md` | the JES→PBIS invoice import contract |
| `erp-sync/ERP-SYNC-V1.0.md` | how the ERP→Supabase mirror works |
| `LOCAL-TOOLS.md` | what's installed/logged-in on this Mac's shell |
| `qa/README.md` | headless render + the pre-push checks (esbuild, no-undef, bundle) |
| Feature specs | `Corp_Gift_Customizer_Spec.md`, `Customizer_Build_Plan.md`, `Crystal_Fabric_Studio_Spec.md`, `Customer_Brand_Gallery_Spec.md`, `WooCommerce_B2C_Sync_Spec.md`, `Range_Colour_Preview_Spec.md`, `Sun-Life-Proposal-Build-Spec.md`, `Inventory_Roadmap_V7.13_Spec.md` |
| `PRODUCT-VARIANTS-PLAN.md` | SHELVED — read before touching corp pricing / quote-line cost snapshots / per-variant anything |

Auto-memory index: `~/.claude/projects/-Users-eddie-Developer-costing-tool/memory/MEMORY.md`.

---

## 2. Codebase layout

- `src/pages/*.jsx` — one screen each; routed in `src/App.jsx`.
- `src/components/*.jsx` — shared UI (galleries, editors, PDF renderers, modals).
- `src/domain/*.js` — Firestore business logic (CRUD, merges, validation). Map: `DOMAIN-MODULES.md`.
- `src/*.js` — two kinds: `*Api.js` = edge-function wrappers (see `API-REFERENCE.md` "Called from"); the rest = smaller feature helpers (`quotes.js`, `shipping.js`, `packing.js`, `mrp.js`, `pricing.js`, `puNumber.js`, `ucRegistry.js`, …).
- `src/hooks/` — `useAuthState.js`, `useProfile.js`, `useScrollMemory.js`.
- `netlify/edge-functions/*.js` — Deno edge functions, `/api/<name>` (declared in `netlify.toml`). Shared helpers in `netlify/edge-functions/lib/`.
- `netlify/functions/portal-invite.js` — the ONE Node (not Deno) function; uses the Admin SDK, bypasses Firestore rules (memory: `su07a-portal-invite-architecture`).
- `firestore.rules` / `storage.rules` — the real security boundary. Deploy **separately** from Netlify (§6).
- `qa/*.mjs` — emulator + headless-render checks.
- `erp-sync/` — IMAP + PST/mbox → Firestore email ingestion (Python).
- `email-sync/` — the live version of the above / rescan cron.
- `erp-sync/` also holds the JES SQL-Server → Supabase mirror (`.venv`, LAN-only).

---

## 3. Feature-area index

Each row: the screens, the logic modules, the edge functions, the collections,
and the spec doc. "→" = start here.

### Catalogue — Corp Gift products
- Pages: `Products.jsx`, `ProductDetail.jsx`, `ProductForm.jsx`, `BulkCategoryEditor.jsx`
- Logic: `src/domain/customer.js` (owns `products/{id}`), `src/pricing.js`, `src/useProductDefaults.js`, `src/productSource.js`, `src/formatMoq.js`
- Edge fns: `generate-marketing-copy`, `rewrite-section`, `enhance-image`, `scrape-images`
- Collections: `products/{id}` (+ `images`, `pricing_tiers` **admin-only**, `customer_prices`, `components/…/supplier_quotes`)
- Notes: corp-gift pricing card is **hidden from `production`**; per-customer price = `customer_prices/{uid}`; tier markup formula = `settings/pricing_groups` (admin-only, hard wall)

### Catalogue — Figurine / Range (Crystocraft's own crystal line)
- Pages: `Range.jsx`, `RangeForm.jsx`, `RangeCosting.jsx`, `RangeComponentForm.jsx`, `CatalogueBand.jsx`
- Logic: `src/rangeCosting.js`, `src/rangeSku.js`, `src/newArrivals.js`, `src/frontPageFeatured.js`, `src/colourPreviewApi.js`
- Collections: `range_products/{id}` (mirrors all `products` subpaths), `range_components/{id}` (+ `supplier_quotes`, `movements`), `range_colour_previews/{id}` (**admin-only**, keeps drafts out of the portal wildcard)
- Spec: `Range_Colour_Preview_Spec.md`
- Notes: `production` has **full** figurine access incl. wholesale price + costing (owner's call, V8.12)

### Catalogue — product images (upload + card display)
- Upload/gallery: `src/components/ImageGallery.jsx` → `src/imageResize.js` (`resizeToJpeg`). **Downscale only** — source aspect ratio is preserved, nothing is cropped to square. An `orientation` field (`square` = ratio 0.85–1.18 / `landscape` / `portrait`) is auto-detected and stored; its only consumer is `BlogGenerator.jsx` (badge + layout). Manual crop editor: `ManualAdjust.jsx` / `src/imageCrop.js` (square is one preset among 4:3 / 3:4 / 16:9 / original).
- Card display: `src/components/CardImageCarousel.jsx` (swipeable dots carousel on a grid card — distinct from `ImageLightbox` on the detail page). All four card grids (`Products.jsx`, `Range.jsx`, `customer/CorporateShop.jsx`, `customer/FigurineShop.jsx`) pass `imgClassName="object-cover"` so thumbnails are a uniform square crop. Figurine/Range used `object-contain p-2` until this was unified — a non-square photo then letterboxed and the carousel dots landed on the white band where bare `bg-white/50` dots vanished ("cropped dots").
- "Square as standard" is a **content convention, not enforced** — a non-square upload center-crops on the card and shows whole on the detail page.
- Brand proposal **banner** is NOT a product image — it's `proposal.hero_asset_id` → a `customers/{id}/assets` doc (Product Gallery category, `src/customerAssets.js`), recommended 2.4:1 landscape. Separate collection, separate Storage prefix (`customer-assets/…`).

### Components & BOM costing
- Pages: `Components.jsx`, `ComponentDetail.jsx`, `ComponentForm.jsx`, `ComponentRequirements.jsx`, `ComponentCodeAudit.jsx`
- Components: `CrystalBomEditor.jsx`, `ComponentLinkPicker.jsx`, `LastActualPaid.jsx`
- Logic: `src/crystalBom.js`, `src/crystalCosting.js`, `src/crystals.js`, `src/crystalColors.js`, `src/componentCategories.js`, `src/criticalComponents.js`, `src/mrp.js`, `src/erpBomCoverage.js`
- Collections: `products/{id}/components/{id}`, `range_components/{id}`, `crystals/{id}`, `packaging/{id}`, `settings` (`crystal_unit_costs`, `component_categories`, `crystal_colors`)

### Suppliers & supplier quotes
- Pages: `Suppliers.jsx`, `SupplierDetail.jsx`, `SupplierForm.jsx`, `SupplierQuoteForm.jsx`
- Components: `SupplierCatalogs.jsx`, `SupplierVideos.jsx`, `SupplierAddQuoteModal.jsx`, `UploadQuoteModal.jsx`, `ImageGallery.jsx`
- Logic: `src/domain/supplierContacts.js` (contacts[] + legacy flat-field mirror), `src/domain/supplierMerge.js` (merge two duplicates), `src/supplierProvince.js` (`guessProvince` for the region backfill), `src/constants.js` (`SUPPLIER_CATEGORIES`, `SUPPLIER_PROVINCES`, `isChinaCountry`)
- Edge fns: `process-quote` (AI quote extraction), `enhance-image`
- Collections: `suppliers/{id}` (+ `catalogs`, `images`, `videos`), `{path=**}/supplier_quotes` (collection-group, both trees)
- Notes: supplier docs are **staff** (admin + production). Merge repoints POs + both `supplier_quotes` trees + `range_components` pointers + denormalised names; see `supplierMerge.js` header

### Purchase Orders
- Pages: `PurchaseOrders.jsx`, `PurchaseOrderForm.jsx`, `PurchaseOrderDetail.jsx`, `PurchaseOrderPrint.jsx`
- Components: `PoReceiveStock.jsx`
- Logic: `src/purchaseOrders.js`, `src/puNumber.js` (allocates `counters/pu_<yy>`), `src/poReceive.js`
- Edge fns: `extract-po`
- Collections: `purchase_orders/{id}` (**staff**; carries `supplier_name`/`_name_cn`/`_erp_code`/`_address` snapshots), `counters/pu_<yy>` (production-writable, uniquely)

### Inventory & stock ledger
- Pages: `InventoryStatus.jsx`
- Components: `InventoryStockTab.jsx`, `StockEditor.jsx`, `StockLedger.jsx`, `ManualAdjust.jsx`, `PoReceiveStock.jsx`, `OrderStockIssue.jsx`, `OrderInventoryIssue.jsx`
- Logic: `src/stockLedger.js`, `src/orderStock.js`, `src/orderStockStatus.js`, `src/inventoryClass.js`, `src/b2cStock.js`, `src/b2cImport.js`
- Collections: `crystals`, `packaging`, `b2c_stock`, `range_components` — each with an **append-only `movements/{id}` ledger** (never mutate the balance directly; write a movement)
- Spec: `Inventory_Roadmap_V7.13_Spec.md`
- Data facts: JES stock is stale except crystals; real figures live in Excel (memory: `b2c-finished-goods`; `CLAUDE.md`)

### Client quotes
- Pages: `Quotes.jsx`, `QuoteDetail.jsx`, `QuoteForm.jsx`, `RangeQuoteForm.jsx`
- Components: `QuotePDF.jsx`, `QuoteExport.jsx`, `LineImagePicker.jsx`
- Logic: `src/quotes.js`, `src/domain/customer.js` (owns `client_quotes`)
- Edge fns: `process-quote`
- Collections: `client_quotes/{id}` (+ `items`) — **admin-only, hard wall**
- Notes: quote items **snapshot** product data at add time; margin column + per-customer pricing both depend on the snapshot shape (see `PRODUCT-VARIANTS-PLAN.md` §4)

### Shipments / Proforma Invoice / packing / UC registry
- Pages: `ShipmentForm.jsx`, `Shipments.jsx`, `Shipping.jsx`, `ProformaInvoicePrint.jsx`, `PackingListEditor.jsx`, `PackingListPrint.jsx`, `UcRegistry.jsx`
- Logic: `src/shipping.js` (`normLine` — **strict field whitelist**), `src/packing.js`, `src/mrp.js`, `src/ucRegistry.js`, `src/soNumber.js`, `src/pdfFilename.js`
- Edge fns: `extract-pi`, `uc` (`/api/uc` — atomic UC# allocation, Supabase)
- Collections: `orders/{id}`, `packing_lists/{id}`, `uc_invoices/{id}`, `counters/uc_<yy>`+`so_<yy>`
- Data facts: an invoice needs a **UC number, not an SO**; team's "PI" = JES **SO**; "invoice" = **SI**; "PI" also means production-in / a PBIS purchase — check which (`CLAUDE.md`)
- Known bug: corp-gift quote lines get tagged `range_products` on Convert-to-PI → packing plan silently degrades (`TECH-DEBT.md`, `ShipmentForm.jsx:310`)

### Sales invoices & credit notes
- Pages: `SalesInvoices.jsx`, `SalesInvoicePrint.jsx`, `CreditNotes.jsx`, `CreditNoteForm.jsx`, `CreditNotePrint.jsx`
- Logic: `src/creditNotes.js`, `src/domain/salesInvoiceHistory.js` (`invoicedAlready`, JES SI matching)
- Edge fns: `credit-note` (`/api/credit-note` — posted fact in Supabase `app_credit_note`)
- Collections: `credit_notes/{id}` (working doc, **admin-only**); posted fact is Supabase, not Firestore
- Data facts: accounting is **not in JES** — books are in PBIS on Cindy's machine; never take an exchange rate from JES (`CLAUDE.md`)

### CRM — Customers
- Pages: `Customers.jsx`, `CustomerDetail.jsx`, `CustomerForm.jsx`, `CustomerAccounts.jsx`, `AccountEdit.jsx`, `Enquiries.jsx`, `EnquiryForm.jsx`
- Components: `CustomerBrandGallery.jsx`, `ProposalEditor.jsx`, `BrandProposalPDF.jsx`, `ContactPicker.jsx`
- Logic: `src/domain/customer.js` (the biggest module — `normalizeCustomer`, `mergeCustomers`, `contactsOf`, tags, ERP import, AI summary), `src/domain/interactionLog.js`, `src/customerAssets.js`, `src/customerProposal.js`, `src/sensitiveImages.js`
- Edge fns: `compose-message`, `refresh-email-summary`, `discuss-customer-email`, `route-email-question`, `compose-email-answer`, `customer-order-history`
- Collections: `customers/{id}` (+ `enquiries` = Interaction Log, `email_threads`, `whatsapp_threads`, `alibaba_threads`, `assets`, `proposal/current`) — **admin-only**
- Spec: `Customer_Brand_Gallery_Spec.md`; memory: `customer-brand-gallery-and-contacts`
- Pattern: threads live on **both** customer and marketing-contact docs; on promotion they are **left in place**, merged live via `linked_marketing_contact_ids` — do NOT copy docs (`FIRESTORE-COLLECTIONS.md` merge note)

### CRM — Marketing contacts, campaigns, Daily Drafts outreach
- Pages: `MarketingContacts.jsx`, `MarketingContactDetail.jsx`, `Marketing.jsx`, `Campaigns.jsx`, `BlogGenerator.jsx`
- Logic: `src/domain/marketingContact.js` (`linkContactToCustomer` — read its comment before touching promotion), `src/domain/campaigns.js`, `src/domain/outreachDrafts.js`, `src/domain/draftMemoryRules.js`, `src/domain/outreachTopicTemplates.js`, `src/outreachApi.js`, `src/campaignApi.js`
- Edge fns: `draft-outreach-topic`, `discuss-outreach-draft`, `generate-outreach-drafts`, `send-personal-email`, `send-campaign`, `generate-blog`, `publish-to-wordpress`, `subscribe`, `unsubscribe`, `suggest-tag-merges`, `resend-webhook`
- Collections: `marketing_contacts/{id}` (+ same thread subcollections as customers), `marketing_campaigns`, `campaign_templates`, `outreach_drafts`, `draft_memory_rules`, `outreach_topic_templates`
- Spec / memory: `marketing-contacts-store`, `email-senders` (three separate sending identities — do not merge)

### Message ingestion & AI summaries (email / WhatsApp / Alibaba)
- Pages: `WhatsAppImport.jsx`
- Components: `WhatsAppAttachment.jsx`
- Logic: `src/domain/whatsappImport.js`, `src/emailSummaryApi.js`, `src/whatsappSummaryApi.js`, `src/alibabaSummaryApi.js`, `src/domain/phoneCountry.js`
- Pipeline: `email-sync/` (live IMAP `sync.py`, resumable by UID via `state.json`) + `email-sync/archive_import.py` (one-time PST/mbox backfill, resumable via `archive_state.json`) share `email-sync/common.py`. `common.py` `match_entity` priority: exact customer email > exact contact email > customer non-freemail domain > contact domain; freemail domains (gmail/qq/163/…) are exact-match only. **Unmatched messages are dropped** (`if not hit: continue`). Threads grouped by `References`/`Message-ID` (subject fallback), written as `email_threads` subcollection docs, deduped by Message-ID, body capped 4000 chars.
- Edge fns: `refresh-email-summary`, `refresh-whatsapp-summary`, `refresh-alibaba-summary`, `transcribe-whatsapp-audio`
- Archives on disk: `~/Outlook Archives/{eddie,sales}.pst` (38 GB / 32 GB, `pypff`) + 5 Apple-Mail `.mbox` (grep-able ~7 GB total). `email-sync/.env`: live mailbox creds (`eddie@uart.com.hk`, IMAP `mail.s406.sureserver.com`) **and** a Firebase web-API-key + admin login (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) — the one place a local script can auth as admin to Firestore REST (used it for the V8.12 supplier adds; auto-mode may still block a direct prod write — see §5)
- Memory: `whatsapp-import-plan`

### Customer Portal, invitations, auth
- Pages: `Portal.jsx`, `PortalInvitations.jsx`, `PortalLogins.jsx`, `InvitationClaim.jsx`, `Login.jsx`, `SetPassword.jsx`
- Logic: `src/portalInviteApi.js`, `src/authActivity.js`, `src/gaPortalActivityApi.js`, `src/hooks/useAuthState.js`, `src/hooks/useProfile.js`
- Edge/Node fns: `netlify/functions/portal-invite.js` (Node, Admin SDK, `jose` pinned 5.9.6), `swatch-library`, `ga-portal-activity`
- Collections: `users/{uid}`, `portal_invitations/{id}` (browser read-only; write path is the Admin SDK function), `favourites/{uid}`
- Memory: `su07a-portal-invite-architecture`, `self-heal-incident`, `useprofile-missing-sentinel`
- **Never** auto-write an existing `users/{uid}` doc from a live `onSnapshot` "missing" signal — caused two real admin demotions (§5)

### RBAC / access control
- Files that MUST agree (no single source): `src/access.js` (`PRODUCTION_MODULES`), `firestore.rules` (`isStaff`/`isProduction`), `storage.rules` (`isStaff`), `netlify/edge-functions/erp.js` (`PRODUCTION_ENTITIES`), `src/pages/ErpLookup.jsx` (`PRODUCTION_ERP_ENTITIES`)
- UI: `src/components/Layout.jsx` (sidebar filter), `src/App.jsx` (`<Gate module>`), `src/pages/ProductionDashboard.jsx`
- Roles: `admin | production | customer`. `production` = supply side only; walled off from customers/quotes/invoices/credit-notes/portal/marketing/settings/uc/woo and corp-gift `pricing`
- Test: `qa/rbac-rules.test.mjs` (needs a real JRE + emulator; covers Firestore + Storage, not the edge fn or UI map)
- Memory: `rbac-production-role`. Debt: `TECH-DEBT.md` "RBAC … can drift"

### Customizer & Crystal Fabric Studio & swatches
- Pages: `SwatchLibrary.jsx`, `FrontPageConfig.jsx`, `FrontPageProductPicker.jsx`
- Logic: `src/customizerApi.js`, `src/customizerEngines.js`, `src/swatchLibraryApi.js`
- Edge fns: `customizer-render`, `customizer-palette` (both **no auth check** — deliberate/flagged, `TECH-DEBT.md`)
- Render service: `render-service/.venv` (numpy/PIL); Fly.io side
- Specs: `Corp_Gift_Customizer_Spec.md`, `Customizer_Build_Plan.md`, `Crystal_Fabric_Studio_Spec.md` (Physical Design Workbench paused mid-build — workstreams 3/5 not started)
- Collections: `product_templates`, `customer_designs`, `crystal_swatch_notes` (uniquely portal-readable)

### ERP lookup (legacy JES, read-only)
- Pages: `ErpLookup.jsx`, `SchemaAudit.jsx`, `ComponentCodeAudit.jsx`, `BankDetailsAudit.jsx`
- Components: `ErpDocModal.jsx`, `ErpProductImport.jsx`
- Logic: `src/erpApi.js`, `src/erpProductImport.js`, `src/erpSoImport.js`, `src/customerOrderHistoryApi.js`
- Edge fns: `erp` (`/api/erp` — `getRole()` gates per-entity), `uc`, `bank`
- Mirror: `erp-sync/` — Supabase, all columns `text`, curated views in `erp-sync/api_views.sql` (every new view must cast). SQL Server is LAN-only (`192.168.10.251`)
- Data facts: prefer ledgers over balance tables (`itemtransaction` > `itemwhbal`); column names lie (`lastupdateby` holds usernames) — see `CLAUDE.md`

### WooCommerce B2C sync
- Pages: `WooCommerceSync.jsx`
- Logic: `src/wooSyncApi.js`, `src/wooImport.js`, `src/wooRefundImport.js`, `src/wooCustomerSync.js`, `src/wooSyncApi.js`
- Edge fns: `woo-sync` (read-only, Phase 1 — writes nothing yet)
- Spec: `WooCommerce_B2C_Sync_Spec.md`
- Pointer: `customers.woo_customer_id`

### Bank accounts / finance registry
- Pages: `BankAccounts.jsx`, `BankDetailsAudit.jsx`
- Logic: `src/bankAccounts.js`
- Edge fns: `bank` (`/api/bank`, Supabase `bank_accounts`)

### Logistics / freight
- Pages: `Logistics.jsx`, `LogisticsVendorForm.jsx`, `FreightComparison.jsx`
- Logic: `src/logistics.js`
- Collections: `logistics_vendors`, `freight_quotes`, `freight_rfqs` (admin-only)

### Catalogues (printed PDF catalogues)
- Pages: `Catalogues.jsx`, `CatalogueForm.jsx`, `CatalogueDetail.jsx`, `CataloguePreview.jsx`
- Components: `RangeCataloguePDF.jsx`, `RangeCatalogueExport.jsx`, `CardImageCarousel.jsx`
- Collections: `catalogues/{id}` (+ `items`) — admin-only
- Render check: `qa/render-catalogue.jsx` (see `qa/README.md`)

### Settings / import tools / tags
- Pages: `Settings.jsx`, `ImportData.jsx`, `ImportImages.jsx`, `TagManager.jsx`, `PricingTiers.jsx`, `Dashboard.jsx`
- Logic: `src/tagApi.js`, `src/exportCsv.js`, `src/currency.js`, `src/notify.js`, `src/enhanceImage.js`, `src/imageResize.js`, `src/imageCrop.js`
- Edge fns: `fx-rates` (UI convenience only — **never for the books**), `download-image`, `image-proxy`
- Collections: `settings/{docId}` — mixed; portal-readable allowlist + staff allowlist + admin-only rest (`FIRESTORE-COLLECTIONS.md`)

---

## 4. Cross-cutting systems

- **Denormalised snapshots.** Order / PI / invoice lines are deliberately
  free-text, not catalogue-linked. `src/shipping.js` `normLine` is a **strict
  whitelist** — any field you add elsewhere is silently dropped here (same bug
  class as V8.11 `hide_total_qty`). POs snapshot supplier name/code/address;
  quote items snapshot product data; refreshing a snapshot is a deliberate
  step in `supplierMerge.js`.
- **Thread-merge pattern.** `email_threads` / `whatsapp_threads` /
  `alibaba_threads` exist under both `customers` and `marketing_contacts`. On
  promotion they stay put and are live-merged via
  `linked_marketing_contact_ids`. Never copy them. An undocumented pointer
  field is how the Alibaba-carry-forward bug happened.
- **Counters.** `counters/{uc_<yy>|so_<yy>|pu_<yy>}` — atomic allocation.
  `pu_<yy>` is the only one `production` may write.
- **Exchange rates.** `/api/fx-rates` and JES rate fields are both unusable
  for accounting. Books use Cindy's audit-year table, copied verbatim
  (`CLAUDE.md`).
- **Two admin-check shapes** in edge functions: inline `isAdmin()` vs shared
  `requireAdmin()` from `lib/auth.js`, plus `erp.js`'s `getRole()`. Prefer the
  shared one (`TECH-DEBT.md`).
- **Stale lazy chunks.** Vite content-hashes lazy chunks; after a deploy an
  open tab throws "Failed to fetch dynamically imported module". `src/main.jsx`
  has a time-windowed `vite:preloadError` reload guard; `QuoteExport.jsx` has
  `isStaleChunkError`/`exportErrorMessage` helpers. A hard refresh always fixes
  it — don't chase it as a logic bug.

---

## 5. Mistakes already made here — do not repeat

| Mistake | What happened | Guard now | Source |
|---|---|---|---|
| Auto-writing `users/{uid}` from a live "missing" snapshot | Real admin account silently demoted to pending **twice** | Effect removed entirely; never re-add any client-side self-heal on role/status | memory `self-heal-incident`; `PROJECT-PLAN.md` Incident section |
| `!profile` "no doc" checks | `useProfile.js` never returns null — always `{missing:true}`, so those checks silently never fire | check `.missing` | memory `useprofile-missing-sentinel` |
| Treating esbuild parse as verification | A missing import parses clean and is a blank page at runtime; shipped broken 3× | run `qa/eslint.no-undef.mjs` **and** a full `src/main.jsx` bundle before pushing import changes | `qa/README.md` |
| Editing PDF layout blind | 3 bad catalogue deploys in one evening (overlaps, orphan heading) | render headlessly with `qa/` + `qlmanage`, look at the PNG | `qa/README.md` |
| Adding a field to an order/PI line | Dropped silently by `normLine`'s whitelist | add the key to `normLine` in `src/shipping.js` | §4; `TECH-DEBT.md` |
| Deploying rules via `git push` | Netlify does not deploy `firestore.rules` / `storage.rules`; production logins hit permission-denied in the gap | `npx firebase-tools deploy --only firestore:rules` then `--only storage`, **before** pushing the app | memory `rbac-production-role` |
| `storage.rules` not tracking `firestore.rules` | production could edit a record but not upload its files | keep the two rule files path-for-path in sync; the 5-place RBAC list in §3 | `TECH-DEBT.md` "RBAC can drift" |
| Bumping `APP_VERSION` at cycle close | User corrected this repeatedly | bump at cycle **start** | memory `version-bump-timing` |
| Pushing every commit | Netlify deploy credit is very limited | batch commits, confirm before pushing to `main` | memory `netlify-deploy-credit` |
| Re-walking Node / firebase-tools install | Both already on PATH on this Mac | check `LOCAL-TOOLS.md` first | memory `local-tools-available` |
| Panicking at a local `/api/* 404` | dev server runs `netlify-cli dev --offline`; 404 was normal | not a bug on its own | memory `edge-functions-local-dev` |
| "Same PendingScreen = same bug" | 3 unrelated causes of "Awaiting approval" in 2 cycles | check which uid / which doc exists before assuming the mechanism | `PROJECT-PLAN.md` postscript |
| Direct prod Firestore writes from a script | No Firebase Admin SDK key locally, but `email-sync/.env` has an admin email/password that authenticates to Firestore REST (`common.py` `sign_in`/`Firestore`). Auto-mode blocked an inline heredoc doing this; a saved `.py` file run went through after the user approved. | prefer an admin-reviewed in-app tool (e.g. the province backfill modal); for a genuine one-off, write a script file, show the user, get explicit approval | this session (V8.12 Moleskine/Swarovski supplier adds; province backfill) |
| "Fixing" a promoted customer's missing history by copying threads | The live merge via `linked_marketing_contact_ids` **is** the fix | don't copy thread docs | §4; `FIRESTORE-COLLECTIONS.md` |
| Reviving `PRODUCT-VARIANTS-PLAN.md` without reading §4 | Typed per-variant price breaks the quote margin column + per-customer pricing; 5 other landmines | read the audit first | `PRODUCT-VARIANTS-PLAN.md` |
| Reading a "cropped / clipped" card-image symptom as a layout bug | It was contrast: translucent `bg-white/50` carousel dots sitting on the white `object-contain` letterbox band, invisible except the sliver over the photo | check `object-fit` + what's actually behind the element before chasing overflow/clip | this session; §3 "product images" |
| Verifying a login-gated component by eye | Can't reach `/range`, `/products` etc. without an admin session; the `qa-admin-login` may not be usable (on this Mac the `.env.local` `QA_ADMIN_PASSWORD` was unset) | mount the component in a `qa/*.html` harness (like `qa/crystal-bom.html`) and headless-render it: `"/Applications/Google Chrome.app/.../Google Chrome" --headless=new --screenshot=… <url>` | `qa/README.md`; memory `qa-admin-login`; this session |

---

## 6. Verify & deploy playbook

**Before pushing anything checkable** (see `qa/README.md` for exact commands):

1. esbuild **parse** every changed `.jsx` — proves syntax only.
2. `qa/eslint.no-undef.mjs` over `src netlify` — catches used-but-not-imported (the single most valuable check; has shipped broken 3×).
3. Full bundle `esbuild src/main.jsx --bundle` — catches unresolved imports across the graph.
4. UI change → run it: `preview_start` the dev server, exercise it, screenshot. If it can't be run, say so in the commit message.
5. PDF change → headless render + rasterise, look at the PNG.
6. `firestore.rules` change → `qa/rbac-rules.test.mjs` on the emulator (needs a scratch JRE — `/usr/bin/java` is a stub).

**Deploy order:**

1. If rules changed: `npx firebase-tools deploy --only firestore:rules`, then `--only storage`. **First.**
2. Confirm with the user before `git push` to `main` (deploy credit).
3. `git pull --rebase` then `git push`. Netlify builds on push.
4. Verify live: `src/appInfo.js` `BUILD_TIME` shows in the sidebar.

**Commit messages:** state plainly what was verified and what was not.

---

## 7. Environment cheat-sheet

- Node / firebase-tools: already on PATH (Bash tool). Details: `LOCAL-TOOLS.md`.
- No Node on a fresh Mac: scratch-fetch (`CLAUDE.md` "Environment quirks").
- Python: `erp-sync/.venv` (psycopg2 / python-tds — ERP mirror), `render-service/.venv` (numpy / PIL — customizer).
- Supabase: reachable anywhere (`erp-sync/.env` `SUPABASE_DB_URL`). SQL Server: LAN-only, office Mac.
- QA login for click-testing the live app: `claude-qa@crystocraft.com` (`.env.local`) — **read-only**, memory `qa-admin-login`.
- Secrets: `erp-sync/.env`, `.env.local`, `email-sync/.env` — all gitignored. No Firebase Admin service-account key locally (it's only in Netlify env).
- Two Macs, git is the sync. `~/Developer/costing-tool` on both.

---

## Keeping this current

When a cycle adds a feature area, or a new class of mistake is made and
corrected: add/adjust one row in §3 or §5. Keep §3 rows to the same shape
(pages / logic / edge fns / collections / spec). This file points; the
authoritative detail stays in the doc it points to.
