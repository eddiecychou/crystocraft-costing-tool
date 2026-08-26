# Tech Debt & Footguns

A running list of things noticed during review or investigation that are
worth a deliberate look — not urgent bugs, not fixed silently, just recorded
here so they don't get rediscovered from scratch next time someone trips
over them. Add to this whenever you notice something in passing that isn't
in scope for the task at hand.

Each entry: what it is, why it's not already fixed, and where to look.

## Three edge functions have no auth check

`customizer-render.js`, `customizer-palette.js`, and `enhance-image.js`
proxy third-party secrets (`RENDER_TOKEN`, `GEMINI_API_KEY`) but have no
`isAdmin()`/`requireAdmin()` check in their source — every other AI/proxy
function in `API-REFERENCE.md` does. May be intentional (the customizer is a
public-facing feature; the secret staying server-side is the actual
mitigation either way) or may be an oversight. Changing auth posture on a
public-facing feature is a product decision, not a code cleanup — flagged
2026-08-26, not changed.

**Where:** `netlify/edge-functions/customizer-render.js`,
`customizer-palette.js`, `enhance-image.js`.

## Two parallel implementations of the same admin check

Most edge functions inline their own `isAdmin(uid, idToken, projectId)` (a
Firestore REST check of `users/{uid}.role === 'admin'`). A newer set —
`credit-note.js`, `compose-message.js`, `extract-pi.js`, `extract-po.js`,
`generate-blog.js`, `generate-marketing-copy.js`, `process-quote.js`,
`rewrite-section.js`, `scrape-images.js`, `woo-sync.js` — imports a shared
`requireAdmin()` from `netlify/edge-functions/lib/auth.js` instead. Same
effect, two implementations. Worth converging on the shared one over time
rather than adding a 38th inline copy next time a new function needs auth.

**Where:** compare any inline `isAdmin()` block against
`netlify/edge-functions/lib/auth.js`.

## Tag bookkeeping is duplicated, not shared

`customer.js` and `marketingContact.js` each have their own
`renameTagEverywhere`/`deleteTagEverywhere` — separate implementations, not
a shared helper. A rename in one never touches the other's tags, which is
probably correct behavior (they're different tag vocabularies) but means a
future bug fix in one won't automatically apply to the other. Not wrong,
just a place a fix could get applied to only half the codebase by mistake.

**Where:** `src/domain/customer.js` and `src/domain/marketingContact.js`,
both have functions of the same name doing conceptually the same job.

## `customers` vs `marketing_contacts` bulk-summary scan duplication

Carried over from the V8.10 Deepseek review (see `PROJECT-PLAN.md`): the
plan itself flags `SummaryScanSection`/`ContactSummaryScanSection` and the
two halves of `whatsappSummaryApi.js`/`emailSummaryApi.js` as hand-duplicated
between the customer and marketing-contact versions of the same "scan and
refresh summaries in bulk" feature. Collapse into one shared implementation
if a third collection ever needs the same pattern — not worth the
refactor for two.

## Keeping this current

Add an entry when you notice something like this in passing during
unrelated work — dead code, an inconsistency between two similar modules, a
gap that isn't urgent but would waste time if rediscovered cold. Remove an
entry once it's actually been fixed (or note it was fixed and why it's still
worth knowing about, if that's useful context).
