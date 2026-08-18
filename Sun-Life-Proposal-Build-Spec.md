# Sun Life Brand Gallery → Customer Proposal Display — Build Spec

> Task ID: **PORTAL-01-SUNLIFE**
> Status: **Specification only — no code written, no collection created, no rule deployed.**
> Audience: Claude Code (implementation), Eddie (review/approval).
> Companion: `Customer_Brand_Gallery_Spec.md` (the logo-privacy spec this builds on).
> Repo: `~/Developer/costing-tool`. All paths repo-relative. Field names snake_case, per repo convention.

---

## 0. Objective

Turn the existing Sun Life Brand Gallery from a **flat, timestamp-ordered file list** into a **coherent, customer-specific proposal presentation** for a logged-in linked customer, reusing the already-proven asset store and privacy rules.

Intended experience (from the owner):

```text
Sun Life Brand Gallery
→ opening hero image
→ brand tagline
→ short briefing / brand direction
→ concept or story sections
→ section images
→ section tagline and briefing
→ related product cards
→ product images
→ optional customer-visible product links
→ enquiry / discussion action
```

---

## 1. Current state (confirmed 2026-08, do not re-derive)

- Assets live in **customers/{customerId}/assets/{assetId}** — a flat file store, NOT a proposal. Fields: `category` (`brand_asset`|`product_gallery`), `type` (`logo`|`guideline` | `mockup`|`in_use`|`photo`|`other`), `visibility` (`internal_only`|`customer_private`|`public_reference`), `can_use_in_marketing` (bool), `title`, `tags[]`, `filename`, `file_url`, `storage_path`, timestamps. See `src/customerAssets.js`.
- **There is no ordering field, no hero flag, no tagline/briefing/section/heading field, and no product-link field.** Ordering is `orderBy('created_at','desc')` (`customerAssets.js:120,166`).
- Customer-facing page `src/customer/BrandGalleryPage.jsx` is a read-only grid split into "Brand Assets" and "Product Gallery"; Product Gallery also merges catalogue photos tagged `branded_for_customer_id` (`loadBrandedProductImages`). No hero/tagline/briefing/sections/enquiry CTA.
- Admin curation `src/components/CustomerBrandGallery.jsx` (embedded at `CustomerDetail.jsx:1051`) is upload/edit/delete + visibility/consent/title/tags only.
- Privacy rules (`firestore.rules` → `customers/{cid}/assets/{aid}`): admin full; logged-in customer reads **only their own linked customer's non-`internal_only`** assets. Customer loader `loadCustomerVisibleAssets` constrains the query to `['customer_private','public_reference']` so query and rule agree.
- **Sun Life is a `sensitive` customer** (it was the live test subject for the branded-photo leak fix in `PROJECT-PLAN.md` V7.21 / "Where V8.2 starts"). Any new surface must reuse `loadCustomerVisibleAssets` + `loadBrandedProductImages` + `isStorefrontVisible`/sensitive screening and must never show another customer's branded imagery.

### Root cause of the display problem
The Brand Gallery was scoped (in `Customer_Brand_Gallery_Spec.md`) to **logo privacy + quote-image sourcing**, then a read-only "My Brand Gallery" file list. A "coherent proposal presentation" was never in scope. The asset store is fine; the **proposal layer that arranges assets + text + products is what is missing.**

---

## 2. Scope

**In scope (this build):**
- A per-customer **proposal content model** that *references* existing assets/products (no asset-model change).
- A **customer-facing proposal page** rendering hero → tagline → briefing → ordered sections → product cards → enquiry CTA.
- A minimal **admin editor** (draft/published) on Customer Detail.
- Firestore rules for the proposal doc (customer reads only their own, published).
- A **Phase 0 hard-coded Sun Life proposal** content module to validate the UX before any Firestore write.

**Out of scope (deliberate):**
- Changing the asset model, the asset privacy rules, or the asset upload flow.
- Customer self-editing of the proposal.
- A formal proposal PDF (revisit later; the quote export already resolves images).
- Multi-proposal-per-customer history (see Open Questions §9 — start single-doc).
- New edge functions, Postgres, or new secrets — Firestore-only.

