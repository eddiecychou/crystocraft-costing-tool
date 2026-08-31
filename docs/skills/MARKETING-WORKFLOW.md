# Marketing Workflow — the Content Engine

> How outreach, campaigns, content, and product-image work actually run in this
> codebase. Grounded in the implementation — where the brief named a concept we
> haven't built (e.g. a formal "visual grammar"), this documents what the code
> does instead. Read `SKILL.md` §5 (CRM — Marketing) for the file map.

## 1. Daily Drafts (personalized outreach)

**UI:** `src/marketing/DailyDrafts.jsx` (the "Daily Drafts" tab of `Marketing.jsx`).
**Data layer:** `src/domain/outreachDrafts.js` (`outreach_drafts/{id}`).
**AI client:** `src/outreachApi.js`. **Edge fns:** `draft-outreach-topic`,
`generate-outreach-drafts`, `discuss-outreach-draft`, `send-personal-email`.

Flow: a free-text topic → `draftTopic()` → one master message →
`generateDrafts(master, topicLabel, candidates, historicalHints, targetingNote,
memory)` produces 10–20 **personalized** draft emails for review → an admin
edits/approves each → `sendPersonalEmail()` sends one via Resend.

**Eligibility (who gets drafted):** `marketingContact.js` `markContactOutreach` /
`blockContactOutreach(id, until)` flags; `campaigns.js` `eligibleContacts` /
`eligibleRetailCustomers`. The shared shop customer `online-crystocraft-o07` and
non-retail records are deliberately excluded from retail-audience outreach.

**MUST NOT** send a draft whose recipient wasn't derived from a real
customer/contact record — `sendPersonalEmail` carries `recipientKind`/
`recipientId` so `resend-webhook.js` can post a bounce/complaint back onto the
actual record. (See the stale-closure lesson below — the send path must read the
*latest* edited fields, not a frozen closure.)

### 1a. The Draft Memory Layer (two-step gate)

Global writing rules shared across every draft prompt: `draft_memory_rules/{id}`
(`src/domain/draftMemoryRules.js`), folded into prompts server-side by
`netlify/edge-functions/lib/draftMemory.js`. Hard caps: `MAX_ACTIVE_RULES = 8`,
`MAX_RULE_WORDS = 40`.

**MUST** keep the two-step gate: a rule created via "Remember this rule" starts
`pending` and only reaches a prompt after a **second, explicit approval**
(`approveDraftMemoryRule`). Owner's requirement — a thing that steers every
future draft must not go live off one click. Nothing here is ever written
automatically.

### 1b. Stale-closure rule (Daily Drafts UI)

**MUST NOT** read component state via a captured closure inside an awaited loop
in `DailyDrafts.jsx`. `handleBulkRewrite` holds one `setField` closure across
many awaited calls; a helper that reads `edits` via closure (`fieldsFor`) sees
state frozen at the click, not the latest. The fix (bug-fix pack C-01): inside
`setField`, base the new value on the `prev` updater argument first, falling back
to the original Firestore draft only when a key was never touched — `prev` is the
only state genuinely safe to rely on inside a `setState` updater. (Full write-up:
`LESSONS-LEARNED.md`.)

## 2. Campaigns (batched sends)

`Campaigns.jsx` + `src/domain/campaigns.js` (`marketing_campaigns/{id}`,
`campaign_templates/{id}`). Edge fn `send-campaign.js` sends the **next batch**
when an admin clicks "Send next batch" — **no cron**. `matchesSegment` /
`eligibleContacts(campaign, allContacts, batchSize)` decide who's left.
Merge tags (`{{...}}`) resolve server-side per recipient.

**MUST** route every Resend tag through `lib/resendTags.js` — see §5.

## 3. Blog → WordPress publishing & SEO

`BlogGenerator.jsx` + edge fns `generate-blog.js`, `rewrite-section.js`,
`publish-to-wordpress.js`. Two modes: **Spotlight** (single product) and
**Roundup** (multi-product). Publishes as a WordPress **draft** via the REST API
(`{WP_BASE_URL}/wp-json/wp/v2`, app-password Basic auth in
`WP_USER`/`WP_PASS` env).

