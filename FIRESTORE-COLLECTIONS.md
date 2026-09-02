# Firestore Collections Map

24 top-level collections, ~20 nested subcollections, and 2 collection-group
wildcard rules. Every entry below traces to a `match` block in
`firestore.rules` (~500 lines) — that file is the authority on auth
posture; this doc is the map, not a substitute for reading a rule when it
actually matters (e.g. before changing one).

**Auth key:** *admin* = admin-only. *staff* = admin **or** the V8.12
`production` role (`isStaff()` in `firestore.rules`) — the supply side of the
tool. *portal* = an approved, signed-in customer can read their own data
(never write, except the few marked). *self* = the signed-in user's own
doc/uid. *public* = written by an unauthenticated caller, always through a
specific edge function's service-account write, never directly from the
browser.

**V8.12 RBAC:** the `production` role reads/writes the supply-side
collections (catalogue, components, suppliers, purchase orders, inventory,
figurines) and is denied everything customer/finance/marketing. Anything
below still marked *admin* is a hard wall production never crosses; *staff*
marks what V8.12 opened. The capability map is `src/access.js`; the rules are
the boundary. See `PROJECT-PLAN.md` V8.12 §2.

## Core auth & catalogue

- `users/{uid}` — one Firestore mirror of a Firebase Auth account: `role`, `status`, `ws_discount_pct`, `pricing_group`, `customer_id`. Auth: admin full; self can create pending + limited self-update. Owned by `src/domain/customer.js` + portal-invite functions. → `customers` via `customer_id`.
- `products/{id}` — storefront catalogue item. Auth: portal read, **staff** write (V8.12). Owned by `src/domain/customer.js` + `Products.jsx`/`ProductForm.jsx`. → `range_products`, `orders`.
  - `products/{id}/images/{imageId}` — photos, screened per-customer via `branded_for_customer_id` vs the viewer's `sensitive` flag; staff (admin + production) see all unscreened. → `customers`.
  - `products/{id}/pricing_tiers/{tierId}` — tier pricing. Auth: portal read, **admin** write (hard wall — production never sees pricing).
  - `products/{id}/customer_prices/{priceUid}` — per-customer price overrides, keyed by uid. Auth: admin / self.
  - `products/{id}/components/{componentId}` — BOM components. Auth: **staff** (V8.12).
    - `.../images/{imageId}` — component photos. Auth: staff.
    - `.../supplier_quotes/{quoteId}` — quotes for that component (see collection-group rule below). Auth: staff.
      - `.../attachments/{attachmentId}`. Auth: staff.
- `range_products/{id}` (+ all subpaths above, mirrored) — catalogue ranges/families. Auth: portal read, **staff** write (V8.12 — production has full figurine access incl. costing, which writes here). Owned by `Range.jsx`, `RangeForm.jsx`.
- `range_colour_previews/{id}` — V8.8 unreviewed colour-preview drafts, deliberately a separate top-level collection so `range_products`' portal-read wildcard can't leak drafts. Auth: admin only.
- `settings/{docId}` — mixed config. *portal-readable* allowlist: `catalogue_band`, `exchange_rates`, `format_moq`, `front_page`, `productDefaults`, `quote_branding`, `crystal_colors`. *staff* (production, V8.12) read+write: `format_moq`, `crystal_unit_costs`, `component_categories`, `crystal_colors`; production also reads `exchange_rates`. **admin-only:** `pricing_groups` (customer markup table — hard wall), plus anything not listed. Owned by `Settings.jsx`, `FrontPageConfig.jsx`, `PricingTiers.jsx`, the Components hub.
- `favourites/{uid}` — a customer's saved-product list. Auth: self or admin.
- `enquiries/{eid}` — top-level general enquiry-form submissions (**distinct** from `customers/{id}/enquiries` below, which is the CRM Interaction Log — same word, different thing). Auth: self-create, self/admin read. Owned by `Enquiries.jsx`, `EnquiryForm.jsx`.
- `product_templates/{id}` — Customizer product templates. Auth: portal read, admin write.
- `customer_designs/{id}` — Customizer saved designs. Auth: owner (uid) or admin.

## Suppliers & procurement

Mixed since V8.12 — supply-side is *staff*, the sales/finance docs stay *admin*.

