# Domain Module Map

`src/domain/*.js` is the Firestore business-logic layer — where a page
component asks "load me the customers" or "promote this contact," not where
the AI/edge-function calls live (those are the `src/*Api.js` wrapper files —
see API-REFERENCE.md's "Called from" column for those; this doc is the other
half). Short reference: what each module owns and its main exports, so
"where does X live" stops requiring a grep.

## `customer.js` — the customer record

The biggest and most central module. Owns `customers/{id}` (see
FIRESTORE-COLLECTIONS.md). Constants: `CRM_STATUSES`, `CRM_CATEGORIES`,
`CHANNELS`, `RETAIL_TAG`, `CUSTOMER_SOURCES`, `CUSTOMER_COUNTRIES`.

- `normalizeCustomer(raw)` / `validateCustomer(input)` — raw Firestore doc ↔ canonical shape, with validation issues (see `validation.js`).
- `saveCustomer(id, input)` / `loadCustomers()` / `getCustomer(id)` / `useCustomers()` (hook) — CRUD.
- `previewCustomerMerge(duplicateId, survivorId)` / `mergeCustomers(...)` — duplicate-record merge, survivor-wins/fill-gaps rule (see the file's own `MERGE_*_FIELDS` comment).
- `contactsOf(r)` / `primaryContact(list)` / `contactAddress(...)` — the `contacts[]` sub-shape (a customer can have several people).
- `importErpCustomers(erpRows)` — JES ERP → customer import.
- `loadTagStats()` / `loadAllTagNames()` / `renameTagEverywhere(...)` / `deleteTagEverywhere(...)` — free-typed tag bookkeeping across all customers.
- `updateCustomerAiSummary(...)` — writes the cached AI context summary (`AI_CONTEXT_SUMMARY_MAX_WORDS = 120`).

## `marketingContact.js` — the lead/contact record

Owns `marketing_contacts/{id}`. Constants: `MC_STATUSES`, `MC_AUDIENCES`
(`trade`/`retail`/`website` — the B2B/B2C split), `MC_CATEGORIES` (buyer-type
tags).

- `normalizeContact(id, raw)` — raw doc → canonical shape.
- `saveContact(currentId, data)` / `deleteContact(id)` / `deleteContacts(ids)` / `useMarketingContacts()` (hook) — CRUD.
- `findOrCreateLeadByPhone(phone)` — WhatsApp-import entry point; `idFromEmail`/`idFromPhone` are the deterministic-id helpers behind it (a repeat import finds the same doc instead of duplicating).
- **`linkContactToCustomer(id, customerId, companyName)`** — the promotion-adjacent link step: sets the cross-reference (`customers.linked_marketing_contact_ids` + `marketing_contacts.possible_customer_match`), migrates `app_notes` into a `customers/{id}/enquiries/migrated_notes_{id}` doc, and repoints outreach drafts. **Read this function's own comment block before touching promotion/linking** — it explains exactly why `whatsapp_threads`/`email_threads`/`alibaba_threads` are deliberately left on the old contact doc rather than copied (see FIRESTORE-COLLECTIONS.md's merge-pattern note).
- `promoteContactsToCustomers(rows)` — creates a real `customers/{id}` from selected contacts, then calls `linkContactToCustomer` for each.
- `unlinkContactFromCustomer(id)` — the reverse, for a bad match.
- `tagCounts(contacts)` / `renameTagEverywhere(...)` / `deleteTagEverywhere(...)` — same tag bookkeeping pattern as `customer.js`, separate implementation (not shared — a rename here doesn't touch `customers`' tags).
- `markContactOutreach(id)` / `blockContactOutreach(id, until)` — Daily Drafts eligibility flags.

## `campaigns.js` — marketing campaign sends

Owns `marketing_campaigns/{id}` and `campaign_templates/{id}`.