---

## 3. Data model (proposed)

### 3.1 Location & cardinality
`customers/{customerId}/proposal/{docId}` — **single doc per customer** (`docId` fixed, e.g. `'current'`). If "many proposals per customer" is later confirmed, promote to `customers/{id}/proposals/{proposalId}`; do not over-build now.

### 3.2 Fields
```ts
{
  status:            'draft' | 'published',      // customer reads only 'published'
  hero_asset_id:     string | null,               // ref customers/{id}/assets/{aid}; null => no hero
  tagline:           string,                       // brand tagline (1 line)
  briefing:          string,                       // short brand direction (multi-line)
  sections: [                                     // ordered, one per concept/story
    {
      heading:       string,                       // section title
      tagline:       string,                       // section tagline
      briefing:      string,                       // section body
      asset_ids:     string[],                     // ordered refs to their own assets (images)
      product_refs:  { collection: 'products'|'range_products', id: string }[]   // related products
    }
  ],
  cta_label:         string,                       // default 'Make an enquiry'
  updated_at:        Timestamp,
  updated_by:        string,                       // admin email/uid
  created_at:        Timestamp,
  created_by:        string,
}
```

### 3.3 Why references, not copies
Assets and products stay the source of truth. If an asset is downgraded to `internal_only`, or a product is retired/inactive, the loader simply doesn't return it, so the proposal degrades gracefully with no migration and no privacy break. **Never denormalise a `file_url` into the proposal** — always resolve `asset_ids`/product refs at render time through the visible loaders.

### 3.4 No new asset fields
Do **not** add `hero`, `sort_order`, `tagline`, `briefing` to the asset model. Ordering and text belong to the proposal doc, not the media library. (This is the key architectural decision that keeps the privacy guarantee intact and avoids migrating existing Sun Life assets.)

---

## 4. Firestore rules (proposed)

Add to `firestore.rules` (inside the existing `match /customers/{customerId}` block, alongside `assets`):

```
match /proposal/{docId} {
  allow read: if isAdmin()
    || (isApprovedCustomer()
        && profile().get('customer_id', '') != ''
        && profile().get('customer_id', '') == customerId
        && resource.data.status == 'published');
  allow write: if isAdmin();
}
```

Requirements:
- Customer read is **scoped to their own linked customer** and **published only**.
- Admin is the sole writer (same posture as `assets`).
- **Deploy the rule separately** (rules are not part of `git push` — same note as `Customer_Brand_Gallery_Spec.md` §6) and test the matrix in §7 before inviting any corp customer.

---

## 5. Customer-facing page (proposed)

### 5.1 Route
Add to `src/customer/Storefront.jsx`:
- `/shop/proposal` → `ProposalPage` (new), wrapped in `CustomerLayout` + `ErrorBoundary`.

Also add a `quickActions` entry in `src/customer/homepageContent.js` (`{ key:'proposal', label:'My Proposal', to:'/shop/proposal', iconKey:'Presentation', requiresCustomer:true }`) so linked customers can reach it. **Do not reuse** the static `homepageContent` hero/pillars (they contain a generic client-branded trophy photo, "BNI Blossom", wrong for a Sun Life-specific proposal).

### 5.2 Data loading (must reuse, never bypass)
```ts
const customerId = profile?.customer_id
const proposal = await loadProposal(customerId)          // new: getDoc customers/{id}/proposal/current, published-only
const assets     = await loadCustomerVisibleAssets(customerId)   // existing
const branded    = await loadBrandedProductImages(customerId)    // existing
```
- Resolve `hero_asset_id` and each section's `asset_ids` against `assets` (keyed by id). Drop any id that doesn't resolve (asset missing/downgraded) — never render a broken image.
- Resolve `product_refs` against `products`/`range_products` with the existing shop visibility filters:
  - corporate: `active !== false && status != retired` (mirror `CorporateShop.jsx`)
  - range: `active !== false && status !== 'retired'` (mirror `FigurineShop.jsx`)
