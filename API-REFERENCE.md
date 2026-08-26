# API Reference — Netlify Edge Functions

37 edge functions under `netlify/edge-functions/*.js`, each proxied through
`/api/<name>` (declared in `netlify.toml`, occasionally also via the
function's own `export const config`). The browser never talks to Supabase,
Gemini, DeepSeek, Resend, or WooCommerce directly — every external call and
every secret lives behind one of these.

Grouped by feature area. Short reference only — for the exact request/response
shape or a gotcha, read the function itself; the file names below are exact.

**Auth key:** *admin* = admin-gated (`isAdmin()` inline or `requireAdmin()`
from `lib/auth.js` — same effect, two implementations in the codebase).
*portal* = customer-portal-authenticated (a signed-in, approved portal
customer, narrower than admin). *public* = no session check.

## CRM & Outreach

- `compose-message.js` (`/api/compose-message`) — AI composition of a quick outbound message from a customer's detail page. Auth: admin. Called from `src/pages/CustomerDetail.jsx`.
- `draft-outreach-topic.js` (`/api/draft-outreach-topic`) — Turns a free-text topic into one starting Daily Drafts outreach draft. Auth: admin. Called from `src/outreachApi.js`.
- `discuss-outreach-draft.js` (`/api/discuss-outreach-draft`) — Multi-turn AI chat to conversationally refine one Daily Drafts draft. Auth: admin. Called from `src/outreachApi.js`.
- `generate-outreach-drafts.js` (`/api/generate-outreach-drafts`) — Turns an approved master message + candidate list into 10–20 personalized draft emails for review. Auth: admin. Called from `src/outreachApi.js`.
- `send-personal-email.js` (`/api/send-personal-email`) — Sends one reviewed Daily Drafts email via Resend. Auth: admin. Called from `src/outreachApi.js`.
- `refresh-email-summary.js` (`/api/refresh-email-summary`) — On-demand DeepSeek summary of a customer's ingested email threads. Auth: admin. Called from `src/emailSummaryApi.js`.
- `refresh-whatsapp-summary.js` (`/api/refresh-whatsapp-summary`) — Same, for imported WhatsApp chats. Auth: admin. Called from `src/whatsappSummaryApi.js`.
- `refresh-alibaba-summary.js` (`/api/refresh-alibaba-summary`) — Same, for manually pasted Alibaba.com chat text. Auth: admin. Called from `src/alibabaSummaryApi.js`.
- `discuss-customer-email.js` (`/api/discuss-customer-email`) — "Discover more about this customer" multi-turn chat over ingested email history. Auth: admin. Called from `src/emailSummaryApi.js`.
- `route-email-question.js` (`/api/route-email-question`) — Cheap classifier routing a Discover-More question to the right email facet/time-range before the full answer runs. Auth: admin. Called from `src/emailSummaryApi.js`.
- `compose-email-answer.js` (`/api/compose-email-answer`) — Merges parallel per-facet partial answers into one Discover-More reply; never sees raw email content. Auth: admin. Called from `src/emailSummaryApi.js`.
- `transcribe-whatsapp-audio.js` (`/api/transcribe-whatsapp-audio`) — Transcribes one WhatsApp voice note (.opus) via Deepgram. Auth: admin. Called from `src/domain/whatsappImport.js`.
- `suggest-tag-merges.js` (`/api/suggest-tag-merges`) — Suggests groupings for drifted-spelling customer tags; proposes only, never writes. Auth: admin. Called from `src/tagApi.js`.

## Marketing & Content

- `generate-blog.js` (`/api/generate-blog`) — AI generation of blog post copy. Auth: admin. Called from `src/pages/BlogGenerator.jsx`.
- `generate-marketing-copy.js` (`/api/generate-marketing-copy`) — AI generation of product/range marketing copy. Auth: admin. Called from `src/pages/ProductForm.jsx`, `src/pages/RangeForm.jsx`.
- `rewrite-section.js` (`/api/rewrite-section`) — AI rewrite of one section of product/range/blog text on request. Auth: admin. Called from `src/pages/ProductForm.jsx`, `src/pages/BlogGenerator.jsx`, `src/pages/RangeForm.jsx`.
- `publish-to-wordpress.js` (`/api/publish-to-wordpress`) — Publishes a generated blog post to crystocraft.com's WordPress via its REST API. Auth: admin. Called from `src/pages/BlogGenerator.jsx`.
- `send-campaign.js` (`/api/send-campaign`) — Sends the next batch of a marketing campaign's emails via Resend; admin clicks "Send next batch", no cron. Auth: admin. Called from `src/campaignApi.js`.
- `subscribe.js` (`/api/subscribe`) — Public newsletter-signup capture; WordPress posts here into `marketing_contacts` (replaces Mailchimp). Auth: public (service-account write). Called from `src/domain/marketingContact.js`.
- `unsubscribe.js` (`/api/unsubscribe`) — One-click unsubscribe link, HMAC-token verified, shows a confirmation page. Auth: public (HMAC token, not session). Called from `src/domain/campaigns.js`, `src/domain/customer.js`.

## Quotes & Documents

- `process-quote.js` (`/api/process-quote`) — AI extraction of quote documents into structured data for range/supplier quote forms. Auth: admin. Called from `src/pages/RangeQuoteForm.jsx`, `src/pages/SupplierQuoteForm.jsx`.
- `extract-pi.js` (`/api/extract-pi`) — AI extraction of a proforma invoice into structured shipment data. Auth: admin. Called from `src/pages/ShipmentForm.jsx`.
- `extract-po.js` (`/api/extract-po`) — AI extraction of a purchase order into structured data. Auth: admin. Called from `src/pages/PurchaseOrderForm.jsx`.

## ERP & Finance

- `erp.js` (`/api/erp`) — Proxies curated JES ERP views (Supabase, service-role key) for the read-only legacy archive. Auth: admin. Called from `src/erpApi.js`, `src/customerOrderHistoryApi.js`, `src/pages/CustomerDetail.jsx`.
- `uc.js` (`/api/uc`) — Read/write + atomic allocation for the UC# invoice registry (Supabase `uc_registry`). Auth: admin. Called from `src/ucRegistry.js`, `src/pages/ShipmentForm.jsx`, `src/shipping.js`.
- `bank.js` (`/api/bank`) — Read/write for Crystocraft's own receiving bank accounts (Supabase `bank_accounts`). Auth: admin. Called from `src/bankAccounts.js`, `src/customer/CustomerInvoicePrint.jsx`.
- `fx-rates.js` (`/api/fx-rates`) — Proxies exchangerate-api.com for CNY/USD/EUR/GBP vs HKD. **Never use these for the books** — see CLAUDE.md's exchange-rate warning; this is for UI convenience only. Auth: public. Called from `src/pages/WooCommerceSync.jsx`, `src/pages/Settings.jsx`.
- `credit-note.js` (`/api/credit-note`) — Read/write/void for posted Sales Return / Credit Note records (Supabase `app_credit_note`); Firestore `credit_notes/{id}` is the editable working doc, this is the posted financial fact. Auth: admin. Called from `src/creditNotes.js`, `src/pages/CreditNoteForm.jsx`.

## Customer Portal & Auth

- `customer-order-history.js` (`/api/customer-order-history`) — Lets a signed-in, approved portal customer see their OWN JES invoice history (order-level only, no costs/margins) — deliberately narrower than `/api/erp`. Auth: portal (self-read). Called from `src/customerOrderHistoryApi.js`, `src/customer/CustomerInvoicePrint.jsx`.
- `swatch-library.js` (`/api/swatch-library`) — Proxies to the Fly.io render service's swatch-registry endpoints, computing the Fly-side admin session auth server-side. Auth: admin OR approved portal customer. Called from `src/swatchLibraryApi.js`, `src/pages/SwatchLibrary.jsx`, `src/customer/SwatchLibraryPage.jsx`.

## Customizer & Product Images

- `customizer-render.js` (`/api/customizer-render`) — Proxies the customizer's render request to the Fly.io service, streaming back the PNG; keeps `RENDER_TOKEN` server-side. **Auth: public — no session check found**, mitigated only by the token staying server-side. Called from `src/customizerApi.js`.
- `customizer-palette.js` (`/api/customizer-palette`) — Proxies the Fly.io service's `/palette` endpoint for the colour picker. **Auth: public — no session check found.** Called from `src/customizerApi.js`.
- `enhance-image.js` (`/api/enhance-image`) — Sends a product image to Gemini's image model to clean/enhance it, returns edited base64. **Auth: public — no session check found**, mitigated only by `GEMINI_API_KEY` staying server-side. Called from `src/enhanceImage.js`.
- `scrape-images.js` (`/api/scrape-images`) — Server-side fetch of crystocraft.com pages to pull full-size product images (sidesteps browser CORS). Auth: admin. Called from `src/pages/ImportImages.jsx`.
- `download-image.js` (`/api/download-image`) — Forces a "Save As" download of a file in this app's own Storage bucket (works around cross-origin `<a download>` limits). Auth: public by necessity (plain anchor click, no Authorization header) — validates the URL belongs to this app's own bucket instead. Called from 10+ export/gallery components.
- `image-proxy.js` (`/api/image-proxy`) — Proxies Storage/WordPress images to the browser to dodge CORS (e.g. loading into a canvas). Auth: public, restricted to an allowlist of source hosts. Called from `src/components/ManualAdjust.jsx`, `src/pages/BlogGenerator.jsx`.

## Integrations

- `woo-sync.js` (`/api/woo-sync`) — Read-only WooCommerce B2C sync (Phase 1): pulls paid orders/refunds for review, writes nothing yet. Auth: admin. Called from `src/wooSyncApi.js`.
- `resend-webhook.js` (`/api/resend-webhook`) — Receives Resend's delivery webhook (delivered/opened/clicked/bounced/complained), records status on the matching `outreach_drafts` doc. Auth: public — invoked by Resend's servers, not the app. No frontend caller.

---

Two things noticed while compiling this list — an auth gap in three
functions and a duplicated admin-check pattern — are recorded in
`TECH-DEBT.md` rather than here, so they don't get lost in a reference doc
that's mostly just a lookup table.

## Keeping this current

When adding a new edge function: add its `[[edge_functions]]` block to
`netlify.toml` (see `LOCAL-TOOLS.md`/`draftMemory.js`'s V8.10 review for what
happens when that step gets skipped), and add one line here in the right
feature area — name, route, one-line purpose, auth posture, caller.
