# Crystocraft Operation Center — Master Skill

> **This is an AI-to-AI execution guide, not a README.** It encodes the specific
> architecture, hard rules, and verified lessons of this codebase so a future
> assistant can work correctly on the first try. When a rule uses **MUST** /
> **MUST NOT** / **ALWAYS**, treat it as a boundary — each is anchored to a real
> file or a real incident.
>
> **This file supersedes the old root `INDEX.md`** (now a pointer). It is both
> the master index AND the feature-area router: §5 is the fast path from "the
> user described a bug/feature" to the exact pages, logic, edge functions and
> collections involved.
>
> **SINGLE SOURCE OF TRUTH (SSOT).** The `docs/skills/` set is the authority for
> the rules, facts, terminology, and lessons of this project. **If a fact isn't
> written here (or in a reference doc these link to), it is not a fact** — do
> not act on a half-remembered detail; find it here or verify it in the code,
> then write it here. The four files divide the authority: **SKILL.md** = what
> exists and where; **ARCHITECTURE-RULES.md** = the hard boundaries and the
> Load-Bearing Decisions that must not be undone; **MARKETING-WORKFLOW.md** =
> content/SEO/Artgen governance; **LESSONS-LEARNED.md** = every failure and its
> fix. Keep them current in the same commit as the change they describe — a
> stale SSOT is worse than none.

## 1. What the Operation Center is

An internal operations app for **Crystocraft (United Art Metals Factory Ltd)** —
a crystal-giftware manufacturer. It began as a corp-gift costing tool and now
spans the whole business: **marketing → CRM → quoting → orders → production →
inventory → supply chain → accounting hand-off**, plus a customer-facing
storefront/portal and read-only access to the legacy **JES ERP**.

**Current strategic focus: retiring the legacy JES ERP.** The app is becoming
the system of record one function at a time — see `../../JES-RETIREMENT-PLAN.md`.

One React tree (`src/App.jsx`) serves two faces from one Netlify deployment:
- **Operation Center** — internal admin/staff shell (`AdminApp`).
- **Storefront / Customer Portal** — `portal.crystocraft.com` (`Storefront`),
  what an approved `customer` role sees.

## 2. Core technology stack

| Layer | Technology | Notes |
|---|---|---|
| UI | **React 18** + **Vite** (`@vitejs/plugin-react-swc`) | SPA; content-hashed lazy chunks (stale-chunk lesson → `LESSONS-LEARNED.md`) |
| Styling | Tailwind | `content: ['./index.html', './src/**/*.{js,jsx}']` |
| Auth | **Firebase Auth** | Email/password + Google; `browserLocalPersistence` (sessions persist) |
| Data | **Cloud Firestore** | 24+ top-level collections; `firestore.rules` = the security boundary |
| Files | **Firebase Storage** | `storage.rules` = a *separate* boundary that MUST track `firestore.rules` |
| Serverless | **Netlify** — Deno edge fns (`netlify/edge-functions/*.js`, `/api/*`) + one Node fn (`netlify/functions/portal-invite.js`, Admin SDK) | Deploy on `git push` to `main`. Rules do NOT ship this way. |
| Email | **Resend** | All sends via edge fns; tags MUST be ASCII (lesson) |
| B2C sales | **WooCommerce** | Read-only Phase-1 sync → app orders → SI/UC# |
| Legacy ERP mirror | **Supabase** (Postgres) | JES SQL-Server → Supabase; all columns `text`; views in `erp-sync/api_views.sql`; browser reaches it only via admin-gated `/api/erp`,`/api/uc`,`/api/bank` |
| Image retouch | **Gemini** image model (`enhance-image.js`) + client crop (`imageCrop.js`) | "Artgen" family → `MARKETING-WORKFLOW.md` §Artgen |
| Render prototype | **Fly.io** (`render-service/`) | Customizer render engine — PROTOTYPE, not production |
| Analytics | **GA4** (property `547709480`) | Per-account via `app_uid` custom dimension |

