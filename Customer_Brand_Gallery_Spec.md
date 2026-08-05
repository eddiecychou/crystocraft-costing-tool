# Customer Brand Gallery & Logo Privacy — Spec

Written 2026-08-05. Supersedes the Perplexity-drafted `CorpGiftImages.md` (kept
by the owner as the origin note, not as the build contract). This version is
reconciled against the actual codebase — every "reuse X" below names the real
file, and the data model follows this repo's conventions, not the draft's.

## 0. Why this exists

Corporate-gift customers are sensitive about their logos. **The owner has not
started promoting portal access to corp customers precisely because of this** —
the logo-handling has to be provably safe first. So this is not a "nice gallery
feature"; it is the specific thing that unblocks inviting corporate customers to
log in.

The safety promise, stated plainly: **a client's logo must never appear in the
public catalogue, the blog, or another customer's view, and must be usable in
that client's own proposal with one click.** Everything below serves that
sentence.

## 1. What already exists (so we build on it, not beside it)

Measured in the code, 2026-08-05:

- **Portal ↔ customer link is already built.** A portal login is `users/{uid}`
  with `role: 'customer'`; it carries `customer_id` pointing at a `customers/{id}`
  CRM record. Admins set it via the CustomerPicker in
  `src/pages/AccountEdit.jsx`; `src/pages/CustomerDetail.jsx` already queries
  `users where customer_id == id` to list a customer's linked accounts. **No new
  plumbing is needed to know "which customer is this logged-in user".**
- **Image upload + resize** is solved: `resizeToJpeg` (`src/imageResize.js`) plus
  the Firebase Storage upload pattern in `src/components/LineImagePicker.jsx`
  (`uploadBytes` → `getDownloadURL`).
- **Quote image picking** exists: `ProductImagePicker` in
  `src/pages/QuoteDetail.jsx`, which already supports custom upload and stores
  `custom_image` on a quote item.
- **Proposal export already resolves images**: `src/components/QuoteExport.jsx`
  builds the PDF/Excel from `custom_image || hero_image`. Dropping a brand image
  onto a quote item needs no export change — it flows through as `custom_image`.
- **CustomerDetail is a long sectioned page** (`src/pages/CustomerDetail.jsx`,
  ~985 lines of stacked sections), **not** a tabbed layout. The gallery is a new
  section, not a new tab.
- **The blog generator** (`src/pages/BlogGenerator.jsx`) is the one existing
  feature that could leak a logo into public content; it must be constrained
  (§5).

## 2. Scope

**In scope (Phase 1 — the unblock, admin-only):**
- `customers/{id}/assets` subcollection (§3).
- Brand Gallery section on Customer Detail: upload, edit, delete, badges.
- Visibility + marketing-consent model and the central helper that enforces it.
- "Customer brand images" tab in the quote image picker → proposal PDF/Excel.
- Firestore rules, published (§6).
- Blog generator locked to marketing-cleared assets only.

**In scope (Phase 2 — when inviting corp customers):**
- Read-only "My Brand Gallery" page in the portal for the logged-in linked
  customer.

**Out of scope (deliberately, with reasons):**
- **Customer self-upload.** Sensitive assets are exactly where mislabeling
  ("this is fine to market") does damage; keep logos admin-curated until the
  admin flow is proven. Revisit after Phase 2.
- **Linked back-references** (`linkedProductIds` / `linkedQuoteIds` in the
  draft). The draft itself called them "mainly for debugging." A query by the
  customer is enough; syncing back-refs is maintenance cost for no user value.
- **A separate `BrandProposalPDF.jsx`.** The existing export already resolves
  the image; a logo cover page is a later enhancement to `QuotePDF`, not a fork.
- Versioning, cropping, full DAM.

## 3. Data model

**Nested subcollection `customers/{customerId}/assets`** — not a top-level
`customerAssets` with a `customerId` field. Rationale: it matches this repo's
existing patterns (`customers/{id}/enquiries`, `products/{id}/images`), and it
makes the security rule trivial and correct — a logged-in user reads exactly
`customers/{their customer_id}/assets`, nothing else.

