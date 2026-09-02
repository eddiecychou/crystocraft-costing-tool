# RBAC — flexible per-user module access (PLAN, awaiting sign-off)

> **Goal (owner, 2026-09-02):** drop the fixed `production` / `sales` staff roles.
> Every account is **`admin`**, **`staff`**, or **`customer`**. A `staff` user
> carries a `modules[]` list of exactly which functions they can reach, toggled
> by the admin in the account editor. Admin = everything; customer = storefront.
>
> **Status: NOT STARTED.** This reshapes the security boundary across the five
> RBAC surfaces + a rules deploy. Sign off on §2 (module list), §6 (open
> decisions) and the mapping in §4 before any code.

---

## 1. The model

| `users/{uid}.role` | Meaning | `modules` field |
|---|---|---|
| `admin` | Everything. Unchanged. | ignored |
| `staff` | Internal login. Access = exactly the keys in `modules[]`. | required (array of module keys) |
| `customer` | Storefront / portal only. Unchanged. `status` still gates approval. | ignored |

`production` and `sales` are **removed**. A transitional shim (§5) keeps an
un-migrated old-role account working until it's converted.

## 2. Module catalogue  *(sign-off needed — is this the right set + grouping?)*

21 keys. `†` = **sensitive** (grants sight of costs / margins / all-customer data
/ money / trade secrets — the admin should think before ticking).

| Group | Keys |
|---|---|
| Catalogue | `products`, `figurine`, `swatch`, `catalogues`, `pricing` † |
| Front office | `customers` †, `quotes`, `marketing`, `portal` |
| Fulfilment & finance | `shipping`, `invoices` †, `credit_notes` †, `uc` † |
| Supply | `components`, `suppliers`, `purchase_orders`, `inventory` |
| Ecommerce | `woo` |
| System | `dashboard`, `erp` †, `settings` † |

`dashboard` is effectively always-on for any staff (a landing page); could be
implicit rather than a checkbox.

## 3. The five surfaces

| # | File | Change |
|---|---|---|
| 1 | `src/access.js` | Replace `PRODUCTION_MODULES`/`SALES_MODULES` with `ALL_MODULES` (key → `{label, group, sensitive}`). `canAccess(role, key, modules)`: `admin`→true, `staff`→`modules.includes(key)`, else false. `AccessContext` provides `{role, modules}` (or a memoised `can(key)`); `useProfile` already loads the user doc — add `modules`. |
| 2 | `src/pages/AccountEdit.jsx` | Role control → `admin` / `staff` / `customer`. When `staff`: a **module checklist** (grouped per §2, sensitive keys flagged). Save writes `role` + `modules`. `audit_logs` entry gains a `modules` before/after diff (extend the existing L-01 audit — it already logs `role`/`status`/`account_type`). Remove the "Make production / Make sales / Switch to…" buttons. |
| 3 | `src/components/Layout.jsx` + `src/App.jsx` | `useVisibleNav` and `<Gate module="X">` pass `modules` into `canAccess`. Nav `module:` tags unchanged. Group-header hide logic unchanged. |
| 4 | `firestore.rules` | New helpers; every `isStaff()` / `isFrontOffice()` / `isProduction()` / `isSales()` call site → a `can('<module>')` check per §4. **Deploy first (L-11).** |
| 5 | `storage.rules` | Same helper rewrite; fewer paths (`images/`, `videos/`, `attachments/`, `catalogs/`). |
| 6 | `netlify/edge-functions/lib/auth.js` + callers + `erp.js` | Add `requireModule(req, key)` (= `requireRole` gated on `admin \|\| key ∈ modules`). Retag each of the 11 `requireFrontOffice` callers + `erp.js` with its module (§4b). |

### Rules helpers (new)
```
function uDoc()  { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data; }
function isAdmin(){ return signedIn() && uDoc().role == 'admin'; }
function isStaff(){ return signedIn() && uDoc().role == 'staff'; }        // flat staff role
function mods()   { return isStaff() && uDoc().modules is list ? uDoc().modules : []; }
function can(m)   { return isAdmin() || (m in mods()); }
```
`get(users/{uid})` is already performed by today's `isAdmin()`; Firestore
memoises `get()` within one evaluation, so no extra reads.

## 4. Rules mapping — every current call site → new check  *(sign-off needed)*

Principle: `isStaff()` (supply side) → the supply module that owns the
collection; `isFrontOffice()` (front office) → the front-office module.
`canShop()` / customer-own-doc clauses are **unchanged**.

