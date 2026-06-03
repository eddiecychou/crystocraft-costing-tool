# Crystocraft Costing Tool – Implementation Summary

## A. Data Hygiene Checklist (First 20–30 Products)

### 1. Product Setup
- Use consistent naming: `Category – Key Feature – Use Case` (e.g. `Tumbler – NFC Smart Gift – Bank VIP`).
- Assign a controlled category (Drinkware, Trophy, Stationery, Smart Gift, Decor, etc.).
- Always set product status: `concept` → `sampled` → `active` → `discontinued`.
- Write a short description (2–3 sentences: material, size, key features, use case).

### 2. BOM & Components
- List all cost-driving components (figurine, metal parts, NFC, box, inserts, ribbons, etc.).
- Use clear component names (e.g. `Gift Box – Magnetic`, `NFC Card – 215`).
- Fill `spec` with concrete info: material, dimensions, finish.
- Ensure `unit` is correct (`pcs`, `set`, etc.).

### 3. Supplier Quotes
- For each component, ensure at least one `supplier_quote` is marked `is_preferred = true`.
- Confirm `unit_cost` and `unit_cost_currency` match the original quote.
- Always fill MOQ and lead times; if estimated, state this in `notes`.
- Capture tooling/sample cost explicitly (0 if none).

### 4. Attachments & Images
- Attach at least one clean screenshot/PDF per supplier quote.
- Add component images for key parts (spec/drawing/reference).
- Ensure each product has a good hero image for exports.

### 5. Pricing & Exchange Rates
- Keep `settings/exchange_rates` up to date (especially RMB→HKD).
- Define realistic pricing tiers aligned with supplier MOQ breakpoints.
- Sanity-check total unit cost (components + tooling amortisation + assembly).
- Use markup slider to target healthy margin %, and verify colour indicators.

#### Live exchange rate support (recommended)
- Add a **“Fetch latest rates”** button in the Settings → Exchange Rates screen.
- Implement a Netlify Edge Function (e.g. `/api/fx-latest`) that calls a free FX API such as `exchangerate.host` to retrieve current rates (e.g. CNY→HKD, USD→HKD, EUR→HKD).
- Show fetched "live" rates alongside the current saved rates with timestamp and source; require manual **Apply** to write new values into `settings/exchange_rates`.
- Snapshot the exchange rate into each `client_quotes.rmb_to_hkd_rate` when creating a quote so old quotes remain auditable even after rates change.
- Optional: later, add a daily scheduled function to refresh `settings/exchange_rates` automatically, while still snapshotting the rate per quote.
- Keep `settings/exchange_rates` up to date (especially RMB→HKD).
- Define realistic pricing tiers aligned with supplier MOQ breakpoints.
- Sanity-check total unit cost (components + tooling amortisation + assembly).
- Use markup slider to target healthy margin %, and verify colour indicators.

### 6. Quote-Ready Criteria
A product is “quote-ready” when:
- All components have preferred suppliers.
- At least two realistic pricing tiers exist with acceptable margins.
- Lead time is known for the largest tier you expect to offer.
- Product has a clear description and hero image.

---

## B. V1 PDF Quote Layout Spec

### 1. Page & Typography
- A4 portrait, 20 mm margins.
- Fonts: `Helvetica` / `Helvetica-Bold`; body 10–11 pt, headings 14–16 pt.

### 2. Header
- Left: Crystocraft logo + company name + website/email.
- Right: title `Corporate Gift Quotation`, quote date, optional quote number.

### 3. Client & Quote Info Block
- Left: client name, contact name, optional company/department.
- Right: exchange rate summary (e.g. `RMB → HKD: 1 : 1.09`), validity note, optional quote status.
- Thin divider line below.

### 4. Product Cards (Repeated Per Item)
- Layout: image on left, text and tier table on right / below.
- Image: hero image (approx. 35–40 mm wide, preserve aspect ratio).
- Text block:
  - Product name (bold).
  - Category and status (smaller, muted).
  - Short description (snapshot from product).

#### Tier Table (Per Product)
- Columns: `Qty`, `Unit Price (HKD)`, `Total Amount (HKD)`.
- Rows from `tiers` array (e.g. 200, 500 pcs with prices).
- Compute `Total Amount = qty × unit price`.
- Header row with light grey background; right-align numeric cells; 2 decimal places.
- Repeat header row on page breaks.

### 5. Notes & Conditions
- After last product, add a **Notes** section instead of a grand total, e.g.:
  - "All prices in HKD and exclude shipping and taxes."
  - "Lead times subject to final confirmation upon order."
  - "Tooling/sample charges, if applicable, are included in the unit prices above."

### 6. Footer
- Left: company address/contact.
- Right: page number (`Page X of Y`).

### 7. Styling
- Use one primary brand colour for title, table headers, and dividers.
- Keep borders thin (0.5 pt) and layout clean with generous white space.
- Ensure design prints clearly in black & white.

