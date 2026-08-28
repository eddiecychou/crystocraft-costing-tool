# Corp-gift product variations — investigation, audit & plan

> **SHELVED 2026-08-28 — do not start building from this.** The owner read the
> plan and judged it too complicated for the value right now ("let's drop the
> idea for the time being"). Kept because the audit in §4 is the expensive part
> and would otherwise be redone from scratch: it found that the obvious design
> (type a price per variant) is wrong for two independent reasons, plus five
> other landmines and one live pre-existing bug. If variations come back, start
> at §4, not §1.
>
> **Meanwhile:** a one-off size/colour variation can already be quoted today via
> QuoteDetail's "+ Custom Item" (free-text description + its own price ladder),
> and carried onto the PI/invoice as a normal free-text line. That is what this
> feature would have made *reusable*, not what it would have made *possible*.

**Ask (owner, 2026-08-28):** a corporate-gift product that comes in different
**sizes / colours** with a **different price per variation**, kept as **one
product** rather than many. What does it touch, and how hard is it?

**Short answer:** the internal path (product → quote → PI/invoice) is
**small-to-medium**, because orders and invoices are already free-text and not
linked to catalogue SKUs. The **customer storefront** is where the real work is.
A working `variants[]` model already exists on the figurine side
(`range_products`) and is the template.

**Nothing has been built.** This is the plan; §4 is a code audit done before
writing it, and it changed the recommended design (see §4.1/§4.2).

---

## 1. How a corp product works today

| Piece | Where | Shape |
|---|---|---|
| Product record | `products/{id}` | one flat doc — `name`, `description`, `category`, `heroImage`, `unit`, `status`, media. **No size/colour/variant field.** |
| Bill of materials | `products/{id}/components/{cid}` (+ `supplier_quotes`) | one BOM per product |
| Internal price ladder | `products/{id}/pricing_tiers/{tid}` | quantity breaks; **computed**, not typed — `totalUnitCostAtQty(BOM) × group markup` (`PricingTiers.jsx`) |
| Published customer price | `products/{id}/customer_prices/{uid}` | per-customer copy of the ladder, written on "Publish"; raw cost never leaves the admin tool |
| Quote line | `client_quotes/{qid}/items/{iid}` | **snapshot** — `product_id`, `product_name`, `product_description`, `hero_image`, `unit_cost_hkd`, `tooling_cost_hkd`, `tiers[]`. Also supports **custom lines** (`is_custom`, free text + own tiers) |
| Order / PI / invoice line | `orders/{oid}` lines (`shipping.js`) | `item_code`, `description`, `qty_ordered`, `unit_price`, `line_image` — **deliberately not a catalogue link** (`shipping.js:293`) |
| Storefront product page | `customer/CorporateDetail.jsx` | reads `customer_prices/{uid}` for the ladder; "Add to enquiry" pushes a cart line |

### The figurine precedent — already built

`range_products/{id}.variants[]` (`RangeForm.jsx`) already gives each variant its
own name, image, price (`ws_price_usd`), stock and colour attribute, and
`SchemaAudit.jsx` already validates them. The corp side mirrors this.

---

## 2. Data shape

An **array field on the product doc** — not a subcollection, so **no Firestore
rules change** is needed:

```js
products/{id}.variants = [
  {
    id: 'v_ab12cd',
    name: 'Blue / XL',          // prints on quotes, PIs and invoices
    attributes: { colour: 'Blue', size: 'XL' },  // optional; for a storefront picker later
    image: 'https://…',         // optional; falls back to the product hero
    sku_suffix: '-BLU-XL',      // optional; appended to item_code on orders
    cost_delta_hkd: 6.50,       // ← see §2.1. +/- on the base BOM unit cost
    active: true,
  },
]
```

### 2.1 Pricing model — **cost delta, not a typed sell price**

The audit (§4.1, §4.2) killed the obvious "type a price per variant" design.
Corp-gift pricing is **cost-driven end to end**: BOM cost → × that customer's
markup → their price. A typed sell price is one number for everybody, so it
silently bypasses per-customer pricing, and it makes the quote's margin column
lie (the margin is computed against the base product's cost snapshot).

A **per-variant cost delta** keeps the entire existing machinery correct:

| Consumer | With a cost delta | With a typed price |
|---|---|---|
| `publish()` per-customer price | `(baseCost + delta) × markup` — per-customer pricing preserved | one price for all customers ❌ |
| Quote margin column | correct — snapshot `unit_cost_hkd` includes the delta | wrong ❌ |
| `pricing.js` helpers | unchanged (one extra addend) | unchanged |
| Data entry | one number per variant | a whole ladder per variant |

Options considered and rejected:
- **Typed sell ladder per variant** — breaks both of the above.
- **Full per-variant BOM** — exact, but `PricingTiers.jsx`, `pricing.js`, the
  quote cost snapshot and `SchemaAudit` all assume one BOM per product. Large.

A per-tier **manual sell override** can be layered on later if a variation ever
needs to be priced above what its cost justifies — it just must not be the
primary mechanism.

### 2.2 `customer_prices` shape

When a product has variants, publish writes:

```js
{ variants: { [variantId]: [ {quantity, price_hkd, lead_time_days}, … ] },
  markup, computedAt }
```

Readers fall back to the existing flat `tiers` when `variants` is absent, so
every product without variations behaves exactly as today.

---

## 3. Module-by-module impact

Ordered biggest → smallest.

### 🔴 Customer storefront — LARGE *(Tier 2 only)*
- `customer/CorporateDetail.jsx` — size/colour picker; ladder + hero image switch
  with the selection; MOQ recomputes.
- `customer/CorporateShop.jsx` — grid card shows "from $X" or an "N options" badge.
- `customer/store.jsx` — cart line carries the variant (**`cartKey` already has
  slots for this**, see §4.7).
- `enquiryExport.js` — `variantCode()` and the item row must carry the variant.
- `favourites/{uid}` — product-level today (§4.8); decide whether to change.

### 🟠 Costing / pricing page — MEDIUM
- `pages/PricingTiers.jsx` — a cost-delta field per variant, and the computed
  ladder shown per variant; `publish()` writes the §2.2 shape.
- `prices_signature` must include the variants (§4.5) or "Publish" looks fresh
  while serving stale prices.

### 🟠 Quotes — MEDIUM
- `QuoteDetail.jsx` `handleAddProducts()` — pick which variant(s); add **one line
  per chosen variant**; line gains `variant_id` + `variant_name`; `unit_cost_hkd`
  snapshot **must include the variant's cost delta** (§4.1).
- The product picker's dedupe must stop blocking a second variant of the same
  product (§4.4).
- `QuotePDF.jsx` / `QuoteExport.jsx` — print `variant_name`; tier logic unchanged.

### 🟢 Orders / PI / Sales Invoice / Credit Notes — SMALL
- Lines are already free text, so a variation needs **no schema change** —
  it lives in `description` + `item_code`.
- Convert-to-PI (`ShipmentForm.jsx:304`) must fold `variant_name` into the line
  description and `sku_suffix` into `item_code`, or the variation is lost at the
  PI step (§4.9).
- **If** a structured `variant_id`/`variant_name` is ever put on an order line,
  it must be added to `normLine`'s whitelist or it is silently dropped (§4.3).
- The print pages themselves need **no change**.

### 🟢 Product form / detail — MEDIUM (new UI, low risk)
- `ProductForm.jsx` — a variants editor (add/remove/reorder, name, attributes,
  image, cost delta, active), same pattern as `RangeForm.jsx`'s variant block.
- `ProductDetail.jsx` — list the variants and their computed ladders.
- `Products.jsx` grid — decide what price a card shows for a product with
  variants (§4.10).

### 🟢 Catalogue / schema audit — SMALL, optional
- `CatalogueDetail.jsx` — a catalogue is marketing, not a price list; ignore
  variants in v1, or add an "Available in: …" spec line.
- `SchemaAudit.jsx` — add corp-variant checks mirroring the figurine ones
  ("variant with no name", "variants but none active").

### ⚪ No impact
WooCommerce sync (never touches `products`) · Customizer (`product_templates`) ·
blog generator / marketing copy / front-page featured / brand proposal /
collection bands (read `name`/`description`/`heroImage` only) · ERP product
import · **Firestore rules** (array field, not a subcollection) · **storage.rules**.

---

## 4. Pre-implementation audit

Read of the real code before planning. Each item is a concrete landmine, with
the file and line that proves it.

### 4.1 🔴 A typed variant price would make the quote's margin column lie
`QuoteDetail.jsx:657–668` computes margin from `item.unit_cost_hkd`, a snapshot
of the **base product's** BOM cost taken at add-time. A variant priced
differently but sharing that snapshot shows a margin that is simply wrong — and
margin is what the pricing decision is made on.
**→ Design response:** per-variant `cost_delta_hkd` (§2.1), folded into the
snapshot at add-time.

### 4.2 🔴 A typed variant price silently bypasses per-customer pricing
`PricingTiers.jsx:126–152` — `publish()` computes **every approved customer's**
price as `cost × effectiveMarkup(customer, groups)`. A hand-typed sell price is
a single number, so variants would be the one part of the catalogue where every
customer sees the same price, with nothing in the UI saying so.
**→ Design response:** same as 4.1 — the delta feeds the existing formula.

### 4.3 🔴 `normLine` is a strict whitelist — new line fields are silently dropped
`shipping.js:282–303`. This is the exact bug class already recorded twice in
`PROJECT-PLAN.md` (`hide_total_qty` in V8.11; `contact_id` / `channel` /
`woo_fee` before it): a field is added to the write path, the save appears to
work, and the read-side normaliser drops it.
**→ Plan response:** v1 deliberately carries the variation as **free text** in
`description`/`item_code` (no new line fields). If structured fields are ever
added, `normLine` is the first place to change.

### 4.4 🔴 The quote product picker blocks adding the same product twice
`QuoteDetail.jsx:1123` — `!existingIds.includes(p.id)`, fed by
`items.map(i => i.product_id)` (`:604`). Quoting Blue **and** Red of one product
is impossible until this is keyed on `product_id + variant_id`.

### 4.5 🟠 `prices_signature` doesn't know about variants
`PricingTiers.jsx:81–91` hashes tiers, component costs, group markups and rates.
Variant cost deltas are not in it, so editing a variant would leave the page
showing "published / up to date" while customers are served the old prices.

### 4.6 🟠 `customer_prices` is written with `batch.set` (no merge)
`PricingTiers.jsx:146` replaces the whole doc per customer. The new variant shape
must be written complete on every publish — a partial write would strand a
product between the flat and variant shapes.

### 4.7 🟢 Good news — the cart is already variant-capable
`customer/store.jsx:9` — `cartKey = i => \`${i.type}:${i.id}:${i.finish||''}:${i.color||''}\``.
Slots for a variant dimension already exist and are already backfilled for old
lines (`:56`). Tier 2's cart work is smaller than it first looked.

### 4.8 🟠 Favourites are product-level
`customer/store.jsx:5` — `sameItem = (a,t,id) => a.type===t && a.id===id`.
Favouriting is by product, not variant. Probably fine (favourite the product,
choose the variant when enquiring) but it should be a decision, not a surprise.

### 4.9 🟠 Convert-to-PI would drop the variant name
`ShipmentForm.jsx:304` — `description: it.product_name || it.product_description`.
Without a change here the variation vanishes exactly at the step where it starts
mattering commercially.

### 4.10 🟠 The admin Products grid has no rule for a variant price
`Products.jsx:105–152` reads `pricing_tiers` and shows `price_hkd` per tier.
With variants the card needs a rule — cheapest variant, "from X", or the base.

### 4.11 🐛 PRE-EXISTING BUG — corp-gift quote lines are labelled as figurine products on Convert-to-PI

`ShipmentForm.jsx:310` writes, for **any** catalogue quote item:

```js
matched_product_ref: { collection: 'range_products', id: it.product_id, … }
line_type: 'range'
```

But `QuoteDetail.jsx`'s picker adds **corp gifts** — `it.product_id` is a
`products/` id (`QuoteDetail.jsx:268` reads `products/{id}/pricing_tiers`). So a
corp-gift quote converted to a PI claims to be a matched *range* product with an
id that does not exist in `range_products`. Consequences:

- `packing.js:132` — `rangeProducts.find(p => p.id === …)` returns `undefined`,
  so `pcs_per_carton`, carton dims and weights are all missing and the carton
  plan silently falls back to **1 carton, no dimensions, no weight**.
- `mrp.js:55–61` — guarded, so it degrades safely to "no product", but the line
  is invisible to material planning.
- `ShipmentForm.jsx:1227` still renders a green ✓ "matched" badge, so the UI
  **asserts a match that isn't real**.

Not caused by this feature and **not fixed here** — recorded in `TECH-DEBT.md`.
Worth its own small fix: either set `collection: 'products'` for corp items and
teach the consumers, or leave corp lines `ad_hoc`/unmatched, which is what they
effectively are for packing and MRP.

---

## 5. Plan

### Tier 1 — internal: product → quote → PI *(~2 focused sessions)*
Delivers *"I keep one product, quote the customer Blue / XL at its own price,
and that price flows to the PI and the invoice."* The storefront is untouched
and keeps showing the base product.

1. **Data + helpers** — `src/domain/productVariants.js`: `normalizeVariant`,
   `variantsOf(product)` (returns `[]` for a variant-less product),
   `activeVariants`, `variantUnitCostHKD(base, variant)`. Mirrors
   `domain/supplierContacts.js`.
2. **Product form** — variants editor in `ProductForm.jsx` (name, attributes,
   image, `sku_suffix`, `cost_delta_hkd`, active). Saves the array on the doc.
3. **Pricing page** — `PricingTiers.jsx` shows the computed ladder per variant
   (base ladder when there are none); `publish()` writes the §2.2 shape;
   **`prices_signature` gains the variants** (§4.5).
4. **Quotes** — picker offers the variants of a product with any; one line per
   chosen variant; line stores `variant_id`/`variant_name` and a
   delta-inclusive `unit_cost_hkd`; **picker dedupe keyed on
   `product_id + variant_id`** (§4.4). `QuotePDF`/`QuoteExport` print the name.
5. **Convert-to-PI** — fold `variant_name` into the line description and
   `sku_suffix` into `item_code` (§4.9). No new order-line fields (§4.3).
6. **Products grid** — decide and implement the card rule (§4.10).

### Tier 2 — storefront *(+2–3 sessions)*
Variant picker on `CorporateDetail` with live price/image switching · per-variant
`customer_prices` reads · cart + enquiry export variant-aware (§4.7 makes this
cheaper) · decide favourites (§4.8).

### Tier 3 — polish *(+1 session)*
Catalogue spec line · `SchemaAudit` corp-variant checks · ERP plating-variant
mapping · fix §4.11 (separately, on its own merits).

### Testing
No emulator rules test is needed (no rules change). Per commit: parse, no-undef
lint, full bundle. The pricing maths deserves a small node check of
`variantUnitCostHKD` + the publish computation against a fixture, in the style of
`qa/*.mjs`, because §4.1/§4.2 are silent-wrong-number bugs, not crashes.

---

## 6. Open decisions for the owner

1. **Cost delta (§2.1) confirmed?** It's the recommendation, and it's what keeps
   margins and per-customer pricing correct. Say so if a variation's price is
   genuinely *not* cost-driven, and a manual override gets designed in.
2. **Tier 1 only, or Tier 1 + 2?** i.e. do customers need to see and choose
   variations in the shop, or is this a quoting/invoicing tool for now?
3. **Free-text variant name ("Blue / XL") only, or structured `size` + `colour`?**
   Structured is needed for a real storefront picker, overkill for quoting alone.
4. **Auto `sku_suffix` on order item codes**, or keep item codes hand-typed?
5. **Fix §4.11 now or later?** It is live today and mis-labels corp-gift PI lines.