| Collection(s) | Today | New |
|---|---|---|
| `range_components`, `range_components/*/{supplier_quotes,movements}`, `components`, `suppliers`, `supplier_quotes`, `{path=**}/supplier_quotes` | `isStaff()` | `can('components')` (suppliers/quotes) / `can('inventory')` for `*/movements` — **or one `can('components')` for the lot?** ← decide |
| `crystals`, `packaging`, `b2c_stock` (+ their `movements`) | `isStaff()` | `can('inventory')` |
| `purchase_orders` | `isStaff()` | `can('purchase_orders')` |
| `attachments`, `catalogs`, `videos` (storage-ish meta) | `isStaff()` | `can('suppliers')` (supplier catalogs/attachments) / `can('products')` (product videos) — split by path |
| `products/{id}` read | `canShop() \|\| isProduction() \|\| isSales()` | `canShop() \|\| can('products') \|\| can('figurine')` |
| `products/{id}` write, `products/{id}/images` write | `isStaff() \|\| isSales()` | `can('products')` |
| `products/{id}/pricing_tiers` | read `canShop() \|\| isSales()`, write `isAdmin()` | read `canShop() \|\| can('pricing') \|\| can('quotes')`, write `can('pricing')` |
| `products/{id}/videos` | `isStaff()` | `can('products')` |
| `range_products/{id}` (+ mirrored subpaths) | read `canShop() \|\| isProduction() \|\| isSales()`, write `isStaff() \|\| isSales()` | read `canShop() \|\| can('figurine')`, write `can('figurine')` |
| `crystal_swatch_notes` | `isAdmin()` + portal read | + `can('swatch')` write |
| `customers/{id}` (+ all subpaths: `proposal`, `assets`, `enquiries`, `whatsapp_threads`, `alibaba_threads`, `email_threads`), `{path=**}/enquiries`, `marketing_contacts` (+ `whatsapp_threads`/`alibaba_threads`/`email_threads`/`enquiries`) | `isFrontOffice()` | `can('customers')` |
| `marketing_campaigns`, `campaign_templates`, `outreach_drafts`, `draft_memory_rules`, `outreach_topic_templates` | `isFrontOffice()` | `can('marketing')` |
| `client_quotes` (+ `items`), `catalogues` (+ `items`) | `isFrontOffice()` | `can('quotes')` / `can('catalogues')` respectively |
| `customer_prices/{priceUid}` read | `request.auth.uid == priceUid \|\| isFrontOffice()` | `request.auth.uid == priceUid \|\| can('quotes') \|\| can('customers')` |
| `orders/{id}` (+ subpaths), `packing_lists`, `logistics_vendors`, `freight_quotes`, `freight_rfqs` | `isFrontOffice()` (+ customer-own-order read) | `can('shipping')` (+ customer clause unchanged) |
| `credit_notes` | `isFrontOffice()` | `can('credit_notes')` |
| `uc_invoices` | `isFrontOffice()` | `can('uc')` |
| `client_quotes` proposal subdoc | `isFrontOffice()` | `can('quotes')` |
| `settings/{docId}` — `pricing_groups` etc. | `isProduction()`/`isSales()` allow-listed docIds, else `isAdmin()` | drop the allow-lists → `can('settings')` for the settings module; `pricing_groups` write stays `can('pricing')` |
| `counters/{name}` | `isAdmin() \|\| (isProduction() && pu_*) \|\| (isSales() && (uc\|so)_*)` | `isAdmin() \|\| (can('purchase_orders') && pu_*) \|\| (can('quotes') && (uc\|so)_*)` |
| `users/{uid}` read | `isAdmin() \|\| isSales() \|\| own` | `isAdmin() \|\| can('portal') \|\| own` (portal module = view-only account visibility; **write stays admin-only — the privilege-escalation wall**) |
| `audit_logs` create | `isStaff() \|\| isFrontOffice()` | `isAdmin() \|\| isStaff()` (any internal login) |
| `portal_invitations` | `isSales()` (read/list) + admin actions | `can('portal')` read; create/approve stays the admin-SDK function (unchanged) |
| `woo_cache`, `seo_state*`, `seo_batches` | `isAdmin()` | `can('woo')` (keeps these admin-ish; woo module) |