## 3. Source-of-truth index

The **skill layer** (this directory) is curated and rule-first. The **reference
layer** (repo root) is exhaustive and fact-first. When they disagree: reference
wins on *facts*; skill wins on *rules and lessons*.

**Skill layer — `docs/skills/`:**

| File | Governs | Read before |
|---|---|---|
| **`SKILL.md`** (this) | Overview, stack, feature-area router, session start | Every session |
| **`ARCHITECTURE-RULES.md`** | Hard boundaries: isolation, RBAC, data lifecycles, snapshots, verify/deploy | Any change to auth, rules, roles, or cross-collection data |
| **`MARKETING-WORKFLOW.md`** | Daily Drafts, campaigns, blog→WordPress/SEO, image retouch ("Artgen") | Touching outreach, content, or product-image editing |
| **`SOURCING-HUB.md`** | Suppliers, 1688/Taobao/Alibaba links, comms capture | Touching suppliers, quotes, or message ingestion |
| **`UI-POLISH.md`** | The Crystocraft visual language (square/flat/hairline), storefront-vs-OpsCenter treatment, the measurable Second-Pass checklist, §7 Mobile | Any UI/layout/styling change — before "it looks fine" |
| **`DESIGN-SYSTEM.md`** | The written spec of what's shipped (V2.5): token layer, component inventory + state matrix, WCAG contrast, the OpsCenter drift baseline, the V3 open-decision list | Changing tokens / component classes, or any V2.5→V3 work |
| **`LESSONS-LEARNED.md`** | Every significant failure + permanent fix | "Fixing" anything familiar — and after any new incident |

**Reference layer — repo root (authoritative on facts):**

| File | Holds |
|---|---|
| `../../CLAUDE.md` | Orientation, environment quirks, JES data facts, conventions |
| `../../PROJECT-PLAN.md` | Running cycle log, newest first; permanent incident writeups near the top |
| `../../API-REFERENCE.md` | All edge functions — route, purpose, auth posture, caller |
| `../../FIRESTORE-COLLECTIONS.md` | Every collection/subcollection — auth, owning file, pointer fields |
| `../../DOMAIN-MODULES.md` | What each `src/domain/*.js` owns and its exports |
| `../../TECH-DEBT.md` | Known footguns / deliberate tradeoffs |
| `../../LOCAL-TOOLS.md` | What's installed/logged-in on this Mac (Node, firebase-tools, GA4 cred, Fly) |
| `../../qa/README.md` | Headless render + the pre-push verification checks |
| `../../JES-RETIREMENT-PLAN.md`, `../../V7.15_ERP_Inventory.md`, `../../PBIS-IMPORT-FORMAT.md`, `../../erp-sync/ERP-SYNC-V1.0.md` | The JES-retirement track |
| Feature specs | `Corp_Gift_Customizer_Spec.md`, `Customizer_Build_Plan.md`, `Crystal_Fabric_Studio_Spec.md`, `Customer_Brand_Gallery_Spec.md`, `WooCommerce_B2C_Sync_Spec.md`, `Range_Colour_Preview_Spec.md`, `Sun-Life-Proposal-Build-Spec.md`, `Inventory_Roadmap_V7.13_Spec.md`, `PRODUCT-VARIANTS-PLAN.md` (SHELVED) |

Persistent AI memory: `~/.claude/projects/-Users-eddie-Developer-costing-tool/memory/MEMORY.md`.

