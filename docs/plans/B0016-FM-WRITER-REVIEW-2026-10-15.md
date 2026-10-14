# B0016 FM writer and narrow rename permissions — final review

**Local implementation and smoke tests complete; live writes disabled.**
No records, approvals or identities were created, C1 was not renamed, no prices
were calculated/published, and no push or deployment was performed. Work stays
in `/private/tmp/costing-b0016-colour-bom`, branch `codex/b0016-colour-bom`,
based on `6361a503`; the original dirty OC checkout remains untouched.

Subsequent owner approval authorizes commit/push of this implementation only.
It explicitly excludes rule deployment, actual C1 rename, B0016 record/approval
creation and price publication. Both write gates stay false on main; this
approval is not authorization to execute the dry run.

## Exact dry-run mapping

| Exact finished SKU | Fabric component | Proposed action, only after live approval |
|---|---|---|
| B0016-000-GBK | FM-CF003-BK | New |
| B0016-000-GBL | FM-CF003-BL | New |
| B0016-000-GC1 | FM-CF003-C1 | Rename/reuse `rc_mv7xu3mmayc5g` |
| B0016-000-GMT | FM-CF003-MT | New |
| B0016-000-GPE | FM-CF003-PE | New |
| B0016-000-GVL | FM-CF003-VL | New |

Every variant uses shared metal `FM-B0016BY00-G` plus one matching panel.
One future atomic transaction contains **16 operations**: six new components,
the C1 code/cost update, seven quotes, the BOM link and append-only audit.
No screws, duplicate Corporate Gift product, finished selling price, assembly
or packaging assumptions. The existing source Concept and its HKD 62 price
remain untouched.

Supplier terms retained: metal RMB 11.30, MOQ 500, RMB 2,912 sample/mould fee
recorded once; fabric source RMB 8.10 distinct from conservative working RMB 9,
MOQ 100 per colour. Supplier colour coverage and B/000/G/BK/MT taxonomy warnings
remain visible; no photo-based plating or specification inference.

## Writer behavior

`prepare_mezuzah_colour_bom` now emits the corrected FM proposal directly,
including old/new C1 code and preservation fields. The former P-code preview
and its hash are obsolete. `create_mezuzah_colour_bom` remains disabled at the
release entrypoint and requires a future explicitly approved actual range ID,
UUID/hash, pending-colour acknowledgement and private exact owner plan.

The existing C1 ID, name, photos, notes, zero/unset inventory, creation time and
ledger are preserved; only the explicit code and approved supplier-cost mirror
plus operation metadata are updated. Initial preparation rejects changed code,
assigned costs/quote, stock, reservation or usage hints. It does not silently
switch to a new C1 record. If usage appears, stop and return for owner review.

Future commit uses create-only preconditions for new documents and update-time
preconditions for C1/range. All requested fields are re-read. Same UUID/hash
retries return the original complete bundle after the rename, including a lost
success response; different content, orphaned output or corrupted quote/BOM/
audit fails closed. Source/provenance records are read only.

## Narrow permission delta

[Exact rules diff](B0016-FM-PERMISSIONS-2026-10-15.diff).

- Existing identity stays staff + `modules:[]`, fixed UID/custom claim/scope.
  No admin, supply or general figurine module grant.
- Exact C1 reads now accept its old P-code or approved FM-code state, including
  child quote reads, so retry verification works after rename. No list-all
  components, suppliers, audits or approvals is granted.
- Candidate creates accept only the shared metal and five non-C1 FM panel
  codes with their matching deterministic ID suffixes; no new FM C1 is allowed.
- C1 candidate update accepts only exact ID `rc_mv7xu3mmayc5g`, old code
  `P-CF003-C1`, new code `FM-CF003-C1`, matching immutable owner plan and
  explicit old/new code audit. No other code transition or descriptor/stock edit.