- For product cards, screen the hero image through the existing sensitive logic (`isStorefrontVisible` + `sensitiveImages.js`); a sensitive viewer never sees another customer's branded hero.
- If `proposal` is null (no published proposal), render the existing "nothing here yet" empty state (reuse the Brand Gallery empty-state wording) — do **not** fall back to the flat gallery.

### 5.3 Render order (matches intended experience)
1. Hero: full-width image (`hero_asset_id` resolved) with a subtle dark overlay; tagline + briefing overlaid or directly below (reuse `HomePage.jsx` hero layout conventions).
2. Sections: for each `sections[i]` — heading, tagline, briefing, then an image strip (resolved `asset_ids`), then a row of related product cards.
3. Product card: product image (screened), product name, and an optional "View product" link to `/shop/corporate/:id` or `/shop/figurine/:id` per `product_refs[].collection`.
4. CTA: a button (`cta_label`) that calls the existing cart `addToCart` with a pre-filled line and navigates to `/shop/enquiry` (see §5.4). Place it after the last section (and optionally once in the hero).

### 5.4 Enquiry / discussion action (reuse existing cart)
- The enquiry CTA must **not** build a new flow. Reuse `src/customer/store.jsx` cart and `src/customer/EnquiryPage.jsx` exactly as the product detail pages do.
- Simplest correct wiring: CTA navigates to `/shop/enquiry` after adding a lightweight cart line `{ type:'enquiry_note', id:'proposal', name: customer company, note: 'Sun Life proposal discussion' }` (mirror the `swatch_sample`/`custom` line-type precedent in `EnquiryPage.jsx`/customizer), so the enquiry arrives in the existing admin Enquiries tab with no new plumbing.
- If `EnquiryPage` rejects unknown line types, fall back to a plain link to `/shop/enquiry` (no pre-fill) — acceptable for Phase 0.

---

## 6. Admin editor (proposed, minimal)

- New section `Proposal` on `src/pages/CustomerDetail.jsx`, placed immediately above/below `CustomerBrandGallery` (line 1051).
- Form: hero picker (dropdown over `loadCustomerAssets(customerId)` product-gallery/photo assets + branded images), `tagline`, `briefing` textareas, and a repeatable sections list (heading/tagline/briefing + multi-select asset picker + multi-select product picker, with up/down reorder — reuse `@dnd-kit` already in `package.json`).
- Toggle `draft`/Save (writes `status`). `published` means the customer can see it; `draft` is admin-only preview.
- Writes go through new helpers in a new module `src/customerProposal.js`: `loadProposal`, `saveProposal(customerId, patch)`, `publishProposal`, `unpublishProposal` (mirror the `customerAssets.js` CRUD style).
- No new upload machinery; the editor only *references* assets/products.

---

## 7. Security & privacy test matrix (must pass before inviting Sun Life / any corp customer)

| # | Actor | Action | Expected |
|---|---|---|---|
| 1 | Unauthenticated | GET proposal | rejected (no auth) |
| 2 | Approved Sun Life login | read own published proposal | allowed; sees only Sun Life assets + Sun Life-branded products |
| 3 | Approved Sun Life login | read a **draft** proposal | denied |
| 4 | Approved Sun Life login | read another customer's proposal | denied |
| 5 | Another approved (sensitive) customer | read Sun Life proposal | denied (scoped to own customer_id) |
| 6 | Sun Life login | an asset in the proposal is downgraded to internal_only | asset silently drops from the proposal (never rendered) |
| 7 | Sun Life login | a product in the proposal is retired/inactive | product card drops; no broken link |
| 8 | Sensitive viewer | product hero is branded_for_customer_id for another customer | hero screened out (existing sensitiveImages.js path) |
| 9 | Admin | read/write any customer's proposal | allowed |

---

## 8. Edge cases & validation (shared validator shape, src/domain/validation.js)

1. `hero_asset_id` set but not visible to the customer → drop hero, keep rest (no crash).
2. `sections` empty → render hero + tagline/briefing + CTA only (valid).
3. `product_refs` referencing a deleted product → drop; never 404.
4. `status` invalid/missing → treat as `draft` (customer never sees it).
5. `asset_ids`/product refs contain duplicates → dedupe at render (and warn in editor).
6. Saving with an unresolved `hero_asset_id`/asset ref → validation **warning**, not a block (assets can be deleted independently; keep editor non-blocking).
7. Empty `tagline`/`briefing` → allow; render placeholders only if the owner wants a minimum (Open Question §9 Q2).

