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

The local `mcp/product-writer/` server also offers a narrow corporate-gift
creation tool that pairs one new inactive concept product and component with a
preferred supplier quote. It requires an existing `suppliers/{id}` record plus
both `products` and `supply` access; the Netlify Edge endpoint verifies the
supplier and commits all three new records atomically with create-only
preconditions. Supplier unit cost, MOQ, lead time and terms stay in the
supplier-quote document, not the customer-readable product text. This tool
does not edit existing products or create suppliers. See its README and
`docs/reference/API-REFERENCE.md` for setup and endpoint details.

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


### User-triggered 1688 Capture extension (V8.18)

`browser-extensions/1688-capture/` is an unpacked Chrome extension, not a
server-side scraper. When a staff member clicks its toolbar button on the
already-open `detail.1688.com/offer/...` page, it reads only that rendered page,
the visible selection and source image URLs, takes a visible-tab screenshot,
then scrolls that same page to create bounded stitched full-listing evidence
panels (first 30,000 CSS pixels). It restores the original scroll position
before opening OC's `/sourcing-captures/import` screen. The extension stores
the payload locally for 30 minutes and sends it only to the signed-in OC review
screen; it has no OC credential, background crawl, login automation, API
access, CAPTCHA bypass or checkout capability.

The OC screen saves an internal, supply-gated `sourcing_captures/{id}` review
record and screenshot. A capture is evidence, **not** a confirmed specification,
supplier, supplier quote or customer-facing catalogue item. Review the selected
SKU and text/image claims; confirm price, MOQ, material, dimensions, logo,
packaging, lead time and compliance with the supplier. Only after explicit
approval may the normal corporate-gift MCP workflow create the inactive supplier/
product/component/quote draft. See the extension README for installation.
## 3. Communication capture

What exists in the codebase (document reality; capture is per-channel, not one
unified importer):

- **Email — automatic, hourly.** `email-sync/` (Python): `sync.py` polls the
  **live** mailbox (IMAP, `mail.s406.sureserver.com` — what `mbox.uart.com.hk`
  points at) incrementally; `archive_import.py` backfills the **static** PST
  archive once (it never changes, unlike live mail, so it doesn't need to run
  often). Both share `common.py`, which matches each message's participants to
  a `customers` or `marketing_contacts` doc (exact email, then non-freemail
  domain), groups into threads, and writes `email_threads/{id}`. **Unmatched
  messages are dropped** — a message with no matching record is not stored
  anywhere. Two `launchd` schedules (2026-09-23, see
  `../reference/LOCAL-TOOLS.md`'s "Scheduled email sync" section): plain
  `sync.py` **hourly** (fast, incremental — this is what keeps the Email
  Summary "Refresh" button close to real-time) and `sync.py --rescan` +
  `archive_import.py --rescan --all` **weekly**, Sunday 3am (slow, full — only
  needed to catch a newly-added customer against already-scanned older mail).
  AI summaries via
  `refresh-email-summary` / `discuss-customer-email`.
- **WhatsApp — exported `.zip`, auto-imported from two folders.** No export API
  exists, so the owner manually "Export Chat"s into
  `~/Whatsapp Archives/{Business,Personal}/` — **the folder IS the account**
  (Business vs Personal are separate conversations for the same person, never
  merged). A daily launchd job (`scripts/whatsapp-sync.sh`, 03:00) runs
  `scripts/import-whatsapp-archives.mjs` (text-first) then
  `scripts/upload-whatsapp-media.mjs` (attachments). Matching is **owner-confirmed
  and never auto/fuzzy-matched**: `scripts/whatsapp-import-manifest.json` maps a
  filename → customer/contact/account (or a **group**, `type:'group'`). Unknown
  files are recorded in OC's **Unassigned archives** inbox and remain skipped
  until the owner explicitly files them as a customer contact, marketing lead,
  or customer group. The saved inbox decision is keyed by `account × filename`;
  no name suggestion is ever used as a match. Thread
  id is `account × contact_id` (`conversationThreadId`) — **not** the export
  filename; the old filename-keyed `findExistingThread`/`threadDocId` model is
  retired. A group is a third type keyed `account × group-name`
  (`conversationGroupId`, `thread_type:'group'`, `contact_id:null`), filed under
  a customer rather than a person. A thread whose `messages[]` would exceed
  Firestore's 1 MiB cap spills its attachment URLs to
  `whatsapp_threads/{id}/media/urls`. The page (`WhatsAppImport.jsx` +
  `src/domain/whatsappImport.js`) still does the manual/browser path
  (`parseWhatsAppExport` → `buildThreadDoc` → `importWhatsAppZip`, with
  `media:'none'` for text-first). Voice notes go through
  `transcribe-whatsapp-audio` (Deepgram); attachments preview inline via
  `WhatsAppAttachment.jsx`. (`ARCHITECTURE-RULES.md` §4c; memory
  `whatsapp-import-plan`.)
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
| 2026-10-03 | §Comms-capture **WhatsApp** bullet rewritten (V8.17): the two archive folders (`~/Whatsapp Archives/{Business,Personal}/`) now auto-import weekly via launchd, matching is owner-confirmed via `scripts/whatsapp-import-manifest.json` (never auto/fuzzy), thread id is `account × contact_id` (the old filename-keyed `findExistingThread`/`threadDocId` model is retired), groups are a third type keyed `account × group-name`, and oversized threads spill attachment URLs to `whatsapp_threads/{id}/media/urls`. See `ARCHITECTURE-RULES.md` §4c. |
| 2026-10-08 | 1688 Capture v0.2.0 adds an explicit-click full-listing evidence pass: it scrolls only the current listing, restores the reader's original position, and uploads stitched panels beside the viewport screenshot. The 30,000 CSS-pixel cap and segmented output prevent extension/Storage limits from turning evidence capture into an unbounded crawl. |