- `listCampaigns()` / `createCampaign(...)` / `recordBatchResults(...)` / `setCampaignStatus(...)` — one campaign at a time, batched sends (see `send-campaign.js` in API-REFERENCE.md).
- `matchesSegment(contact, segment)` / `eligibleContacts(campaign, allContacts, batchSize)` — who's left to send to.
- `eligibleRetailCustomers(...)` — same idea but for `customers` where `customer_type === 'retail'` (a separate audience from `marketing_contacts`' B2C).
- `listTemplates()` / `saveTemplate(...)` / `updateTemplate(...)` / `deleteTemplate(...)` — the reusable-email-template picker (the pattern `outreachTopicTemplates.js` below copied for Daily Drafts' topic templates).

## `outreachDrafts.js` — Daily Drafts pending queue

Owns `outreach_drafts/{id}`.

- `listPendingDrafts()` / `createDrafts(meta, drafts, {imageUrls, links})` / `deleteAllPending()` — the review queue itself.
- `markDraftSent(...)` / `skipDraft(...)` / `markDraftReplied(...)` — the three terminal states a draft can reach.
- `listSentDrafts()` / `listRecentDecisions(limitCount)` / `listDraftsForTopic(topicLabel)` — history/dedup queries.
- `appendMemoryConclusion(draftId, existingConclusions, conclusion)` — feeds `draftMemoryRules.js`'s "recent conclusions" (`MAX_MEMORY_CONCLUSIONS = 5`).
- `repointDraftsToCustomer(oldPersonId, newPersonId)` — called from `marketingContact.js`'s `linkContactToCustomer` so in-flight drafts follow a promoted contact.

## `draftMemoryRules.js` — standing writing rules for Daily Drafts

Owns `draft_memory_rules/{id}`. `MAX_ACTIVE_RULES = 8`, `MAX_RULE_WORDS = 40`.

- `listDraftMemoryRules()` / `listActiveDraftMemoryRules()` — all vs. the subset actually injected into prompts.
- `createDraftMemoryRule({text, source, createdBy})` → `approveDraftMemoryRule` / `rejectDraftMemoryRule` — the pending→active two-step gate (a rule never reaches a prompt off one click).
- `disableDraftMemoryRule(id)` / `updateDraftMemoryRuleText(id, text)` / `deleteDraftMemoryRule(id)`.
- The actual word-budget trimming when rules+summary+conclusions exceed ~250 words happens server-side in `netlify/edge-functions/lib/draftMemory.js`, not here — this module only manages the rule docs themselves.

## `outreachTopicTemplates.js` — saved Daily Drafts topics (V8.11)

Owns `outreach_topic_templates/{id}`. Small and self-contained:
`listTopicTemplates()` / `saveTopicTemplate({name, text})` /
`updateTopicTemplate(id, {name, text})` / `deleteTopicTemplate(id)`. Same
shape as `campaigns.js`'s email templates, one collection down.

## `interactionLog.js` — the shared CRM Interaction Log

Tiny, deliberately generic: `addInteraction(collectionName, id, {...})` /
`listInteractions(collectionName, id)` / `deleteInteraction(collectionName,
id, interactionId)`. `collectionName` is `'customers'` or
`'marketing_contacts'` — one implementation backs both `enquiries`
subcollections (see FIRESTORE-COLLECTIONS.md's note that the *word*
"enquiries" means two different things at the top level vs. here).

## `whatsappImport.js` — manual WhatsApp export ingestion

No export exists for WhatsApp chat, so this parses the owner's manually
exported `.zip`: `parseWhatsAppExport(text)` → `buildThreadDoc(...)` →
`importWhatsAppZip(file, {target, channel, onProgress})`.
`findExistingThread(target, zipFileName)` / `threadDocId(...)` make a repeat
import of the same export idempotent instead of duplicating. `guessContactName`/
`looksLikePhoneNumber` help the "Save as Lead" flow. `transcribeMessage(...)`
calls `/api/transcribe-whatsapp-audio` for one voice note (see
API-REFERENCE.md) — the only edge-function call in this file.

## `phoneCountry.js` — one function

`countryFromPhone(phone)` — guesses a country from a phone number's prefix.
Used wherever a WhatsApp/phone-only lead needs a country without asking.

## `salesInvoiceHistory.js` — JES invoice matching

`invoicedAlready(o)` — has this order already produced a JES SI (checks
`erp_si_no` / `erp_so_no` prefix). `mergeSalesInvoiceHistory(orders, erpRows,
code)` — folds live ERP rows onto an order list for the "has this shipped
and been invoiced" view.

## `supplierContacts.js` — multiple named people per supplier (V8.12)

`suppliers/{id}` has no full domain module; this is the one shared piece.
`supplierContactsOf(supplier)` — the supplier's `contacts[]`, synthesising one
primary contact from the legacy flat `contact_person`/`wechat_id`/`whatsapp`
when the array doesn't exist yet. `normalizeSupplierContact`,
`primarySupplierContact`, `activeSupplierContacts` / `inactiveSupplierContacts`,
`cleanSupplierContacts` (drop-blanks + exactly-one-primary), `genContactId`,
and `flatFieldsFromContacts(list)` — the denormalised `contact_person` /
`wechat_id` / `whatsapp` mirror written back on every save so the PO form,
supplier list, quote picker and ERP import keep working unchanged.

## `supplierMerge.js` — combine two duplicate suppliers (V8.12)

`previewSupplierMerge(dupId, survId)` (read-only counts for the modal) and
`mergeSuppliers(dupId, survId)`. Repoints everything that references a supplier
id: `purchase_orders.supplier_id` (+ refreshes the denormalised
`supplier_name`/`_name_cn`/`_erp_code`/`_address` PO snapshot from the
survivor), the `{path=**}/supplier_quotes` collection-group's `supplier_id`
(both the corp-gift `products/…/components/…` tree and the figurine
`range_components/…` tree) + its `supplier_name`, and
`range_components.supplierId` + the denormalised `preferred_supplier_name`.
Moves the `suppliers/{id}/{catalogs,images,videos}` subcollections wholesale
(Storage blobs keep their token URLs, same trade-off as the customer Brand
Gallery merge), fills the survivor's blank fields / unions `phones`/`emails`/
`extra_links` / merges `contacts` (regenerating any `id:'legacy'` so two
fold-ins can't collide), then deletes the duplicate. UI: `MergeSupplierModal`
in `SupplierDetail.jsx`, "Merge" button beside Edit/Delete.

## `validation.js` — the shared validation-result shape

Not domain-specific — a small toolkit every `validate*` function in the
other modules builds on: `result()` / `addError/addWarning/addInfo(r, code,
field, message)` / `merge(...results)` / `allIssues(r)`. Plus generic
coercion helpers (`numOrNull`, `str`, `trimUpper`, `oneOf`, `cleanArray`).
Read this before writing a new `validate*` function so error/warning/info
codes stay consistent across modules.

## Keeping this current

When adding a new `src/domain/*.js` file: add one section here — what
collection it owns (cross-reference FIRESTORE-COLLECTIONS.md), its main
exports, and anything a future reader would otherwise have to discover by
tracing call sites (like `linkContactToCustomer`'s "why threads aren't
copied" note above).
