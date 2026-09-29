# WhatsApp archive intake — plan

> **PLANNED — no code built.** Owner has no WhatsApp API and will export
> conversations as WhatsApp `.zip` archives, normally monthly. This plan makes
> that manual process repeatable without duplicating, overwriting, or
> cross-contaminating CRM correspondence.

## 1. Goal and operating model

The Operation Center remains the archive and review surface. WhatsApp itself
is the export source:

```
WhatsApp Business / Personal
  → manually export one full chat ZIP (with media)
  → archive folder + intake review
  → match to exactly one OC customer or lead
  → guarded import into whatsapp_threads
  → optional voice transcription + WhatsApp summary refresh
```

There is deliberately no WhatsApp API, polling service, automated scraper, or
attempt to make a partial/month-only transcript. WhatsApp's export is a full
conversation each time; the importer must therefore treat a later export as an
update to the same logical conversation, not a new history fragment.

## 2. Current system — what already works

- Route: `/customers/whatsapp-import` (`src/pages/WhatsAppImport.jsx`), gated
  by the `customers` module.
- Parser/importer: `src/domain/whatsappImport.js` reads WhatsApp `_chat.txt`,
  handles multiline messages, Hong Kong iPhone timestamps, attachments, and
  optional `.opus` voice notes.
- Destination: `customers/{id}/whatsapp_threads/{threadId}` for a customer, or
  `marketing_contacts/{id}/whatsapp_threads/{threadId}` for a phone-only lead.
  Promotion deliberately leaves lead threads in place; `CustomerDetail.jsx`
  live-merges them. **Never copy threads during promotion.**
- Channel selector already distinguishes `WhatsApp Business` and `Personal
  WhatsApp`; the selected channel is stored on the thread.
- Existing re-import preserves known media URLs and voice transcriptions by
  attachment filename, so a new export of the **same thread document** does
  not re-upload old media or discard a transcript.
- Customer detail shows the newest imported message date. A generated WhatsApp
  summary makes the correspondence available to CRM context and Daily Drafts.

## 3. Pilot archive inventory — 2026-09-29

Source folder: `/Users/eddie/Whatsapp Archives/`.

| Account | Archive | Transcript lines | Media files |
|---|---:|---:|---:|
| Personal | Heymans Ho | 3,080 | 1,427 |
| Business | Ayako - WestK | 118 | 35 |
| Business | Annie Fan | 289 | 103 |
| Business | Adam Harchut FHU Kami | 261 | 26 |
| Business | Mandy Zheng | 77 | 15 |

All five archives contain the expected `_chat.txt` entry. They are suitable
for a controlled pilot, but **must not be bulk-imported before §5 exists**.
The Heymans archive is especially large; it needs an explicit progress/retry
path and a deliberate decision about whether every historical attachment is
worth uploading.

## 4. Current duplicate gap — why the existing importer is not enough

Today `threadDocId(zipFileName)` derives the document id from only the export
filename/contact display name. This gives one useful property: re-importing a
fresh export with the unchanged filename updates its thread rather than adding
a duplicate.

It is not a durable conversation identity:

1. A renamed archive or an OS-added suffix such as `(1)` generates a different
   thread id and creates a duplicate.
2. A customer who speaks through both Business and Personal WhatsApp can have
   the same contact-based export filename. Because both currently write under
   the same customer path, one import could overwrite the other.
3. A conversation imported in an earlier cycle under a different filename,
   customer/lead record, or channel cannot be identified as overlapping by the
   current filename-only warning.

The present UI warning is useful but only answers: “does this filename already
exist at this exact target?” It does not answer: “does this ZIP contain messages
already stored elsewhere?”

## 5. Required guardrails before routine use

### 5.1 Stable conversation identity

Thread identity must include the **source account** (`business` or `personal`)
and a stable, normalised conversation key. The source account is immutable
provenance, not merely a UI label. A later import must update only that account's
logical conversation.

Do not key solely on an archive filename. Store the original filename(s) and
ZIP SHA-256 as audit metadata, but do not use either as the only identity.

### 5.2 Dry-run intake review

Before uploads or Firestore writes, parse every selected ZIP locally and show:

- archive filename, source account, ZIP SHA-256;
- guessed contact name, sender names, message count, date range, media/voice
  counts;
- proposed customer/lead target, always confirmed by a human;
- matching existing thread(s), including their channel, count, date range and
  last import date;
- one deterministic result: **new**, **safe update**, **overlap requiring
  review**, or **invalid/unparseable**.

“Import all” must only become available after each row has a reviewed target
and a non-ambiguous result. An overlap never auto-merges or deletes anything.