- `suppliers/{id}` (+ `catalogs/{catalogId}`; `images/{imageId}` + `videos/{videoId}` — exhibition/booth photo+clip gallery, `images` same shape as `products/{id}/images` minus visibility screening, `videos` a caption+order doc for a raw clip in Storage). Auth: **staff** (V8.12). Owned by `Suppliers.jsx`, `SupplierDetail.jsx`, `SupplierVideos.jsx`.
- `purchase_orders/{id}` — supplier POs. Auth: **staff** (V8.12 — procurement cost data, not sales). Owned by `PurchaseOrderForm.jsx`, `PurchaseOrders.jsx`.
- `client_quotes/{id}` (+ `items/{itemId}`) — Auth: **admin** (hard wall). Owned by `src/domain/customer.js` + `QuoteDetail.jsx`, `RangeQuoteForm.jsx`.
- `credit_notes/{id}` — combined sales-return + credit-note working doc — the *posted* financial fact lives in Supabase (`credit-note.js`/`app_credit_note`, see API-REFERENCE.md), not here. Auth: **admin** (hard wall). Owned by `CreditNoteForm.jsx`, `CreditNotes.jsx`.
- `portal_invitations/{id}` — SU-07A invite records, admin-**read-only** from the browser — the actual claim/approve write path bypasses rules entirely via the Admin SDK in `netlify/functions/portal-invite.js`. Owned by `PortalInvitations.jsx`.
- `audit_logs/{id}` — **append-only** change trail. Auth: create = any internal login (`isStaff() || isFrontOffice()`), read = admin only, update/delete = never. First & only writer today: `AccountEdit.jsx`'s `apply()` logs every `role`/`status`/`account_type` change on a `users/{uid}` doc (`{ kind:'account', target_uid, target_email, changes:[{field,from,to}], actor_uid, actor_email, at }`) — closes the blind spot behind `LESSONS-LEARNED` L-01 (admin silently demoted, twice). Extend to other critical mutations (price groups, invitation approval via `portal-invite.js`) as needed.

## Customers & CRM