**Codebase layout:**
- `src/pages/*.jsx` — one screen each; routed in `src/App.jsx`.
- `src/marketing/DailyDrafts.jsx`, `src/customer/*` — the marketing tab and the storefront tree.
- `src/components/*.jsx` — shared UI (galleries, editors, PDF renderers, modals).
- `src/domain/*.js` — Firestore business logic (map: `DOMAIN-MODULES.md`).
- `src/*.js` — `*Api.js` = edge-function wrappers; the rest = feature helpers.
- `src/hooks/` — `useAuthState.js`, `useProfile.js`, `useScrollMemory.js`.
- `netlify/edge-functions/*.js` — Deno edge fns; shared helpers in `netlify/edge-functions/lib/`.
- `netlify/functions/portal-invite.js` — the ONE Node fn (Admin SDK, bypasses rules).
- `firestore.rules` / `storage.rules` — the real security boundary. Deploy **separately** from Netlify.
- `qa/*.mjs` — emulator + headless-render checks. `erp-sync/` + `email-sync/` — Python ingestion + ERP mirror.

## 4. Session start (do this first, every time)

1. `cd ~/Developer/costing-tool && git status && git pull` — the other Mac's work
   arrives only through git (two-Mac setup, `../../PROJECT-PLAN.md` top).
2. Read `../../CLAUDE.md`, then §5 below for the feature area in play, then the
   relevant skill file.
3. Version/cycle: `src/appInfo.js` (`APP_VERSION`). Bump at cycle **start**, not
   close (`LESSONS-LEARNED.md`).
4. Before any deploy: `ARCHITECTURE-RULES.md` §Verify-&-Deploy. Before telling
   the user to install anything: `../../LOCAL-TOOLS.md`.

## 5. Feature-area router

