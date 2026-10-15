# B0016 Crystocraft Range MCP (isolated, review-gated)

## Latest implementation — 15 October 2026 (read/dry-run live, writes disabled)

**B0016 live setup completed and write window closed:** one inactive Concept
design, six exact variants, seven FM components and seven preferred quotes
were created through the scoped MCP under the owner's approved exact release.
C1 renamed in place with its ID/other fields preserved; source Corporate Gift
and prices unchanged. Both private controls are now revoked, and the live
endpoint rejects further create requests with `WRITES_DISABLED`. Idempotent
retries returned the original IDs. Current record, release and evidence:
[completion report](../../docs/plans/B0016-LIVE-SETUP-COMPLETE-2026-10-15.md).
This completion supersedes historical "no B0016 records" statements below.

**Owner-approved setup release:** the endpoint and rules now support only
the exact expiring private B0016 setup controls, not an environment write flag.
The older two-component writer is disabled. Default/missing/revoked controls
deny every service write; the owner-authorized setup window is closed after
verification. This supersedes historical hard-false-gate descriptions below.
33 unit/MCP, 183 emulator assertions and production build passed on the
promoted release. Current execution scope is the end-to-end approval plan.

**End-to-end release preparation:** owner requested completion of the inactive
six-SKU design and seven-component FM BOM. An approval-bound endpoint helper,
pure candidate rules generator, read-only exact-plan preparation, allow-listed
owner-control provisioner (dry-run default) and scoped read-only verifier are
prepared locally. No production gate or record changed. Source-price notes now
explicitly retain RMB 8.10 alongside RMB 9 working cost (plan revision v3).
33 unit/MCP, 183 emulator assertions and 12 seeded browser checks pass.
One combined production release/live-write approval is still required:
[exact scope and sequence](../../docs/plans/B0016-END-TO-END-APPROVAL-2026-10-15.md).

**Read-only rollout is now live (15 October):** dedicated modules-empty
identity, narrow Firestore reads, deployed endpoint and `oc_figurine_range`
Codex registration verified with an actual live FM dry run. All writes remain
hard-disabled. C1 still has its original P-code; no B0016 records or prices
were created. See [live rollout report](../../docs/plans/B0016-READ-ONLY-LIVE-ROLLOUT-2026-10-15.md)
for the exact entrypoint, deployment and 29 unit / 165 emulator checks.
Sections below describe the original pre-rollout state and historical plans;
the live rollout report supersedes their deployment status and P-code plan.

The actual prepare/create implementation now uses six exact `FM-CF003-*` codes
and explicitly reuses C1 by in-place `P-CF003-C1` → `FM-CF003-C1` rename.
Both write gates remain false. Candidate rules permit only that exact transition
in the atomic bundle, with a fresh owner usage proof (15-minute maximum age)
and private typed exact before/after approval; no general Admin/module access.
29 unit/MCP, 159 emulator and 12 seeded browser checks passed. No actual rename
or record/approval creation occurred. The v1 discussion below is historical.
See [final FM writer review](../../docs/plans/B0016-FM-WRITER-REVIEW-2026-10-15.md).

> **Owner code correction, awaiting revised-plan approval:** required fabric
> codes are `FM-CF003-BK/BL/C1/MT/PE/VL`, not the v1 P-codes below. The v1
> writer and manifest are still disabled and must NOT be enabled or replayed.
> The local revised read-only plan proposes explicit C1 code migration after
> usage/conflict audit, without granting any code-change permission.
> See [FM migration review](../../docs/plans/B0016-FM-CODE-MIGRATION-REVIEW-2026-10-14.md).

This is a **separate stdio MCP server and Firebase service identity** for the
Crystal Fabric Mezuzah Case. It does not extend the Corporate Gift writer's
permissions and does not create another `products/{id}` record. Its source is
the existing hidden concept `products/mcp_a844ebe21ba90961027c05752f5a8554c7a7d4bd`.

Current state: **read and dry-run live; writes disabled**. The edge endpoint
hard-codes `writesEnabled:false`, independent of `FIGURINE_MCP_WRITES_ENABLED`.
Do not enable writes or create catalogue records until Eddie separately approves.
Phase-one rules also hard-deny B0016 service writes. An ID token can call
Firestore directly, so the endpoint flag is not a sufficient security gate.

## Colour-specific B0016 update — 14 October 2026

Use the new read-only `prepare_mezuzah_colour_bom` tool with `request_id`
(UUID) and `dry_run:true`. `range_id` is optional before design creation.
It fixes the owner-reviewed metal code to `FM-B0016BY00-G` and fabric codes
to `P-CF003-BK/BL/C1/MT/PE/VL`. CF002 belongs to the poppy crystal-fabric
flower and is never renamed or reused here. Existing C1 is the exact
`range_components/rc_mv7xu3mmayc5g` record; preparation rejects a changed code,
assigned supplier/cost/preferred quote or existing child quote instead of
silently overwriting it.