Fields (snake_case, per repo convention — the draft's camelCase is not used):

```
customers/{customerId}/assets/{assetId}: {
  file_url:            string     // Firebase Storage download URL
  filename:            string
  type:                'logo' | 'mockup' | 'in_use' | 'other'   // start small
  visibility:          'internal_only' | 'customer_private' | 'public_reference'
  can_use_in_marketing: boolean   // explicit consent, SEPARATE from visibility
  title?:              string
  tags?:               string[]
  created_at:          Timestamp
  created_by:          string     // admin uid/email
  updated_at:          Timestamp
  updated_by:          string
}
```

Storage path: `customer-assets/{customerId}/{assetId}/{filename}` in the
existing bucket.

**Why three visibility states (not two):** `customer_private` has a real
consumer — the corp customer, once invited to log in (Phase 2). It is not
theoretical; it is the point of the project.

**Why `visibility` and `can_use_in_marketing` are separate:** visibility answers
"who can see it"; consent answers "may we use it to promote ourselves." A
`public_reference` asset still needs `can_use_in_marketing == true` before it
can appear in the blog or a case study. Two questions, two flags.

**Defaults on upload (conservative):** `visibility = 'internal_only'`,
`can_use_in_marketing = false`. An asset is invisible to the customer and unusable
in marketing until an admin deliberately opens it.

## 4. Visibility rules — one helper, used everywhere

Implement as central helpers (e.g. `src/customerAssets.js`) so no feature
re-derives the logic:

- `visibleToCustomer(asset)` → `visibility !== 'internal_only'`
  (i.e. `customer_private` or `public_reference`).
- `usableInMarketing(asset)` → `visibility === 'public_reference' &&
  can_use_in_marketing === true`.

| Viewer | Sees |
|---|---|
| **Admin** | everything; can change visibility + consent; can attach any asset to a quote |
| **Public / blog / catalogue** | only `usableInMarketing(asset)` |
| **Logged-in linked customer** | only their own customer's assets with `visibleToCustomer(asset)` — never `internal_only`, never another customer's |

## 5. Feature integration

### 5.1 Brand Gallery section — Customer Detail (Phase 1)
A new stacked section in `src/pages/CustomerDetail.jsx`:
- Thumbnail grid; filters by `type` and `visibility`; simple tag text filter.
- Each card: thumbnail, type badge, visibility badge, a "Marketing OK" indicator
  when `can_use_in_marketing`.
- **Add Asset** modal: upload one+ files (reuse `resizeToJpeg` + the
  `LineImagePicker` upload pattern), set `type` / `visibility` /
  `can_use_in_marketing`, optional tags.
- Card click → drawer: larger preview, editable fields, delete-with-confirm.

### 5.2 Quote image picker — "Customer brand images" tab (Phase 1)
Extend `ProductImagePicker` in `src/pages/QuoteDetail.jsx` with a third source
tab alongside product images / upload:
- Lists `customers/{quote.customer_id}/assets` (admin sees all).
- Selecting one stores its URL as the quote item's `custom_image` (the field the
  export already reads) plus `customer_asset_id` for provenance.
- No export change required — `QuoteExport.jsx` already renders `custom_image`.

### 5.3 Blog generator lockdown (Phase 1)
`src/pages/BlogGenerator.jsx` (and any future public "client reference" surface)
may only ever pull assets where `usableInMarketing(asset)`. This is the one
place a logo could leak into public content today.

### 5.4 My Brand Gallery — portal (Phase 2)
Read-only page for a logged-in customer: query
`customers/{profile.customer_id}/assets` **with the query constrained to
non-internal visibility** (see §6 — the query must match the rule). Preview +
download only; no edit/delete. Later: a "Request a proposal from these images"
button that pre-fills a quote.

## 6. Firestore rules — this IS the privacy guarantee

The correctness of one rule is the whole safety promise. Nested model makes it
clean:

```
match /customers/{cid}/assets/{aid} {
  allow read: if isAdmin()
    || (signedIn()
        && profile().customer_id == cid
        && resource.data.visibility != 'internal_only');
  allow write: if isAdmin();
}
```

**Critical subtlety:** Firestore evaluates `read` per document, so the
customer-facing gallery query (§5.4) **must** constrain itself, e.g.
`where('visibility', 'in', ['customer_private', 'public_reference'])`. An
unconstrained list that could return an `internal_only` doc is rejected outright.
That is the desired behaviour — the rule is the hard wall; the query respects it.

Notes:
- `profile()` already exists in the rules and does `get(users/uid)`; this adds no
  new helper, only a field comparison.
- Rules deploy **separately from git** (same as `marketing_contacts` /
  `b2c_stock`). Publishing the rule is an explicit step, not part of `git push`.
- This rule must be **tested** (admin sees all; customer A cannot read customer
  B; nobody unauthenticated reads anything; an `internal_only` asset never
  returns to a customer query) before any corp customer is invited.

## 7. Edge cases

- **Asset deleted while used on a quote:** the quote item keeps its snapshotted
  `custom_image` URL; if that 404s, the export already falls back to the product
  hero image. Deleting the asset doc does not retroactively strip quotes.
- **Visibility downgraded `public_reference` → `internal_only`:** because public
  surfaces filter live on `usableInMarketing()`, the asset drops out everywhere
  with no manual edit of blog posts or products.
- **Large uploads:** run through `resizeToJpeg`, same as product/blog/line images.

## 8. Implementation order

1. Data model + Brand Gallery section (upload / edit / delete / badges).
2. Firestore rule (§6) + publish + test the matrix.
3. Central helpers (§4); lock down the blog generator.
4. Quote picker "Customer brand images" tab → proposal PDF/Excel.
5. **(Phase 2)** Portal "My Brand Gallery" read-only page — then invite corp
   customers.

Phase 1 (steps 1–4) delivers the entire safety story plus the proposal workflow.
Phase 2 is a small, well-bounded addition once the rule is proven in practice.
