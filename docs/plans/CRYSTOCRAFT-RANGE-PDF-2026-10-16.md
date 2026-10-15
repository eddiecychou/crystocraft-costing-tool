# Crystocraft Range PDF naming follow-up — 16 October 2026

Owner requested checking the catalogue PDF export and updating remaining Figurine Gifts references.

## Result — local implementation verified, not deployed

The full-range PDF cover still read `Figurine Range`, despite the earlier navigation rename. Updated it to `Crystocraft Range`, together with PDF document metadata, download filename prefix and export dialog title. Quote picker/item/error labels formerly using `Gift Range`, supplier component quote heading, component-library help and Woo catalogue matching label now use the same catalogue name; translated wording and corresponding smoke locators/current reference docs were updated. Historical release records retain their original wording.

No remaining `Figurine Gifts` references in application source, QA, current skill/reference docs or MCP docs. Internal routes, modules and collections unchanged; no existing live record snapshots rewritten.

Validation:
- Production build and all 115 existing regression tests passed, zero failures.
- No-undefined lint and whitespace checks passed.
- Real `RangeCataloguePDF` renderer produced a three-page A4 fixture. Metadata title is `Crystocraft Range Catalogue — Catalogue QA sample`; extracted text contains `Crystocraft Range` and neither `Figurine Gifts` nor `Figurine Range`.
- Cover and content pages visually checked for layout. QA fixture explicitly labelled as a layout sample, not a price quotation.
- Sample: `output/pdf/Crystocraft Range - catalogue sample.pdf` (ignored output).

This follow-up is local only. No push or production deployment performed; the preceding rename release remains the last verified production version.