The preview proposes six new components, reuse of C1, seven supplier quotes,
seven narrow BOM refs and an audit. C1's name, images, notes, stock, reserved
stock and ledger remain intact. Its proposed future write is only a reviewed
cost/preferred-quote mirror with an update-time precondition. Quote records
retain source provenance; RMB 8.10 source and RMB 9 working cost stay separate.
The one-time RMB 2,912 metal fee is shared, not copied to fabric colours.

`critical_components[].crystal_code` scopes a ref to exactly one colour.
`all_variants` overrides plating only, never an explicit colour. Costing,
MRP/reservation requirements, buildable stock and lead estimates use this
same predicate; RangeForm preserves the field on load/save. Stock allocation
consumes the shared pool once. Legacy uncoloured BOM behaviour stays unchanged.
B0016's costing screen displays separate component subtotals and deliberately
blocks finished-product selling-price calculation/publication while assembly
and packaging are unresolved.

**Still disabled in production:** the seven-component atomic/idempotent writer
and narrow candidate permissions are implemented and emulator-tested locally.
The checked-in Firestore gate stays false and endpoint configuration stays off.
The legacy two-component create rejects these B0016/CF003 codes, even if its
write flag is enabled. No creation shortcut or Admin SDK writer is supplied.
The writer requires actual range ID, same UUID, exact approved preview hash,
explicit approval and pending-colour acknowledgement. A private admin-approved
exact plan with expiry binds all component/quote fields and the complete C1
before snapshot. MCP can get its plan but cannot list/create/update approvals.
All 16 records commit together and are re-read; successful timeout retries
return original IDs, mismatched or incomplete requests fail closed.

The sole additional direct Firestore scope is read access to the exact C1
record while its code is `P-CF003-C1`, plus its quote subcollection for
deduplication. No component collection list, other supplier costs, stock
movements or writes are granted. Read-only scans of all legacy codes use
`scripts/preview-b0016-colour-bom.mjs` with the existing owner credential;
this is a local read bridge, not a deployed scoped-service/RBAC test.

Latest live review: 293 range designs, 840 components, no B0016 SKU conflicts,
six proposed new codes unused and C1 present with no quotes/supplier/cost.
Taxonomy (`B`, `000`, `G`, missing BK/MT library entries) and Ryan's exact
colour coverage remain explicit review warnings, not invented facts.

Tests: 23 unit/MCP tests; 82 base RBAC + 25 phase-one scope + 8 existing
candidate-integrity + 30 seven-component/approval emulator checks (145 total).
Candidate tests enable the gate only in emulator memory, never production.
The new `qa/b0016-costing-smoke.mjs` passed 12 seeded desktop/mobile UI
checks (375/1280px): six subtotals, no selling-price table, publish disabled,
zero writes/errors and no body overflow. Production build/no-undef lint passed.
No original dirty checkout was edited; changes are isolated in
`codex/b0016-colour-bom`.

## Direct Firestore scope and remaining audit

The B0016 identity can read only `range_products` whose `design_no` is `0016`;
the MCP uses a `design_no == '0016'` server query. An unfiltered list is denied.
It can get only its own `mcp_b0016_*` range components and quotes, exact C1, the six exact
SKU claim IDs, the two named suppliers, the exact source concept/components/
quotes, and `settings/crystal_colors`. It cannot list `range_components`,
supplier quotes other than exact C1, SKU claims, approvals or audit records. It cannot read unrelated
supplier costs. A B0016 product is customer-readable by direct ID regardless
of `active:false`; do not put costs there.

This means the scoped token cannot prove that a legacy design with a different
design number reuses one of the six codes, or that a proposed component code
already exists in an unrelated cost record. Dry-runs report
`LEGACY_SKU_AUDIT_REQUIRED` / `LEGACY_COMPONENT_CODE_AUDIT_REQUIRED`, and live
create fails closed until a separately authorized audit is certified in the
server configuration. The current endpoint does not set that certification.
An admin/figurine or supply operator must audit those legacy code collisions
outside this identity before any phase-two write authorization. Existing
orphaned or mismatched six-code claims block the design preview and retry;
mismatched BOM references block component retry. No automatic repair occurs.

The read-only audit command is `SA_KEY_PATH=/path/to/owner-key.json node
scripts/audit-b0016-range-codes.mjs` (add `--metal-code=... --fabric-code=...`
after the owner selects those codes). It checks all existing Figurine designs,
all component codes, and the six exact claim documents. It prints counts and
conflicting IDs, never supplier costs, and does not write an attestation or
modify catalogue data. A 2026-10-14 read found 293 designs, 839 components,
zero six-code claims and zero B0016 SKU collisions; component codes were not
yet provided, so component collision clearance is still pending. This is a
snapshot, not a race-proof guarantee against later manual catalogue edits.

## Tool manifest