- `customers/{id}` — the master customer record: `erp_code`, `erp_code_shared`, `sensitive`, `woo_customer_id`, `linked_marketing_contact_ids`. Auth: admin only. Owned by `src/domain/customer.js` (`normalizeCustomer`). → `users` (back-reference via `customer_id`), `marketing_contacts` (`linked_marketing_contact_ids[]`), `orders`/`client_quotes` (`customer_id`).
  - `customers/{id}/enquiries/{eid}` — CRM **Interaction Log** entries (not the top-level `enquiries` form collection above). Auth: admin only. Owned by `src/domain/interactionLog.js`, shared with `marketing_contacts`' own copy. Also reachable via the `{path=**}/enquiries` collection-group rule for Daily Drafts' topic-dedup query.
  - `customers/{id}/email_threads/{threadId}` — IMAP-ingested correspondence (V8.1).
  - `customers/{id}/whatsapp_threads/{threadId}` — manually-exported WhatsApp chat imports (V8.2). Owned by `src/domain/whatsappImport.js`.
  - `customers/{id}/alibaba_threads/{threadId}` — manually pasted Alibaba buyer-seller chat (V8.10, no export exists — see `alibabaSummaryApi.js`).
  - `customers/{id}/assets/{assetId}` — Brand Gallery logos/images. Auth: admin full; the linked customer can read only non-`internal_only` items.
  - `customers/{id}/proposal/current` (fixed doc id) — customer-specific presentation built from assets. Auth: the linked, approved customer can read only when `status == 'published'`.

  **Pattern to know**: `email_threads`/`whatsapp_threads`/`alibaba_threads` all exist under **both** `customers/{id}` and `marketing_contacts/{id}` with the identical doc shape. When a lead is promoted to a customer, these are deliberately **left in place** on the old `marketing_contacts` doc, not copied — `CustomerDetail.jsx` live-merges them in via `linked_marketing_contact_ids` instead (see this session's Alibaba-carry-forward fix). Don't "fix" a promoted customer's missing history by copying docs; the merge is the fix.

- `marketing_contacts/{id}` — the cleaned Mailchimp list + WordPress signups. Auth: admin read/write from the app; public writes only via `/api/subscribe`'s service account. Owned by `src/domain/marketingContact.js` (`normalizeContact`). → `customers` via `possible_customer_match` (set at import/link time) and the reverse `linked_marketing_contact_ids` pointer on the customer.
  - `.../whatsapp_threads/{threadId}` — "weak lead" chats saved via "Save as Lead", same shape as the customer subcollection above.
  - `.../alibaba_threads/{threadId}` — same shape, extended to leads.
  - `.../email_threads/{threadId}` — email ingestion extended to leads (V8.9), matched via `email-sync/common.py`.
  - `.../enquiries/{enquiryId}` — same Interaction Log module/shape as customers.
- `marketing_campaigns/{id}` — batched Resend sends to a contact segment. Auth: admin only; unsubscribes write directly onto `marketing_contacts` server-side. Owned by `src/domain/campaigns.js`.
- `campaign_templates/{id}` — reusable Unlayer editor templates. Auth: admin only. Owned by `src/domain/campaigns.js`.
- `outreach_drafts/{id}` — Daily Drafts' AI-generated outreach pending review. Auth: admin only. Owned by `src/domain/outreachDrafts.js`.
- `draft_memory_rules/{id}` — admin-confirmed writing rules fed into Daily Drafts prompts; `status`: pending/active/disabled. Auth: admin only. Owned by `src/domain/draftMemoryRules.js`.
- `outreach_topic_templates/{id}` — saved reusable "what do you want to say?" topics for Daily Drafts (V8.11). Auth: admin only. Owned by `src/domain/outreachTopicTemplates.js`.
- `{path=**}/enquiries` — **not its own collection** — a collection-group rule authorizing a cross-collection query over every `enquiries` subcollection (customers + marketing_contacts) at once, for Daily Drafts' topic-dedup check.
- `{path=**}/supplier_quotes` — same pattern, for querying every `supplier_quotes` subcollection across products/components and range_components at once. Auth: **staff** (V8.12).

## Costing & catalogue documents

- `catalogues/{id}` (+ `items/{itemId}`) — Auth: **admin** only. Owned by `Catalogues.jsx`, `CatalogueForm.jsx`, `CataloguePreview.jsx`.
- `range_components/{id}` — component costing for ranges. Auth: **staff** (V8.12).
  - `.../supplier_quotes/{quoteId}` — covered by the collection-group rule above. Auth: staff.
  - `.../movements/{movementId}` — append-only stock ledger (V7.13a) — see the inventory pattern below. Auth: staff.

## Inventory (staff since V8.12, same doc + append-only `movements/{movementId}` ledger shape throughout)

- `crystals/{id}` — per-colour crystal SKUs. Auth: staff (+ `movements`).
- `crystal_swatch_notes/{colorId}` — curated legacy-Swarovski-reference metadata; **uniquely also portal-readable** (approved customers) even though write stays admin-only. (Not opened to production — read is admin/portal.)
- `packaging/{id}` — gift boxes/cartons/inserts. Auth: staff (+ `movements`).
- `b2c_stock/{id}` — retail finished-goods stock; per project memory, ChunCi's 卡斯库存 XLS is the real source, this collection doesn't connect to the production process. Auth: staff (+ `movements`). Optional `woo_sku` / `woo_product_id` / `woo_variation_id` / `woo_linked_at` — a one-time manual mapping to the WooCommerce catalogue, set from `WooStockReconcile.jsx` (`setWooLink` in `b2cStock.js`); `save()`/`importStock()` write from their own field whitelists so neither clobbers these.

## Shipping & logistics

- `orders/{orderId}` (+ all subpaths) — a customer can read **only their own** order (matched via the order's `customer_id` against their profile's `customer_id`); admin has full read/write. Owned by `src/domain/customer.js`.
- `packing_lists/{plId}` (+ subpaths) — admin only. Owned by `PackingListPrint.jsx`.
- `logistics_vendors/{id}` — admin only.
- `freight_quotes/{id}`, `freight_rfqs/{id}` — admin only.

## ERP / financial registry (admin only)

- `uc_invoices/{id}` — UC# invoice registry mirroring app-generated invoices — the team's "PI"/"invoice"/JES-SO/SI distinctions from CLAUDE.md apply here. Auth: admin only.
- `counters/{name}` — atomic per-year allocation counters: `uc_<yy>` (UC#, `uc.js`), `so_<yy>` (sales order, `soNumber.js`), `pu_<yy>` (purchase order, `puNumber.js`). Auth: admin, **except `pu_<yy>` which is also production-writable** (V8.12 — needed to number a new PO); the rule matches `name.matches('pu_[0-9]+')`.
- `woo_cache/{doc}` — **pure cache**, admin only. Docs: `orders`, `product_catalogue`, `customer_scan` — each holds the last WooCommerce pull so `WooCommerceSync.jsx` / `WooStockReconcile.jsx` restore on open instead of re-hitting WooCommerce (the fetch/scan button refreshes). Written by `src/wooCache.js`, size-guarded at ~900 KB. Nothing downstream reads it — safe to wipe.

---

## The pointer fields that actually connect these collections

The single most useful thing in this doc if you're tracing data across
collections:

| Field | On | Points to | Meaning |
|---|---|---|---|
| `customer_id` | `users/{uid}`, `orders/{id}` | `customers/{id}` | which customer this login/order belongs to |
| `linked_marketing_contact_ids[]` | `customers/{id}` | `marketing_contacts/{id}` | leads folded into this customer on promotion — drives the thread-merge pattern above |
| `possible_customer_match` | `marketing_contacts/{id}` | `customers/{id}` | reverse of the above, set when a contact is linked/promoted |
| `branded_for_customer_id` | `products/{id}/images/{id}` | `customers/{id}` | which customer a "sensitive" product image is restricted to |
| `woo_customer_id` | `customers/{id}` | (external WooCommerce, not Firestore) | drives `/api/woo-sync`'s order lookups — see API-REFERENCE.md |

## Keeping this current

When adding a new collection: add its `match` block to `firestore.rules`,
deploy it (`LOCAL-TOOLS.md`), and add one line here in the right section —
name/path, purpose, auth, owning domain file, and any pointer field to
another collection. That last part is the part worth not skipping — an
undocumented pointer field is exactly how the Alibaba-carry-forward bug
happened (a merge pattern existed for two collections but a third was never
told about it).
