# Crystocraft Gift Selector – Project Brief

## 1. Purpose

Create a “gift selector” experience for Crystocraft.com that turns vague gifting needs into concrete recommendations of existing products, semi‑custom options, and fully custom concepts, with a strong focus on B2B / corporate buyers.

## 2. Primary Goals (V1)

- Generate qualified B2B leads with structured briefs (occasion, quantity, budget, customization, timeline) instead of unstructured messages.
- Help visitors quickly see 3–6 relevant options: existing SKUs, semi‑custom ideas, and concept templates.
- Reuse and surface existing Crystocraft assets (product catalogue, blog content, Smart Gift concepts) instead of starting from zero every inquiry.

## 3. Target Users

- **Corporate / B2B buyers (primary)**  
  - Roles: marketing, procurement, HR, events, agency planners.  
  - Needs: credible, premium gift ideas that fit budget, quantity and branding requirements.

- **Retail / B2C buyers (secondary)**  
  - Roles: individual shoppers buying for relationships/occasions.  
  - Needs: simple path to a few suitable gifts and light personalization.

- **Internal sales team (later phase)**  
  - Use the same logic internally to respond faster to briefs coming from email, WhatsApp, LinkedIn, etc.

## 4. High‑Level Experience

### 4.1 Entry Points

- “Help me choose a gift” button in header / key pages.
- Corporate‑focused pages, e.g. **Corporate Gift Ideas**, **Corporate Gift Solution**, **Smart Gifts**.
- Social / campaign landings (LinkedIn, Facebook) deep‑link into a pre‑configured flow.

### 4.2 Question Flow (V1)

Approx. 6–10 steps, kept fast and mobile‑friendly:

1. **Occasion / use case** – e.g. client / VIP gift, employee recognition, event giveaway, festive, campaign launch, Smart Gift experience.
2. **Recipient type** – VIP clients, general customers, employees, C‑level, event attendees, partners, etc.
3. **Quantity** – ranges (1–10, 10–50, 50–200, 200+).
4. **Budget** – per piece or total, as ranges.
5. **Lead time** – <2 weeks, 2–4 weeks, 1–3 months, flexible.
6. **Customization level** – logo/engraving only, color/material variation, NFC / digital experience, fully custom design.
7. **Brand / style** – sliders or tags such as modern vs classic, playful vs formal, minimal vs ornate.
8. **Region / shipping** – basic region selection for practicality.

### 4.3 Results View

The results screen behaves like a mini proposal page:

- **Bucket A – Existing products**  
  Ready‑made SKUs that fit the brief (budget, quantity, occasion, style). Cards show image, short benefit line, price band, lead time, and actions (View / Add to inquiry / Add to cart for B2C).

- **Bucket B – Semi‑custom options**  
  Products that can easily be branded or modified (engraving plates, color choices, NFC programming, custom packaging). CTA: “Customize this idea” opens a short customization form.

- **Bucket C – Concept templates**  
  Idea‑level cards (e.g. custom figurines, Smart Gifts, special awards) with description, MOQ, budget band, and CTA “Request tailored proposal”.

At the bottom:

- A **“Your brief”** summary (all answers displayed clearly).  
- Lead form to email the proposal summary to the user (and to Crystocraft) and optionally upload logo or brand guideline.

## 5. Content & Data Sources

The selector is a thin decision layer on top of structured content:

1. **Product catalogue (WooCommerce)**  
   - Product ID, name, URL, main image, base price/price band.  
   - Extended metadata via tags/attributes:  
     - Occasion tags (Christmas, employee award, wedding, religious, etc.).  
     - Recipient tags (for her, for him, couple, baby, VIP, staff).  
     - Business suitability (corporate‑ready, VIP award, mass giveaway).  
     - Budget band; quantity suitability; lead‑time band.  
     - Customization flags: engraving options, color variations, NFC compatible, logo placement, packaging options.  
     - Stock vs made‑to‑order indicator (even if approximate/manual).

2. **Blog posts & landing pages**  
   - E.g. seasonal gift guides, corporate gift solution pages, Smart Gift / NFC articles.  
   - For each article: title, URL, hero image, short abstract, key tags (occasion, industry, theme), and related products.

