# Sourcing Hub — the Supply Chain

> Suppliers, sourcing links, and how supplier/lead communication is captured.
> Grounded in the implementation. Read `SKILL.md` §5 (Suppliers) for the file
> map; supplier docs are **staff** (admin + production) in `firestore.rules`.

## 1. The supplier record

`suppliers/{id}` — owned by `Suppliers.jsx` / `SupplierDetail.jsx` /
`SupplierForm.jsx`. There is no full domain module; the shared logic lives in:

- **`src/domain/supplierContacts.js`** — multiple named people per supplier
  (`contacts[]`: `{id, name, title, phone, wechat, whatsapp, email, is_primary,
  active}`). An inactive contact is kept greyed for history, not deleted. The
  legacy flat fields (`contact_person`/`wechat_id`/`whatsapp`) are a
  **denormalised mirror of the primary active contact**, rewritten on every save
  (`flatFieldsFromContacts`) so the PO form, supplier list, quote picker and ERP
  import keep working. **MUST** preserve that mirror when editing the save path.
- **`src/domain/supplierMerge.js`** — merge two duplicates. Repoints
  `purchase_orders.supplier_id` (+ refreshes the denormalised PO name snapshot),
  both `supplier_quotes` trees (corp `products/…/components/…` and figurine
  `range_components/…`) via the `{path=**}/supplier_quotes` collection-group,
  and `range_components.supplierId` + `preferred_supplier_name`; moves the
  `catalogs`/`images`/`videos` subcollections; fills blanks / unions
  `phones`/`emails`/`extra_links`; merges `contacts` (regenerating any
  `id:'legacy'` so two fold-ins can't collide); then deletes the duplicate.
  **MUST** read the module header before touching it — suppliers carry component
  quotes AND purchase orders, and a nameless/broken supplier must not blank-match
  every row (guarded on non-empty names).
- **`src/supplierProvince.js`** — `guessProvince(supplier)` for the one-time
  region backfill: a China supplier maps to a `SUPPLIER_PROVINCES` value; a
  non-China supplier's region is its **country name**. Used by the admin-reviewed
  backfill modal in `Suppliers.jsx` (an in-app tool, per the no-ad-hoc-write
  rule in `ARCHITECTURE-RULES.md` §0).

## 2. Sourcing Workstation — 1688 / Taobao / Alibaba links

Suppliers carry named sourcing-link fields plus free-form extras
(`SupplierForm.jsx`, stored on `suppliers/{id}`):

- Named: `website_url`, `shop_1688_url`, `product_1688_url`, `taobao_shop_url`,
  `taobao_product_url`, `alibaba_shop_url`, `alibaba_product_url`. (Field names
  lead with a word — `shop_1688_url`, not `1688_shop_url` — because a JS/
  Firestore field can't start with a digit.)
- Free-form: `extra_links[]` = `{id, label, url}` for the many extra
  1688/Taobao product pages, WeChat mini-shops, or catalogue drives a supplier
  accumulates. Rendered as quick-access chips on the detail page.

**Browser-assisted vs. API.** These are **internal reference links entered by
hand** — the app does **not** call the 1688/Taobao/Alibaba APIs. Sourcing is
browser-assisted (open the stored link, browse the platform yourself). Validation
is deliberately permissive (any `http(s)` URL). **MUST NOT** build an automated
1688/Taobao scraper into these fields without an explicit new decision — the
current model is a curated link hub, not an integration.

## 3. Communication capture

What exists in the codebase (document reality; capture is per-channel, not one
unified importer):

- **Email — automatic.** `email-sync/` (Python): `sync.py` polls IMAP live;
  `archive_import.py` backfills the PST/mbox archives once. Both share
  `common.py`, which matches each message's participants to a `customers` or
  `marketing_contacts` doc (exact email, then non-freemail domain), groups into
  threads, and writes `email_threads/{id}`. **Unmatched messages are dropped** —
  a message with no matching record is not stored anywhere. AI summaries via
  `refresh-email-summary` / `discuss-customer-email`.
- **WhatsApp — manual import.** No export API exists, so `WhatsAppImport.jsx` +
  `src/domain/whatsappImport.js` parse the user's exported `.zip`
  (`parseWhatsAppExport` → `buildThreadDoc` → `importWhatsAppZip`). Idempotent
  by export filename (`findExistingThread`/`threadDocId`). Voice notes go through
  `transcribe-whatsapp-audio` (Deepgram). Attachments preview inline via
  `WhatsAppAttachment.jsx`. Writes `whatsapp_threads/{id}` under a customer or
  a "Save as Lead" `marketing_contacts` doc. (Memory `whatsapp-import-plan`.)
- **Alibaba — manual paste.** No export exists; buyer-seller chat is pasted as
  text and stored as `alibaba_threads/{id}`; summarized via
  `refresh-alibaba-summary`.
- **WeChat — screenshot → AI, not a chat importer.** WeChat appears as a supplier
  **contact field** (`wechat`/`wechat_id`) and as a **quote-extraction source**:
  a WeChat/supplier screenshot is run through `process-quote` (Gemini) to
  structure a supplier quote (`SupplierQuoteForm.jsx`). There is **no WeChat
  chat-history importer** — do not document one; if one is ever needed it's new
  work, mirroring the WhatsApp manual-import pattern above.

**Thread-merge invariant (repeat of the hard rule):** `email_threads` /
`whatsapp_threads` / `alibaba_threads` live under both `customers` and
`marketing_contacts`; on promotion they are **left in place** and live-merged via
`linked_marketing_contact_ids`. **MUST NOT** copy them. (`ARCHITECTURE-RULES.md`
§4a.)

## 4. Supplier media gallery

`suppliers/{id}/images` + `suppliers/{id}/videos` (`SupplierVideos.jsx`,
`ImageGallery.jsx` with `onExtraFiles`) — exhibition/booth photos and clips.
Same drag-and-drop uploader as products (auto-routes images vs. videos by type);
`images` reuse the product-image shape **minus** the per-customer visibility
screening (a supplier gallery has no `branded_for_customer_id` concern). The
"Clean background" enhance is the same Gemini path (`MARKETING-WORKFLOW.md`
§Artgen).

## Change Log

| Date | Change |
|---|---|
| 2026-08-31 | Created. Supplier record (contacts[], merge, province backfill), the sourcing-link hub (browser-assisted, not API), per-channel comms capture (email auto / WhatsApp+Alibaba manual / WeChat = screenshot-to-quote only), media gallery. Grounded in V8.12. |