Each entry: pages · logic modules · edge functions · collections · spec. This is
the fast path from a request to the exact code.

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
- Spec: `Range_Colour_Preview_Spec.md`. Note: `production` has **full** figurine access incl. wholesale price + costing (owner's call, V8.12)

### Catalogue — product images (upload + card display)
- Upload/gallery: `src/components/ImageGallery.jsx` → `src/imageResize.js` (`resizeToJpeg`). **Downscale only** — aspect preserved, nothing cropped to square. An `orientation` field (`square` = ratio 0.85–1.18 / `landscape` / `portrait`) is auto-detected; only consumer is `BlogGenerator.jsx`. Manual crop: `ManualAdjust.jsx` / `src/imageCrop.js`.
- Card display: `src/components/CardImageCarousel.jsx` (grid-card carousel; distinct from `ImageLightbox`). All four card grids (`Products.jsx`, `Range.jsx`, `customer/CorporateShop.jsx`, `customer/FigurineShop.jsx`) use `object-cover` (uniform square crop).
- "Square as standard" is a **content convention, not enforced.** Brand proposal **banner** is NOT a product image — it's `proposal.hero_asset_id` → a `customers/{id}/assets` doc (`src/customerAssets.js`, Storage prefix `customer-assets/…`).
- ⚠️ **Before changing product/card image display, read `MARKETING-WORKFLOW.md` §6.5** — external DeepSeek editorial art (full-bleed, borderless, text-free) must not be square-cropped, letterboxed, or captioned in ways that fight the composition.

### Components & BOM costing
- Pages: `Components.jsx`, `ComponentDetail.jsx`, `ComponentForm.jsx`, `ComponentRequirements.jsx`, `ComponentCodeAudit.jsx`
- Components: `CrystalBomEditor.jsx`, `ComponentLinkPicker.jsx`, `LastActualPaid.jsx`
- Logic: `src/crystalBom.js`, `src/crystalCosting.js`, `src/crystals.js`, `src/crystalColors.js`, `src/componentCategories.js`, `src/criticalComponents.js`, `src/mrp.js`, `src/erpBomCoverage.js`
- Collections: `products/{id}/components/{id}`, `range_components/{id}`, `crystals/{id}`, `packaging/{id}`, `settings` (`crystal_unit_costs`, `component_categories`, `crystal_colors`)

### Suppliers & supplier quotes → see `SOURCING-HUB.md`
- Pages: `Suppliers.jsx`, `SupplierDetail.jsx`, `SupplierForm.jsx`, `SupplierQuoteForm.jsx`
- Components: `SupplierCatalogs.jsx`, `SupplierVideos.jsx`, `SupplierAddQuoteModal.jsx`, `UploadQuoteModal.jsx`, `ImageGallery.jsx`
- Logic: `src/domain/supplierContacts.js`, `src/domain/supplierMerge.js`, `src/supplierProvince.js`, `src/constants.js` (`SUPPLIER_CATEGORIES`, `SUPPLIER_PROVINCES`, `isChinaCountry`)
- Edge fns: `process-quote` (AI quote extraction incl. WeChat screenshots), `enhance-image`
- Collections: `suppliers/{id}` (+ `catalogs`, `images`, `videos`), `{path=**}/supplier_quotes` (collection-group). Auth: **staff**.

### Purchase Orders
- Pages: `PurchaseOrders.jsx`, `PurchaseOrderForm.jsx`, `PurchaseOrderDetail.jsx`, `PurchaseOrderPrint.jsx` · Components: `PoReceiveStock.jsx`
- Logic: `src/purchaseOrders.js`, `src/puNumber.js` (allocates `counters/pu_<yy>`), `src/poReceive.js` · Edge fns: `extract-po`
- Collections: `purchase_orders/{id}` (**staff**; snapshots supplier name/code/address), `counters/pu_<yy>` (uniquely production-writable)

### Inventory & stock ledger
- Pages: `InventoryStatus.jsx`, `WooStockReconcile.jsx` (`/woo-stock`, admin — Woo catalogue vs Finished Goods) · Components: `InventoryStockTab.jsx`, `StockEditor.jsx`, `StockLedger.jsx`, `ManualAdjust.jsx`, `PoReceiveStock.jsx`, `OrderStockIssue.jsx`, `OrderInventoryIssue.jsx`
- Logic: `src/stockLedger.js`, `src/orderStock.js`, `src/orderStockStatus.js`, `src/inventoryClass.js`, `src/b2cStock.js`, `src/b2cImport.js`, `src/wooCache.js`
- Collections: `crystals`, `packaging`, `b2c_stock`, `range_components` — each with an **append-only `movements/{id}` ledger** (never mutate a balance; write a movement). Spec: `Inventory_Roadmap_V7.13_Spec.md`. JES stock is stale except crystals.
- **Woo ↔ Finished Goods reconciliation** (Spec Phase 6, 2026-09-02): `b2c_stock` gets an optional one-time manual map to WooCommerce (`woo_sku`/`woo_product_id`/`woo_variation_id`, written by `setWooLink`). Match = manual link first, then exact normalised SKU. Most B2C products are Woo **variable products** with often-blank variation SKUs, so most rows link by hand. Read-only against Woo; FG→Woo push is a later phase (open owner decision).

### Client quotes
- Pages: `Quotes.jsx`, `QuoteDetail.jsx`, `QuoteForm.jsx`, `RangeQuoteForm.jsx` · Components: `QuotePDF.jsx`, `QuoteExport.jsx`, `LineImagePicker.jsx`
- Logic: `src/quotes.js`, `src/domain/customer.js` (owns `client_quotes`) · Edge fns: `process-quote`
- Collections: `client_quotes/{id}` (+ `items`) — **admin-only, hard wall**. Quote items **snapshot** product data (margin column + per-customer pricing depend on the snapshot — `PRODUCT-VARIANTS-PLAN.md` §4).

### Shipments / Proforma Invoice / packing / UC registry
- Pages: `ShipmentForm.jsx`, `Shipments.jsx`, `Shipping.jsx`, `ProformaInvoicePrint.jsx`, `PackingListEditor.jsx`, `PackingListPrint.jsx`, `UcRegistry.jsx`
- Logic: `src/shipping.js` (`normLine` — **strict whitelist**), `src/packing.js`, `src/mrp.js`, `src/ucRegistry.js`, `src/soNumber.js`, `src/pdfFilename.js` · Edge fns: `extract-pi`, `uc`
- Collections: `orders/{id}`, `packing_lists/{id}`, `uc_invoices/{id}`, `counters/uc_<yy>`+`so_<yy>`. An invoice needs a **UC number, not an SO**; "PI"=JES **SO**, "invoice"=**SI** (`CLAUDE.md`). Known bug: corp-gift lines tagged `range_products` on Convert-to-PI (`TECH-DEBT.md`).

### Sales invoices & credit notes
- Pages: `SalesInvoices.jsx`, `SalesInvoicePrint.jsx`, `CreditNotes.jsx`, `CreditNoteForm.jsx`, `CreditNotePrint.jsx`
- Logic: `src/creditNotes.js`, `src/domain/salesInvoiceHistory.js` · Edge fns: `credit-note` (posted fact in Supabase `app_credit_note`)
- Collections: `credit_notes/{id}` (working doc, **admin-only**). Accounting is **not in JES** — books in PBIS on Cindy's machine; never take an FX rate from JES.

### CRM — Customers → see `ARCHITECTURE-RULES.md` §Data-lifecycles
- Pages: `Customers.jsx`, `CustomerDetail.jsx`, `CustomerForm.jsx`, `CustomerAccounts.jsx`, `AccountEdit.jsx`, `Enquiries.jsx`, `EnquiryForm.jsx`
- Components: `CustomerBrandGallery.jsx`, `ProposalEditor.jsx`, `BrandProposalPDF.jsx`, `ContactPicker.jsx`
- Logic: `src/domain/customer.js` (biggest module), `src/domain/interactionLog.js`, `src/customerAssets.js`, `src/customerProposal.js`, `src/sensitiveImages.js`
- Edge fns: `compose-message`, `refresh-email-summary`, `discuss-customer-email`, `route-email-question`, `compose-email-answer`, `customer-order-history`
- Collections: `customers/{id}` (+ `enquiries`=Interaction Log, `email_threads`, `whatsapp_threads`, `alibaba_threads`, `assets`, `proposal/current`) — **admin-only**. Spec: `Customer_Brand_Gallery_Spec.md`.

### CRM — Marketing contacts, campaigns, Daily Drafts → see `MARKETING-WORKFLOW.md`
- Pages: `Marketing.jsx` (tabs), `src/marketing/DailyDrafts.jsx`, `MarketingContacts.jsx`, `MarketingContactDetail.jsx`, `Campaigns.jsx`, `BlogGenerator.jsx`
- Logic: `src/domain/marketingContact.js`, `src/domain/campaigns.js`, `src/domain/outreachDrafts.js`, `src/domain/draftMemoryRules.js`, `src/domain/outreachTopicTemplates.js`, `src/outreachApi.js`, `src/campaignApi.js`
- Edge fns: `draft-outreach-topic`, `discuss-outreach-draft`, `generate-outreach-drafts`, `send-personal-email`, `send-campaign`, `generate-blog`, `publish-to-wordpress`, `subscribe`, `unsubscribe`, `suggest-tag-merges`, `resend-webhook`
- Collections: `marketing_contacts/{id}` (+ same thread subcollections as customers), `marketing_campaigns`, `campaign_templates`, `outreach_drafts`, `draft_memory_rules`, `outreach_topic_templates`. Three sending identities — do not merge (`email-senders` memory).
- ⚠️ **Before changing the Blog UI, `publish-to-wordpress.js`, or any SEO/image surface, read `MARKETING-WORKFLOW.md` §6** — the external DeepSeek SEO/Artgen engine's rules (Product Truth, locked art styles, WPML/Elementor/redirect publishing contract) live there; the OC is their custodian and can't see them from its own code.

### Message ingestion & AI summaries (email / WhatsApp / Alibaba) → see `SOURCING-HUB.md` §Comms-capture
- Pages: `WhatsAppImport.jsx` · Components: `WhatsAppAttachment.jsx`
- Logic: `src/domain/whatsappImport.js`, `src/emailSummaryApi.js`, `src/whatsappSummaryApi.js`, `src/alibabaSummaryApi.js`, `src/domain/phoneCountry.js`
- Pipeline: `email-sync/` (`sync.py` live IMAP + `archive_import.py` PST/mbox backfill) share `common.py`; `match_entity` → `customers`/`marketing_contacts` by exact email then non-freemail domain; **unmatched dropped**; written as `email_threads` docs.
- Edge fns: `refresh-email-summary`, `refresh-whatsapp-summary`, `refresh-alibaba-summary`, `transcribe-whatsapp-audio`

### Customer Portal, invitations, auth → see `ARCHITECTURE-RULES.md` §RBAC
- Pages: `Portal.jsx`, `PortalInvitations.jsx`, `PortalLogins.jsx`, `InvitationClaim.jsx`, `Login.jsx`, `SetPassword.jsx`
- Logic: `src/portalInviteApi.js`, `src/authActivity.js`, `src/gaPortalActivityApi.js`, `src/hooks/useAuthState.js`, `src/hooks/useProfile.js`
- Edge/Node fns: `netlify/functions/portal-invite.js` (Node, Admin SDK, `jose` 5.9.6), `swatch-library`, `ga-portal-activity`
- Collections: `users/{uid}`, `portal_invitations/{id}` (browser read-only), `favourites/{uid}`. GA4 per-account traffic via `app_uid` (details in `MARKETING-WORKFLOW.md`/`LESSONS-LEARNED.md`).

### Storefront / wholesale shop UI (`src/customer/*`) → see `UI-POLISH.md`
- Shell: `Storefront.jsx` (routes), `CustomerLayout.jsx` (nav/footer), `store.jsx` (`CartProvider`/`FavouritesProvider` — enquiry cart in localStorage, favourites in `favourites/{uid}`).
- Pages: `HomePage.jsx` (+ `homepageContent.js`), `FigurineShop.jsx`/`FigurineDetail.jsx`, `CorporateShop.jsx`/`CorporateDetail.jsx`, `FavouritesPage.jsx`, `EnquiryPage.jsx`, `OrderHistoryPage.jsx`, `BrandPortalPage.jsx`, `SwatchLibraryPage.jsx`, `CustomizerPage.jsx`, `CustomerInvoicePrint.jsx`, `ProposalPrint.jsx`.
- Logic: `src/frontPageFeatured.js` (homepage Featured, `settings/front_page`), `src/newArrivals.js` (`isNew` — the one new-arrival flag), `src/customerProposal.js`, `src/customerAssets.js`, `src/sensitiveImages.js`.
- **This is the premium/editorial surface** — full `UI-POLISH.md` treatment (generous rhythm, `.mosaic-grid`), unlike the dense Operation Center. `/shop/*` is customer-login-gated; preview headlessly via `qa/home-preview.jsx` / `qa/home-preview-seeded.mjs` (`UI-POLISH.md §4a`).

### RBAC / access control → see `ARCHITECTURE-RULES.md` §RBAC
- Files that MUST agree: `src/access.js` (`PRODUCTION_MODULES`), `firestore.rules`, `storage.rules`, `netlify/edge-functions/erp.js` (`PRODUCTION_ENTITIES`), `src/pages/ErpLookup.jsx` (`PRODUCTION_ERP_ENTITIES`)
- UI: `src/components/Layout.jsx`, `src/App.jsx` (`<Gate module>`), `src/pages/ProductionDashboard.jsx`. Test: `qa/rbac-rules.test.mjs`.

### Customizer / Crystal Fabric Studio / swatches → see `MARKETING-WORKFLOW.md` §Artgen
- Pages: `SwatchLibrary.jsx`, `FrontPageConfig.jsx`, `FrontPageProductPicker.jsx`
- Logic: `src/customizerApi.js`, `src/customizerEngines.js`, `src/swatchLibraryApi.js` · Edge fns: `customizer-render`, `customizer-palette` (both **no auth check** — `TECH-DEBT.md`)
- Render service: `render-service/` (Fly.io, PROTOTYPE). Specs: `Corp_Gift_Customizer_Spec.md`, `Customizer_Build_Plan.md`, `Crystal_Fabric_Studio_Spec.md`.

### ERP lookup (legacy JES, read-only)
- Pages: `ErpLookup.jsx`, `SchemaAudit.jsx`, `ComponentCodeAudit.jsx`, `BankDetailsAudit.jsx` · Components: `ErpDocModal.jsx`, `ErpProductImport.jsx`
- Logic: `src/erpApi.js`, `src/erpProductImport.js`, `src/erpSoImport.js`, `src/customerOrderHistoryApi.js` · Edge fns: `erp` (`getRole()` gates per-entity), `uc`, `bank`
- Mirror: `erp-sync/` — Supabase, all columns `text`, views in `api_views.sql` (every view must cast). SQL Server LAN-only (`192.168.10.251`). Prefer ledgers over balance tables; column names lie.

### WooCommerce B2C sync → see `ARCHITECTURE-RULES.md` §Woo-to-invoice
- Pages: `WooCommerceSync.jsx`, `WooStockReconcile.jsx` · Logic: `src/wooSyncApi.js`, `src/wooImport.js`, `src/wooRefundImport.js`, `src/wooCustomerSync.js`, `src/wooCache.js` · Edge fns: `woo-sync` (read-only: orders/refunds Phase 1, `products_page` Phase 6)
- Spec: `WooCommerce_B2C_Sync_Spec.md`. Pointer: `customers.woo_customer_id`. Shared shop customer: `online-crystocraft-o07`.
- **`woo_cache/{doc}`** (admin-only, pure cache): `orders`, `product_catalogue`, `customer_scan` each hold the last pull so the pages restore on open instead of re-hitting WooCommerce; the fetch/scan button refreshes. Size-guarded at ~900 KB. Nothing downstream reads it — safe to wipe.

### Bank / Logistics / Catalogues / Settings
- Bank: `BankAccounts.jsx`, `BankDetailsAudit.jsx`, `src/bankAccounts.js`, `bank` fn.
- Logistics: `Logistics.jsx`, `LogisticsVendorForm.jsx`, `FreightComparison.jsx`, `src/logistics.js` → `logistics_vendors`, `freight_quotes`, `freight_rfqs` (admin-only).
- Catalogues (printed PDF): `Catalogues.jsx`, `CatalogueForm.jsx`, `CatalogueDetail.jsx`, `CataloguePreview.jsx`, `RangeCataloguePDF.jsx` → `catalogues/{id}` (admin-only). Render check: `qa/render-catalogue.jsx`.
- Settings/tools: `Settings.jsx`, `ImportData.jsx`, `ImportImages.jsx`, `TagManager.jsx`, `PricingTiers.jsx`, `Dashboard.jsx`. Edge fns: `fx-rates` (**never for the books**), `download-image`, `image-proxy`. `settings/{docId}` auth is mixed (`FIRESTORE-COLLECTIONS.md`).

## 6. Keeping this current

When a cycle adds a feature area or a role, add/adjust one entry in §5 and the
relevant skill file. Keep §5 entries to the same shape. This file points; the
authoritative detail stays in the doc it points to. Update the Change Log below.

## Change Log

| Date | Change |
|---|---|
| 2026-08-31 | Skill system created and the root `INDEX.md` merged into it — SKILL.md absorbs the feature-area router + session start; cross-cutting/verify/deploy → `ARCHITECTURE-RULES.md`; mistakes → `LESSONS-LEARNED.md`. Grounded in codebase as of V8.12. |