| Tool | Effect |
|---|---|
| `search_range_designs` | Read-only B0016 name/number or exact-code lookup |
| `get_range_design` | Read-only B0016 design summary |
| `prepare_mezuzah_range_design` | Dry-run exact six-code check and planned range/claim/audit fields |
| `create_mezuzah_range_design` | Owner-approved, atomic inactive Concept design + six code claims + audit |
| `prepare_mezuzah_range_components` | Dry-run source quotes, six planned records and required separate legacy-code audit |
| `prepare_mezuzah_colour_bom` | Dry-run seven-ref CF003 BOM, exact C1 reuse, source terms, record actions and review warnings |
| `create_mezuzah_colour_bom` | Disabled pending separate release; atomic exact-plan seven-component create/reuse/quote/BOM/audit |
| `create_mezuzah_range_components` | Owner-approved, atomic two range components, two quotes, BOM link and audit |

The six codes are exactly `B0016-000-GBK`, `-GBL`, `-GC1`, `-GMT`, `-GPE`,
and `-GVL` (full `B0016-000-G` prefix for each). `B`, `000`, and `G` remain
review warnings because the first two are unnamed in the taxonomies and `G`
means Gold even if a reference image appears different. Missing colour-library
codes also warn. The create tool requires explicit acknowledgement of the
warning codes; it never rewrites the SKUs, infers plating from an image, or edits
the global taxonomies.

The range product stores no supplier costs, notes, source quote, or selling
price. `active:false` omits it from the shop list but is **not confidentiality**:
approved customers may read its Firestore document by direct ID. Supplier terms
remain in `range_components` and `supplier_quotes`, which are not customer
readable. Preferred quote amounts are mirrored on component records for
`rangeCosting.js`; this is one economic cost, not two billable line items.
Each initial variant stores only `brand_code`, `plating_code`, `crystal_code`,
the exact `sku`, and `ws_price_usd:null`. The existing `RangeForm` hydrates
omitted optional display fields when opened. The compact, exact map is also
what lets the six-variant Firestore rule stay within its evaluation budget;
the candidate-rule emulator rejects an injected supplier-cost field.

The Feihong metal case is RMB 11.30/piece, MOQ 500; the RMB 2,912 one-time
sample/mould fee is attached to that metal component only. M3 screws are
excluded. Ryan's panel was quoted at RMB 8.10; the owner-selected conservative
working unit cost is RMB 9.00, MOQ 100 **per colour**. Assembly and packaging
are unresolved. Neither tool computes or publishes a finished-product price;
the Corporate Gift concept's HKD 62 is intentionally not copied.

## Idempotency, audit, and approval

Future create requests require a UUID, `approved:true`, `dry_run:false`, and matching
acknowledgements. The UUID and canonical payload hash determine the record IDs.
One Firestore REST `commit` uses create-only preconditions for all new records
and an update-time precondition for the BOM link; a failure leaves no partial
records. Retrying the same UUID and payload returns the original IDs. Reusing
that UUID with changed content fails. Both operations write an append-only
`range_mcp_audit` record with `service_principal:mcp-figurine-range-service`,
`requested_by:unknown`, source IDs, request hash and server timestamp. The
audit does not pretend to identify a human operator.

## Deployment sequence (requires a new owner approval)

1. Review the rules diff and local tests. Obtain explicit approval for the
   phase-one read-only rules; deploy rules first. Confirm a service token cannot
   write directly to Firestore.
2. With separate approval, provision the dedicated Auth user with
   `modules:[]` using `npm run provision-service`. It must not get `figurine`,
   `supply`, `products`, `pricing`, or admin.
3. Deploy the read/dry-run app endpoint, register/restart the local MCP, and
   verify `tools/list`, direct Firestore deny tests, harmless reads/dry-runs.
4. Run a privileged one-time legacy SKU and component-code collision audit;
   reconcile any claim/BOM mismatch. Review the exact dry-run proposal, code,
   colour and plating warnings, and proposed component codes.
5. Only after separate approval, provision a short-lived private exact owner
   plan for the actual range ID and fresh dry-run hash, retaining Firestore
   timestamp types in C1 snapshots. Do not create this approval during tests.
   Review/test/deploy a phase-two rules change
   replacing `b0016WritesApproved() == false`, then enable the server-side
   legacy audit certification and change the hard-disabled endpoint in a
   separately approved code release. Environment changes alone cannot enable
   this release. Re-run the RBAC
   emulator and live dry-run before any actual create. Never create B0016
   during a smoke test.

After deployment, the Codex MCP registration is a separate local config step:

```toml
[mcp_servers.oc_figurine_range]
command = "node"
args = ["/Users/eddie/Developer/costing-tool/mcp/figurine-range/server.mjs"]
env_vars = ["OC_FIREBASE_API_KEY", "OC_BASE_URL", "OC_FIREBASE_PROJECT_ID"]
```

The isolated worktree can run `node --test mcp/figurine-range/*.test.mjs`.
These tests use a fake Firestore transport and make **no production writes**.
The phase-one emulator suite is `qa/rbac-rules.test.mjs` plus
`qa/figurine-range-rules.test.mjs`. A separate
`qa/figurine-range-candidate-rules.test.mjs` flips the B0016 write gate **only
in memory inside the emulator** to test future transaction integrity. It is
not a deployable rules variant; the checked-in rule remains `return false`.