Verified SEO/publish patterns (from V3.0, still current):
- **MUST** upload images to the WP **Media Library** and set the **featured
  image** (SEO + social preview) — not hotlink Firebase Storage URLs.
- Build **Gutenberg blocks** (heading / paragraph / image / gallery / spacer /
  button); all links open in a new tab.
- **SEO title MUST NOT append `| Crystocraft`** — WordPress adds the site name
  automatically; appending it double-brands the `<title>`.
- Images are compressed **in-browser before upload** (hero ≤400KB @1200px,
  content ≤200KB); cross-origin fetches for canvas go through `/api/image-proxy`
  (host-allowlisted) to dodge CORS.
- Banned opener words in AI copy: "Elevate", "Discover", "Introducing",
  "Transform", "Unleash" (varied openings requirement).

## 4. "Artgen" — the product-image retouch family

There is **no separate "Artgen" engine and no "Zodiac vs. Astrology" visual-
grammar spec** in this codebase. What the brief calls Artgen maps to two real,
related pieces of image work — treat them as one family:

**4a. Gemini retouch — `netlify/edge-functions/enhance-image.js`** (client:
`src/enhanceImage.js`, UI in `ImageGallery.jsx`). Image-in/image-out via the
Gemini "flash image" model (`gemini-2.5-flash-image`, auto-falling-back to
`gemini-3.1-flash-image`). Modes:
- `clean` — place the product on a clean solid-white studio background,
  **pixel-faithful** (no colour/shape change).
- `enhance` — clean white bg + soft studio lighting + truer plating/stone colour.
- recolor — a targeted plating/crystal colour change, everything else preserved.

**4b. Manual crop — `src/imageCrop.js` + `ManualAdjust.jsx`** (crop/rotate;
aspect presets square/4:3/3:4/16:9/original). Background removal + cropping are
the same "retouch the product photo" job as the Gemini clean/enhance modes.

**4c. Customizer render service — `render-service/` on Fly.io** (edge fns
`customizer-render.js` / `customizer-palette.js`). **PROTOTYPE only** — not a
production path. Both edge fns currently have **no auth check** (deliberate/
flagged, `TECH-DEBT.md`); the mitigation is the token/secret staying server-side.

### The Product Truth rule (enforced, not aspirational)

**MUST NOT** let image AI invent, add, remove, or restyle the product itself.
This is real: `enhance-image.js`'s prompts explicitly instruct the model to keep
the product **pixel-faithful** and change **only** background/lighting (or, for
recolor, *only* the named colour). Faithfulness is enforced by the prompt, and
the UI **always shows a before/after and only replaces on an explicit "Keep"** —
never auto-overwrites the original. When editing these prompts, **MUST** preserve
the "do not alter the product" clause. A retouch that changes the product is a
bug, not a feature.

## 5. Sending discipline (Resend)

- **MUST** normalize every Resend **tag name and value** through
  `netlify/edge-functions/lib/resendTags.js`. Resend rejects a send with a 422
  ("Tags should only contain ASCII letters, numbers, underscores, or dashes") if
  any tag contains anything else — and `marketing_contacts` doc ids **are the
  contact's own email address**. Use `encodeTagId` (base64url — ASCII **and**
  reversible) for any id `resend-webhook.js` must decode back to a Firestore doc;
  `normalizeTagValue` (lossy) only for decorative tags. (Full write-up:
  `LESSONS-LEARNED.md`.)
- **MUST** keep the three sending identities separate (memory `email-senders`):
  portal (`noreply@crystocraft.com`), WooCommerce (`crystocraft@uart.com.hk`),
  invoices/sales (`sales@uart.com.hk`). They are different systems — do not merge.
- **MUST** derive the recipient server-side from a verified token, never from the
  request body (`send-email.js` open-relay fix, `LESSONS-LEARNED.md`).

## Change Log

| Date | Change |
|---|---|
| 2026-08-31 | Created. Daily Drafts (incl. two-step memory gate + stale-closure rule), campaigns, blog/WordPress SEO patterns, and the "Artgen" image-retouch family documented from the actual implementation (`enhance-image.js` + `imageCrop.js` + Fly.io prototype); "Product Truth" grounded in the enhance-image prompts. Resend ASCII-tag + sending-identity rules. |