### 5.3 Content-level overlap check

For a proposed target, compare parsed messages against existing thread messages
using a deterministic fingerprint such as:

```
normalised timestamp + sender + normalised body + attachment filename
```

The check must report counts, not make a model judgment:

- exact matches already stored;
- new messages after the existing high-water date;
- same-date/same-sender conflicts (manual review);
- messages that overlap a thread from the other WhatsApp account.

Fingerprinting supports review and safe update decisions; it must not silently
delete existing messages. Preserve the raw message text and source provenance.

### 5.4 Customer/lead matching is human-confirmed

WhatsApp exports contain a display name, not a reliable phone number/email.
The current fuzzy customer suggestion is a convenience only. The operator must
select the target customer or explicitly save a phone-only contact as a lead.
Never use AI to decide which customer owns correspondence.

### 5.5 Media and transcription handling

- Use **Export Chat → Include Media** for the initial import and ordinary
  monthly re-imports. A no-media export can omit attachment identity and risks
  replacing rich historic attachment records with poorer placeholders.
- Retain existing attachment URLs/transcripts on a safe update.
- Queue voice-note transcription separately and visibly; it is optional,
  language-selected (Cantonese / English / Mandarin), and must not block the
  text import.
- For very large archives, provide progress, retry-safe media upload, and an
  explicit “text first / media later” choice rather than leaving a long upload
  ambiguous.

## 6. Proposed monthly operating procedure

1. Export each active customer chat from the correct account with media.
2. Place it in `Whatsapp Archives/Business/` or `Whatsapp Archives/Personal/`.
   Do not manually rename an archive to represent a monthly increment; it is a
   full-history update.
3. Record an intake manifest row: account, file path, export date, SHA-256,
   chosen customer/lead, parsed message/date/media counts, outcome, and operator
   review date.
4. Run the intake dry-run. Resolve every ambiguous customer match or overlap
   before importing.
5. Import a small reviewed batch; confirm the customer WhatsApp card has the
   expected channel, newest-message watermark, counts, and attachments.
6. Generate/refresh the WhatsApp summary only for threads whose message count
   changed. Transcribe only voice notes relevant to current CRM context.
7. Keep the original ZIPs as the source archive. Do not delete or overwrite
   them after a successful app import.

## 7. Build sequence

1. Write pure parser/fingerprint tests using fixture exports: unchanged
   re-import, renamed ZIP, Business+Personal same contact, partial overlap,
   same-time conflict, and malformed archive.
2. Evolve thread metadata/identity without destroying existing thread docs;
   include a migration and review view for legacy filename-keyed imports.
3. Build the dry-run/review surface and explicit conflict choices.
4. Build update/merge behaviour only after the review model is proven. Use
   additive/transactional writes; never destructive replacement across different
   account identities.
5. Pilot the five archives one-by-one. Measure parsed/imported/overlap/media
   counts and inspect their Customer Details.
6. Enable batch intake only after the pilot has no unexplained duplicates,
   overwrites, or missing attachments.

## 8. Non-goals

- WhatsApp API integration, scraping, scheduled ingestion, or sending messages
  from the Operation Center.
- Automatic customer identity matching or AI-directed attachment of a chat to
  CRM data.
- Copying lead threads into customers on promotion.
- Deleting duplicate historical threads automatically.

## 9. Files and boundaries to revisit when work resumes

- `src/domain/whatsappImport.js` — parser, thread identity, attachment reuse,
  import write path.
- `src/pages/WhatsAppImport.jsx` — preview, matching, duplicate warning,
  import-all controls.
- `src/pages/CustomerDetail.jsx` and `src/pages/MarketingContactDetail.jsx` —
  merged display, newest-message watermark, summary action.
- `src/whatsappSummaryApi.js` and `netlify/edge-functions/refresh-whatsapp-summary.js`
  — summary freshness after updates.
- `firestore.rules` / `storage.rules` — re-check only if the new metadata or
  storage layout changes permissions; threads remain customer-module data.
- `docs/skills/ARCHITECTURE-RULES.md` §4a and `docs/skills/SOURCING-HUB.md`
  §3 — thread-merge and manual-import invariants.

## 10. Acceptance criteria

- Re-importing the same archive is idempotent and preserves media URLs and
  transcripts.
- Renaming a ZIP cannot create an accidental duplicate.
- Business and Personal histories for the same customer can coexist without
  overwriting each other.
- Every potential overlap is surfaced with deterministic counts and requires a
  human decision.
- A human can trace each stored thread to its source account and archived ZIP.
- A summary refresh happens only when the imported message total changed.
