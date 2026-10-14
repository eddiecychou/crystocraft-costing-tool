# B0016 corrected FM component codes — revised dry-run review

Status: **local preparation only, awaiting owner approval**. No component code
was changed, no records or private approvals created, no rules deployed, no
prices calculated/published, and no commit/push/deployment performed this turn.
Work remains isolated in `/private/tmp/costing-b0016-colour-bom`, based on the
main integration commit `6361a503`; original dirty checkout is untouched.

This supersedes the earlier P-code proposal, not the existing catalogue data.
The existing v1 writer and manifest must remain disabled; the revised local
plan is not connected to a live write operation. Endpoint `writesEnabled:false`
and Firestore `b0016WritesApproved()==false` remain unchanged.

## Required mapping

Every variant uses one shared `FM-B0016BY00-G` metal case and one matching
crystal-fabric panel. Finished SKUs are unchanged:

| SKU | Fabric component | Proposed action after approval |
|---|---|---|
| B0016-000-GBK | FM-CF003-BK | Create new component |
| B0016-000-GBL | FM-CF003-BL | Create new component |
| B0016-000-GC1 | FM-CF003-C1 | Rename/reuse exact existing C1 ID |
| B0016-000-GMT | FM-CF003-MT | Create new component |
| B0016-000-GPE | FM-CF003-PE | Create new component |
| B0016-000-GVL | FM-CF003-VL | Create new component |

No CF002 change, no screws, assembly, packaging or selling-price publication.
Source Corporate Gift Concept and its HKD 62 price remain unchanged.

## Fresh live usage/conflict audit

Checked `2026-10-14T12:30:59.278Z` using the existing owner credential through
read-only projected queries. No new service permissions were granted.

- Component library: **840** records; **zero conflicts** for the shared metal
  and six exact FM-CF003 codes, including case/outer-whitespace normalization.
- **293** range designs and **141** corporate products checked; no B0016 SKU
  collision, and no B0016 range design exists yet.
- **Zero downstream references** to either old code `P-CF003-C1` or record ID
  `rc_mv7xu3mmayc5g` in the projected operational fields. The old component's
  own code field is not incorrectly counted as a downstream reference.
- C1 has no child collections: no quotes, movements or child attachments.
  Supplier is empty; preferred quote/cost/tooling/stock/reserved stock are unset;
  `used_by` is unset. There is exactly one component with the old C1 code.
- Additional reference checks: 32 POs, 122 orders, 26 quote headers, 14 packing
  lists, 81 invoices, 5 credit notes, 5 catalogues, 38 audit records; component
  library and relevant inventory/design roots; collection-group projections
  for 146 items, 1,526 lines, 230 corporate components and 405 supplier quotes.
  Complete scope/count list is saved in the JSON below.

This is not a claim about external ERP exports, offline spreadsheets, free-text
customer communications or every arbitrary field in Firestore. Projected
fields cover the current code's BOM IDs/codes, PO `linked.component_id` and
`linked_component_ids`, order reserved/issued component lines, item/line code
snapshots, component/source links and private MCP plans. Repeat immediately
before a migration: this snapshot does not lock unrelated manual edits.

## Recommended safe migration (not performed)

1. Obtain owner approval of this corrected mapping and the **in-place rename**.
   Preserve `range_components/rc_mv7xu3mmayc5g`; rename its code from
   `P-CF003-C1` to `FM-CF003-C1`. Keep name `mezuza水晶布`, notes, images,
   stock, reserved stock, creation time and any ledger history intact.
   No delete/recreate, mass prefix replacement, alias guessing or stock transfer.
2. Re-run usage/conflict/child-collection audits. If references, quotes, stock,
   reservations, usage hints or a changed C1 snapshot appear, **stop the rename**.
   Preserve the old record and return a separate FM-C1 creation proposal for
   review; never silently repoint historical PO/order/quote snapshots.
3. Update the disabled writer and narrowly scoped candidate permissions only
   after plan approval. The current C1 update whitelist does **not** permit
   `code`, so the old writer/rules cannot execute this migration. Future rules
   must permit only this exact old-to-new C1 code transition, bound to a fresh
   private typed before/after plan; keep all other C1 fields immutable.
   Do not broaden the service to supply/figurine modules or Firestore Admin.
4. After separate design-create approval, use its actual range ID and generate
   a new exact preview/hash, not the placeholder report. Keep all six exact
   variant codes, per-colour scope and source costs separate from selling prices.
5. Only after separate live-write/rules deployment approval, perform the
   idempotent atomic 16-record transaction: six new components, explicit C1
   code/cost update, seven quotes, one BOM link, one audit with old/new code.
   Use create-only + C1/range update-time preconditions; verify every field
   after write. Any failure must leave no partial bundle.

Supplier terms unchanged: Feihong RMB 11.30 metal, MOQ 500, RMB 2,912 one-time
sample/mould fee recorded once; Ryan RMB 8.10 source price, RMB 9 working cost,
MOQ 100 per colour. Supplier colour coverage, B/000 taxonomy, G plating and
missing BK/MT library entries remain review warnings; no inference from photos.

## Revised exact-plan artifact and checks

[Full revised dry-run JSON](B0016-FM-EXACT-DRY-RUN-2026-10-14.json): all component
fields, paths, seven quotes, exact BOM/variant mapping, explicit C1 old/new code,
preserved fields, audit and usage evidence. **Not write authorization.**

- Request UUID: `bb6eb474-882d-4c4e-9e5e-daf5ca1b7a2a`.
- Preview hash: `f87936b4adac2c333de1a526d3d19d639047ac8dc89c6f69b84861f1ab854bdc`.
- Counts: 6 new components + 1 reused/renamed C1; 7 quotes; 16 total planned
  record operations. Zero actual writes. A real range ID is still required.
- 27 unit/MCP tests passed (23 existing + 4 new migration-plan checks), plus
  syntax, no-undef lint and whitespace checks. New tests cover exact FM codes,
  unchanged finished SKUs, C1 preservation, corresponding BOM write payload,
  matching component/quote/audit IDs, reference detection, conflicting codes,
  fallback on usage/stock/quotes/stale snapshot and write-free preparation.
- No rules were edited, so no new claim of FM rename emulator verification:
  that future permission change remains to be implemented/tested after approval.

Read-only commands (existing owner credential path only):

```sh
SA_KEY_PATH=/path/to/existing-owner-key.json node scripts/audit-b0016-fm-migration.mjs
SA_KEY_PATH=/path/to/existing-owner-key.json node scripts/preview-b0016-colour-bom.mjs
```