### 8. Data Mapping (For @react-pdf)
- Header: logo, static title, `client_quotes.date`.
- Client block: `client_name`, `contact_name`, optional `notes`.
- Quote details: `rmb_to_hkd_rate` for exchange rate.
- Items: loop `client_quote_items` → hero image, `product_name`, `product_category`, `product_description`, `tiers`.
- Notes: static text or `client_quotes.notes`.
# Crystocraft Corporate Gift Coding Guidelines

## 1. Purpose

Define a consistent, human-readable item code and naming convention for **corporate gift products** managed in the costing tool. This is separate from legacy Crystocraft ERP figurine SKUs.

---

## 2. Category Codes

Use these fixed category codes in both the **item code** and the **product record**.

| Code | Category name      | Use for                                                  |
|------|--------------------|----------------------------------------------------------|
| DRINK | Drinkware          | Tumblers, bottles, mugs, flasks                         |
| AWARD | Awards & trophies  | Trophies, plaques, crystal awards, framed certificates  |
| SMART | Smart Gifts (NFC)  | NFC frames, NFC coins, Smart Gift sets                  |
| SET   | Gift sets          | Bundles: figurine + box, tumbler + accessories, etc.    |
| TECH  | Tech accessories   | Power banks, chargers, stands, USB drives               |
| DECO  | Decor & desk       | Figurines, desk ornaments (non-ERP, corporate-only)     |
| EVENT | Event collaterals  | Badges, lanyards, keychains, small giveaways            |

Extend this list only when necessary to keep data clean and searchable.

---

## 3. Item Code Structure

Pattern for **corporate gift items**:

`CG-[CAT]-[YY][NN]`

Where:
- `CG` = Corporate Gift line (fixed prefix).
- `[CAT]` = one of the category codes above (DRINK, AWARD, SMART, SET, TECH, DECO, EVENT).
- `[YY]` = 2-digit year when the item was first created (e.g. 26 for 2026).
- `[NN]` = 2-digit running number per year per category (01, 02, 03…).

### Examples

- `CG-DRINK-2601` – First drinkware corporate gift concept created in 2026.
- `CG-AWARD-2603` – Third award/trophy concept created in 2026.
- `CG-SMART-2502` – Second Smart Gift (NFC) concept created in 2025.
- `CG-SET-2605` – Fifth gift set concept created in 2026.

Store this code in the `product_code` field of the `products` collection and display it on:
- Product list and detail pages.
- Pricing and costing screens.
- Excel and PDF exports.

---

## 4. Naming & Description

Human-readable **product name** format:

`[Category Plain Name] – [Key Feature] – [Use Case / Audience]`

Examples:
- `Tumbler – NFC Smart Gift – Bank VIP`
- `Crystal Award – Rose Motif – Employee of the Month`
- `Smart Gift Frame – Wedding Memory – NFC`

Short description (2–3 sentences) should cover:
- Materials and main dimensions.
- Customization methods (engraving, UV print, NFC link, packaging).
- Primary use case (VIP client gift, employee recognition, campaign launch, etc.).

---

## 5. When to Reuse vs Create New Code

**Reuse existing ERP SKU code only when:**
- It is a standard Crystocraft figurine sold more or less "as-is" as a gift (no bundle, no special corporate positioning).

**Create a new CG code when:**
- It is a corporate-only concept (tumbler trophy, Smart Gift, power bank gift, custom frame, etc.).
- It is any bundle or set (figurine + box, tumbler + gift card, Smart Gift kit).
- Packaging or branding is significantly different for this corporate use (e.g. special "Elite Club" edition).

ERP figurines can still appear as components in the BOM, but the client-facing item is always the CG code.

---

## 6. Team Process for Assigning Codes

1. **Create product:**
   - Choose the category from the fixed list.
   - Check the highest existing `[NN]` for that `[CAT]-[YY]`.
   - Increment by 1 and assign the new code.

2. **Record the code:**
   - Save in `product_code` field (Firestore).
   - Use the same code in any related Excel/quote references.

3. **Do not change codes after use:**
   - Once a code has been used in a client quote, do not edit it.
   - If a concept changes significantly, create a new code and mark the old one as `discontinued` or `legacy`.


---

## 7. Component Coding (Optional, Lightweight)

- Do **not** create full codes for every component; this adds friction with limited benefit.
- Use clear names + specs for all components (e.g. `NFC Card – 215`, `Gift Box – Magnetic A5`).
- Add an optional `component_code` field **only** for reusable / strategic components:
  - Components reused across many products (e.g. standard NFC cards, common gift box styles).
  - Key cost drivers you want to track over time (e.g. premium tumbler body, special velvet box).
  - Components that correspond to existing ERP items.
- Suggested pattern for optional component codes: `CMP-[TYPE]-[DETAIL]`, e.g.:
  - `CMP-NFC-215-A` – NTAG215 NFC card, version A.
  - `CMP-BOX-MAG-A5` – A5 magnetic gift box.
  - `CMP-TMB-SS-500ML` – 500 ml stainless tumbler body.