### 4b. Edge functions
| Function(s) | Today | New |
|---|---|---|
| `compose-message`, `process-quote`, `extract-pi` | `requireFrontOffice` | `requireModule(req,'quotes')` |
| `generate-blog`, `generate-marketing-copy`, `rewrite-section`, `scrape-images`, `publish-to-wordpress` | `requireFrontOffice` | `requireModule(req,'marketing')` |
| `credit-note` | `requireFrontOffice` | `requireModule(req,'credit_notes')` |
| `ga-portal-activity` | `requireFrontOffice` | `requireModule(req,'portal')` |
| `erp.js` | admin all; `production` → item/stock family only | `can('erp')` → full ERP. **The item-only sub-split is lost** unless we add an `erp_items` key (§6). |
| `woo-sync`, `seo-state`, `seo-batch`, everything else on `requireAdmin` | `requireAdmin` | unchanged |

## 5. Migration (2 accounts — do by hand, no script)

| uid | email | was | → `role` | → `modules[]` |
|---|---|---|---|---|
| `1fSOuzrW…` | `2647939198@qq.com` | `sales` | `staff` | `dashboard, customers, quotes, marketing, catalogues, products, figurine, shipping, invoices, credit_notes, portal` |
| `DvQHPUOu…` | `pack5@uart.com.hk` | `production` | `staff` | `dashboard, products, figurine, components, suppliers, purchase_orders, inventory, erp` |

(6 admins + 38 customers untouched.)

**Transitional shim:** in `access.js` and the rules helpers, treat a legacy
`role == 'production'` as `modules = [PRODUCTION set]` and `role == 'sales'` as
`modules = [SALES set]`, so nothing breaks in the window between deploy and
hand-migration. Remove the shim once both accounts are converted (verified).

## 6. Open decisions  *(need answers before build)*

1. **ERP granularity.** Keep the "item/stock only, not customer/invoice" split
   (adds an `erp_items` key alongside `erp`), or collapse to one `erp` = full?
   — pack5 currently only needs items/stock.
2. **`components` vs `inventory`.** Are these one checkbox for the supply person,
   or genuinely separate (someone who counts stock but shouldn't see supplier
   prices)? Affects whether `range_components`/`suppliers`/`supplier_quotes` map
   to `can('components')` or `can('suppliers')`.
3. **`pricing` as a plain checkbox.** Confirmed you accept that ticking it grants
   cost/margin visibility and it's on you not to tick it for the wrong person
   (today it's a hard wall from `production`).
4. **`dashboard`** — implicit for any staff, or an explicit checkbox?

## 7. Sequencing

1. Agree §2 / §4 / §6.
2. Branch. `access.js` + `AccountEdit` + nav/gates + `ALL_MODULES` (with the
   legacy shim). Build, esbuild/lint.
3. `firestore.rules` + `storage.rules` rewrite. `firebase deploy --only
   firestore:rules` then `--only storage` — **before** the app push (L-11).
4. `lib/auth.js` `requireModule` + retag the 11 callers + `erp.js`.
5. Push app.
6. Hand-migrate the 2 accounts in `/portal` → AccountEdit.
7. Verify (§8). Remove the legacy shim in a follow-up commit.
8. Update `docs/skills/ARCHITECTURE-RULES.md` §2a, `access.js` header, memory
   `rbac-production-role.md`, `SKILL.md`, `TECH-DEBT.md`.

## 8. Verification checklist

- Legacy shim: pack5 / qq account still fully working immediately after deploy,
  before migration.
- After migration: sign in as each converted account (or use the QA account
  with a test `modules[]`) — every granted module opens, every ungranted one
  404s at the route AND permission-denies at the collection.
- `pricing` unticked → tier editor route blocked AND `products/*/pricing_tiers`
  write denied.
- `customers` unticked → CRM blocked AND `customers/*` + `{path=**}/enquiries`
  read denied.
- Admin unchanged (opens everything).
- Customer unchanged (storefront only).
- `users/{uid}` write still admin-only for a `staff` user with `portal` ticked.
- `audit_logs` shows the `modules` diff on the migration edits.

## 9. Risk / rollback

- **Highest risk:** a rules mapping error locks a real person out, or (worse)
  opens a collection too wide. Mitigation: the mapping table above is reviewed
  line-by-line before writing; the legacy shim means the two live staff accounts
  are never in limbo; rules are testable in the Firebase console simulator
  before release.
- **Rollback:** `git revert` the rules commit + `firebase deploy --only
  firestore:rules` restores the `production`/`sales` model instantly (the two
  accounts still hold their old `role` until step 6). The app revert is a normal
  push.