- The private admin-approved exact plan must include a zero-reference,
  zero-code-conflict, zero-child-record attestation checked within **15 minutes**.
  Endpoint also compares its C1 updateTime with the current record. Rules match
  the complete typed C1 before snapshot, require no existing cost/supplier/stock/
  reservation/usage hint, and preserve all non-allowlisted fields.
- Complete quote/component/BOM/audit reciprocity remains mandatory. Standalone
  rename, missing records/audit, changed owner fields or repeat writes fail.
- Legacy two-component writer cannot bypass the FM/P-CF003 workflow.
- Both `b0016WritesApproved()==false` and endpoint `writesEnabled:false` remain
  unchanged. Even an environment toggle or `approved:true` cannot enable writes.

Approval provisioning is an explicit owner/admin trust boundary, not a tool the
service can call. Global legacy references/uniqueness and unknown C1 child-record
absence are verified by the projected owner audit, not by granting broad reads
to the MCP identity. Concurrent unrelated manual edits are not globally locked:
repeat the audit immediately before any separately approved operation.

## Verification

- **29 unit/MCP tests**, including real local tools/list startup (8 scoped tools),
  FM mappings, explicit rename, UUID/hash retry, lost-response recovery, atomic
  rejection, stale/missing/nonzero usage proof, C1 preservation and old-hash denial.
- **159 Java-backed emulator checks**: 82 base RBAC, 25 phase-one read/deny,
  8 prior candidate-integrity, 44 FM bundle/rename/approval checks. The valid FM
  transaction passes only with the false gate flipped in emulator memory;
  checked-in rules reject it. Wrong old/target codes, standalone rename,
  reservations, stock, hints, stale proofs, missing links/audit and customer cost
  access are rejected. No production emulator credentials were used.
- **12 browser checks** at 375/1280px with FM-coded seeded data: per-colour
  subtotals, publication disabled, no finished-price table, no writes, overflow
  or runtime errors. No live customer session/data was modified.
- No-undef lint, production build and whitespace checks passed. The build's
  existing large-chunk advisory remains unrelated.
- Fresh live read-only owner bridge verifies 293 designs, 840 components,
  zero FM-code/SKU conflicts and zero downstream old-C1 references in the
  projected operational fields. C1 is still `P-CF003-C1`, update time
  `2026-10-14T10:01:39.447Z`, with no child records, supplier/cost or stock.
  No external ERP, offline spreadsheets or customer chat text was scanned.

[Final implemented-handler dry-run JSON](B0016-FM-WRITER-DRY-RUN-2026-10-15.json)
contains all paths/fields, scope counts, matching component/quote/BOM IDs,
explicit rename, warnings and audit preview. An actual range design does not
exist yet, so this report uses a placeholder. Regenerate the preview/hash after
any separately approved design create; this JSON is not executable approval.
Request UUID: `bb6eb474-882d-4c4e-9e5e-daf5ca1b7a2a`.
Preview hash: `6501aaff9dec64caf17d4376cafacf72f93061fb1ed684767196c787cacadaf2`.
Live usage audit timestamp: `2026-10-14T13:53:51.425Z` (15 October in Sydney).

## Security assessment

```json
{
  "score": 4,
  "summary": "Scoped local prototype passed the complete emulator suite; both production write gates remain disabled.",
  "findings": [{
    "check": "Business Logic vs. Rules",
    "severity": "minor",
    "issue": "Global code uniqueness and C1 downstream/child-record absence rely on a fresh owner-admin attestation, not a database-wide lock.",
    "recommendation": "Repeat the projected audit immediately before separately approved migration; stop if any usage, conflict or snapshot changes. Never broaden the service to Admin for this scan."
  }]
}
```

## Next release boundaries

Review this dry run and diff first. Commit/push, Firebase rule deployment,
identity/approval provisioning and live creation each still need separate
authorization. A future release remains rules-first, with a fresh typed private
approval, actual range ID/hash and narrowly approved write-gate change. Never
publish a finished-product price as part of B0016 migration.