- Start with **no component codes**; as you see components reused in 3+ products, assign codes to those high-impact ones only.

---

## 8. Implementation Logic for Optional Component Coding

### Goal

Implement component coding in a lightweight way so the system supports reusable / strategic components without forcing codes on every component.

### Data Model Changes

Add the following optional fields to each component record:

- `is_standard: boolean` — default `false`
- `component_code: string | null` — optional, only used when the component is marked as standard
- `component_type: string | null` — optional helper field for standard components (e.g. `NFC`, `BOX`, `TMB`)
- `detail_suffix: string | null` — optional helper field used to generate the code (e.g. `215-A`, `MAG-A5`, `SS-500ML`)

This keeps all existing costing logic unchanged because pricing, supplier quotes, and BOM structure do not depend on `component_code`.

### UI Logic

On the component create/edit form:

- Always show the standard fields: `name`, `spec`, `unit`, `notes`.
- Add a toggle: **Standard component**.
- When toggle is OFF:
  - Hide `component_code`, `component_type`, and `detail_suffix`.
  - Save the component as a normal free-form BOM item.
- When toggle is ON:
  - Show `component_type` dropdown.
  - Show `detail_suffix` text input.
  - Show a `Generate code` button.
  - Show `component_code` as read-only by default, with optional manual override if needed.

### Suggested Component Type Options

Start with a short fixed list:

- `NFC` — NFC cards / tags / chips
- `BOX` — gift boxes / packaging boxes
- `TMB` — tumbler body
- `INS` — inserts / cards / printed inserts
- `PLT` — plates / metal nameplates
- `ACC` — accessories / ribbons / add-ons
- `OTH` — other reusable components

This list can be extended later, but keep it short for V1.

### Code Generation Logic

Suggested code pattern:

`CMP-[TYPE]-[DETAIL]`

Examples:

- `CMP-NFC-215-A`
- `CMP-BOX-MAG-A5`
- `CMP-TMB-SS-500ML`

Generation logic:

1. User marks component as standard.
2. User selects a `component_type`.
3. User enters a `detail_suffix`.
4. System generates:

```ts
const componentCode = `CMP-${componentType}-${detailSuffix.toUpperCase()}`;
```

5. On save, optionally check Firestore to ensure the code does not already exist on a different component.

### Validation Logic

- If `is_standard = false`:
  - `component_code`, `component_type`, and `detail_suffix` can remain empty.
- If `is_standard = true`:
  - `component_type` is required.
  - `detail_suffix` is required.
  - `component_code` must be generated or manually entered before save.
- If a duplicate `component_code` exists:
  - Show a validation message and block save until changed.

### Reuse Logic

For V1, do not automate component coding aggressively.

Recommended rule:

- Default all components to non-standard.
- Only mark a component as standard when it is clearly reusable or strategic, such as:
  - reused across 3+ products,
  - a key cost driver,
  - or linked to an ERP-tracked item.

This should be a manual operational decision, not an automatic system rule.

### Future Enhancement (Optional)

Later, the tool can track component reuse and suggest standardization automatically:

- Add a `usage_count` field or compute reuse across BOMs.
- If a component appears in 3+ products, show a prompt:
  - **“This component is used in multiple products. Consider marking it as a standard component and assigning a code.”**

### Key Principle

- **Always code products.**
- **Only code components selectively.**

This keeps the system practical, searchable, and scalable without making day-to-day data entry too heavy.

---

## 9. ERP Integration Decision

### 9.1 Principle

- **Component level** in the costing tool will continue to use the existing JES/ERP coding system (`U…`, `FM…`, `P…` codes) as the canonical identifier for parts and materials.[file:50]
- **Corporate gift products** in the costing tool will use the new `CG-[CAT]-[YY][NN]` codes as a commercial layer on top of ERP, without changing any ERP rules.[file:26][file:50]

### 9.2 Data Fields

At the **product** level:

- `product_code` — new corporate gift code (e.g. `CG-DRINK-2601`).
- `erp_finished_code?: string` — optional; filled when the corporate gift product maps directly to a single ERP finished SKU (e.g. pure figurine sold as-is).

At the **component (BOM) level**:

- `name`
- `spec`
- `unit`
- `erp_code: string | null` — ERP code for this component when it exists (e.g. `U0257-001-GAB`, `FM-PL120120H00-C`, `P-PB099-01-02`).[file:50]
- Cost and supplier fields as already defined (currency, unit_cost, moq, etc.).

### 9.3 Usage Rules

- For components that already exist in ERP, always fill `erp_code` so costing can be tied back to manufacturing and inventory.
- For early-stage or experimental components not yet in ERP, `erp_code` can be left null initially and filled later once an ERP code is assigned.
- The costing tool does **not** attempt to replicate or enforce the detailed ERP coding logic; it simply stores ERP codes as references where applicable.[file:50]

