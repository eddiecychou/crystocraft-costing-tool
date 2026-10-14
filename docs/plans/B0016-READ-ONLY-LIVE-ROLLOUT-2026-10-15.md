# B0016 read-only live MCP rollout — 15 October 2026

Owner authorized dedicated identity, narrow read rules, endpoint deployment and
Codex registration only. No C1 rename, catalogue records, approvals or prices.

## Released state

- Application source: `f3bd129106c902d985236ad00bf2be29a0651cf4`.
- Netlify production deploy: `6acf8f15ec697b4273e5642a`, ready, CLI deploy.
  Its API `commit_ref` is null; source attribution is the isolated worktree
  HEAD, not a Git-build metadata assertion. Only rules/tests/docs changed
  locally after that commit; app code remains identical to it.
- Remote Git build `6acf8ec2d45ba459c03d46da` failed; the local production
  build and complete app/edge-function upload succeeded. A subsequent main
  deployment can replace the manual app snapshot. No Git push occurred.
- Firestore-only rules compiled, uploaded and released; Storage unchanged.
  `b0016WritesApproved()` stays false. In addition to the approved narrow
  B0016 reads, the service is excluded from generic staff audit appends and
  self-profile/customer-self-service writes. These extra rule changes and
  six regression checks are included in the follow-up read-only hardening
  commit requested by the owner on 15 October. No write gate is enabled.
- Firebase Auth UID: `mcp-figurine-range-service`; staff profile has
  `modules:[]`, scope `figurine-range-b0016`, internal service identity.
  No general Firestore Admin IAM role or broad OC modules were granted.
  Existing local owner signing credentials are reused by the auth helper;
  the scoped service's ID token, not an Admin credential, reaches the endpoint
  and Firestore REST API. The owner credential remains privileged and local.
- Codex server name: `oc_figurine_range`.
- Active entrypoint:
  `/Users/eddie/.codex/mcp-runtime/b0016-f3bd1291/mcp/figurine-range/server.mjs`.
  Runtime has persistent installed dependencies, outside the dirty checkout.
  Existing `oc_product_writer` registration was preserved.
- Endpoint: `https://portal.crystocraft.com/api/mcp-figurine-range`.
  Endpoint hardcodes `writesEnabled:false` regardless of environment flags.

## Verification

- 29 unit/MCP tests, all pass.
- 165 emulator assertions: 82 base RBAC, 31 phase-one boundary, 8 older
  candidate integrity, 44 FM bundle/rename integrity; all pass.
- Production build and edge-function bundling pass.
- Fresh stdio MCP process starts and `tools/list` returns eight tools:
  `search_range_designs`, `get_range_design`, `prepare_mezuzah_range_design`,
  `prepare_mezuzah_range_components`, `prepare_mezuzah_colour_bom`, and the
  three `create_mezuzah_*` tools (advertised but hard-disabled).
- Harmless live `search_range_designs` returns zero B0016 designs.
- Actual live `prepare_mezuzah_colour_bom` via dedicated identity succeeds:
  `dry_run:true`, `will_write:false`, `live_writes_enabled:false`.
- Untargeted create rejection probe returns HTTP 403 `WRITES_DISABLED`;
  no valid target was supplied, and the gate precedes component access.
- Direct scoped-token reads deny component list, unrelated component,
  unrelated supplier, unfiltered range list and C1 movements, all HTTP 403.
- C1 remains `P-CF003-C1`, update time `2026-10-14T10:01:39.447097Z`.
- Separate owner read-only usage audit: zero downstream references, zero
  exact FM code conflicts, no C1 child collections. Projected operational
  fields only; external ERP/offline references not covered. No certification
  or approval document was written. Repeat before any future migration.

## Exact live dry run

Shared metal: `FM-B0016BY00-G`. Fabric mapping:

| Finished item | Fabric component |
|---|---|
| B0016-000-GBK | FM-CF003-BK |
| B0016-000-GBL | FM-CF003-BL |
| B0016-000-GC1 | FM-CF003-C1 |
| B0016-000-GMT | FM-CF003-MT |
| B0016-000-GPE | FM-CF003-PE |
| B0016-000-GVL | FM-CF003-VL |

Future proposal only: six new components, one existing C1 reused/renamed in
place after approval, seven new quotes, BOM-only range update and audit —
16 operations. Actual range ID must exist before any future approved bundle.

Feihong RMB 11.30 metal case, MOQ 500; RMB 2,912 shared one-time fee.
Ryan RMB 8.10 source price / RMB 9.00 conservative working cost, MOQ 100
per colour. Supplier exact-colour coverage remains pending. No screws,
finished-product selling price or corporate HKD 62 transfer.

Request UUID: `bb6eb474-882d-4c4e-9e5e-daf5ca1b7a2a`.
Plan hash: `6501aaff9dec64caf17d4376cafacf72f93061fb1ed684767196c787cacadaf2`.
Blocked for live writes; taxonomy/colour/supplier and privileged legacy-audit
warnings remain visible. No warnings were treated as permission to create.

Evidence: [live dry run](B0016-LIVE-FM-DRY-RUN-2026-10-15.json),
[read-only usage audit](B0016-LIVE-ROLLOUT-USAGE-AUDIT-2026-10-15.json).
Reload/restart Codex to refresh this running session's tool inventory; a
fresh standalone SDK process already verified the registered entrypoint.