3. **Internal “concept templates”**  
   - Non‑SKU concepts Crystocraft wants to sell (custom figurines, Smart Gifts, crystal awards, VIP collectibles).  
   - Fields per template:  
     - Name, short 1–2 sentence description.  
     - Applicable occasions and recipient types.  
     - Budget band and typical quantity range.  
     - Production complexity and lead‑time band.  
     - Recommended base materials/SKUs and example images.  
   - Shown only as idea cards, not direct e‑commerce items.

## 6. Matching Logic (V1)

### 6.1 Rules‑based Engine

- Each product and concept template has a set of tags (occasion, recipient, budget band, lead time, customization level, style, etc.).
- User answers are converted into matching tags and constraints.  
- Scoring rules (examples):  
  - +X for matching occasion/use case.  
  - +Y for matching budget band.  
  - +Z for matching customization level.  
  - Penalties for incompatible lead time, MOQ, or budget.
- For each bucket (existing, semi‑custom, concept), return top N scored items.

### 6.2 Future Enhancements

- Semantic search / vector embeddings across product descriptions, blog abstracts, and concept templates to find similar ideas based on the full free‑text brief.
- LLM‑generated proposal text that explains why specific ideas were chosen and how they could be customized.

## 7. Data Model (High Level)

Core entities (for discussion with devs):

- **Product**  
  - `external_id` (Woo ID)  
  - `name`  
  - `url`  
  - `image_url`  
  - `base_price_min`, `base_price_max` (or bands)  
  - flags: `is_corporate_ready`, `has_nfc`, `has_engraving`, etc.

- **ProductTag**  
  - `product_id`  
  - `tag_type` (occasion, recipient, style, budget_band, use_case, region, etc.)  
  - `tag_value`

- **InspirationArticle**  
  - `id`  
  - `title`  
  - `url`  
  - `image_url`  
  - `abstract`  
  - `tags` (occasion, industry, theme)

- **ConceptTemplate**  
  - `id`  
  - `name`  
  - `description`  
  - `budget_band`  
  - `min_qty`, `max_qty`  
  - `lead_time_band`  
  - `tags`  
  - `example_product_ids` (optional array)

- **Interaction / Lead**  
  - `id`  
  - `created_at`  
  - `source` (organic, LinkedIn, Facebook, QR, etc.)  
  - `brief_json` (all question answers)  
  - `selected_item_ids` (products and templates the user liked)  
  - `contact` (name, email, phone, company, region)  
  - status fields for sales follow‑up.

## 8. Technical Approach (Draft)

- **Frontend**  
  - Next.js/React app for the quiz + results UI, embedded into Crystocraft.com via iframe or script widget.  
  - Responsive, mobile‑first; supports deep‑linking with prefilled answers.

- **Backend**  
  - Node.js/TypeScript service (e.g. Express / NestJS).  
  - PostgreSQL (or MySQL) database for products metadata, tags, concept templates, and interactions.  
  - Integration with WooCommerce / WordPress API to sync product base data and URLs.  
  - Optional: vector store + LLM API for future semantic search and proposal generation.

- **Admin**  
  - Simple protected interface for:  
    - Managing tags and concept templates.  
    - Viewing leads and their briefs.  
    - Marking feature ideas for specific campaigns (e.g. Christmas, Chinese New Year, bank/insurance verticals).

## 9. Scope for V1

- Single, B2B‑oriented flow (corporate buyers) as the primary focus.  
- Rules‑based matching only (no AI yet, but data model ready for it).  
- Limited, curated catalogue: start with ~50–100 key products plus 10–20 concept templates.  
- Basic lead capture with email notifications and CSV export / CRM integration.  
- Analytics: track completions, drop‑off per question, and which suggestions users click.

## 10. Future Phases (Outline)

- Add a simplified B2C flow (relationship‑based gift selector) using the same engine.  
- Introduce semantic search and LLM‑written mini proposals.  
- Build an internal “cockpit” for sales to paste in briefs and get instant option suggestions.  
- Deeper CRM integration and A/B testing of question flows and content.