---

## 9. Open questions / decisions (answer before/at build)

1. **Where does the existing Sun Life "taglines / briefing / story" content live today?** (head, an external doc, asset title/tags, customer notes, product marketing_description?) — decides content-entry vs migration. **Blocks Phase 1 content population.**
2. Minimum content rules: is a proposal publishable with no tagline/briefing, or require tagline + at least one section?
3. One proposal per customer (start single-doc), or many over time? (default: single-doc now)
4. Which products may be referenced — corporate only, or also figurines/range? (default: both, via product_refs[].collection)
5. CTA wording and target — pre-filled enquiry line vs plain link? (default: pre-fill enquiry_note line)
6. Does "published" require any approval step, or is admin-save enough? (default: admin-save toggles draft/published)

---

## 10. Staged implementation plan

| Phase | Deliverable | Files (new ✚ / edit ✏) | Depends on |
|---|---|---|---|
| **Phase 0 — prove UX, zero Firestore writes** | Hard-coded Sun Life proposal content module + renderer | ✚ src/customer/proposalContent.js (temporary), ✚ src/customer/ProposalPage.jsx, ✏ src/customer/Storefront.jsx (route), ✏ src/customer/homepageContent.js (quick action) | §9 Q1 (just the content, for layout) |
| **Phase 1 — data model + loader** | customers/{id}/proposal doc + src/customerProposal.js helpers | ✚ src/customerProposal.js | — |
| **Phase 2 — admin editor** | Proposal section on Customer Detail | ✏ src/pages/CustomerDetail.jsx, ✚ src/components/ProposalEditor.jsx | Phase 1 |
| **Phase 3 — rules + tests** | Firestore rule (§4) + §7 matrix | ✏ firestore.rules (publish separately) | Phase 1 |
| **Phase 4 — replace Phase 0 with live data** | ProposalPage reads loadProposal; delete proposalContent.js | ✏ ProposalPage.jsx | Phases 1–3 |
| **Phase 5 — Sun Life population + rollout** | Enter real Sun Life content, publish, verify as the Sun Life login | (data entry, no code) | Phases 1–4 |

**Acceptance (Sun Life as the real example):** logged in as the Sun Life account, the full hero→tagline→briefing→sections→product cards→enquiry flow renders end-to-end with **all** existing Sun Life assets mapped into sections (not one or two products), no other customer's imagery appears, and the enquiry arrives in the admin Enquiries tab.

---

## 11. File-by-file change summary (for Claude Code)

- ✚ src/customerProposal.js — loadProposal, saveProposal, publishProposal, unpublishProposal, resolveProposalAssets.
- ✚ src/customer/ProposalPage.jsx — customer renderer (§5.3).
- ✚ src/components/ProposalEditor.jsx — admin editor (§6).
- ✏ src/customer/Storefront.jsx — add /shop/proposal route.
- ✏ src/customer/homepageContent.js — add proposal quick action.
- ✏ src/pages/CustomerDetail.jsx — embed ProposalEditor.
- ✏ firestore.rules — add proposal read/write rule (§4).
- ✏ (Phase 0 only) src/customer/proposalContent.js — temporary hard-coded content, removed in Phase 4.

**Verification note (per AGENTS.md):** after wiring a page, do not trust the esbuild parse-only check — fetch Node and actually render the page (the qa/README.md PNG-render pattern generalizes) or click-test live, and say in the commit message what was verified.

---

## 12. Non-goals (guardrails)

- Do **not** modify the asset model, customerAssets.js visibility logic, or the assets Firestore rule.
- Do **not** add customer self-upload or self-edit.
- Do **not** bypass loadCustomerVisibleAssets/isStorefrontVisible — any shortcut reintroduces the branded-photo leak this whole project exists to prevent.
- Do **not** introduce new secrets, edge functions, or Postgres objects.
