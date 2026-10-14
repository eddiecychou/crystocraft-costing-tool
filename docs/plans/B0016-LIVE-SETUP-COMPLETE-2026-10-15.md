# B0016 Crystal Fabric Mezuzah Case — live setup complete

Owner approved the combined scoped release and live setup in chat on
15 October 2026 (Australia/Sydney). No additional decisions were required.

## Result

- One Figurine range design:
  `mcp_range_70a2cc0a0ba82d0e75206c989d28800e`.
- Edit URL: https://portal.crystocraft.com/range/mcp_range_70a2cc0a0ba82d0e75206c989d28800e
- Name: `CRYSTAL FABRIC MEZUZAH CASE`.
- Six variants, seven component records, seven preferred supplier quotes.
- `active:false`, `status:concept`; all variant selling prices null.
- No screws, price publishing, global taxonomy changes or additional Corp Gift.

| Variant | Shared metal | Matching fabric |
|---|---|---|
| B0016-000-GBK | FM-B0016BY00-G | FM-CF003-BK |
| B0016-000-GBL | FM-B0016BY00-G | FM-CF003-BL |
| B0016-000-GC1 | FM-B0016BY00-G | FM-CF003-C1 |
| B0016-000-GMT | FM-B0016BY00-G | FM-CF003-MT |
| B0016-000-GPE | FM-B0016BY00-G | FM-CF003-PE |
| B0016-000-GVL | FM-B0016BY00-G | FM-CF003-VL |

C1 renamed in place from `P-CF003-C1` to `FM-CF003-C1`, keeping ID
`rc_mv7xu3mmayc5g`. Its name, notes, images, existing updated timestamp and
all unrelated fields were preserved. Six other component records are new.
Fresh projected operational-reference and code audit found no C1 references,
FM-code conflicts, target SKU conflicts, C1 child records or stock/reservations.
Audit does not cover external ERP/offline spreadsheets/free-text comms.

Metal: Feihong RMB 11.30 per piece, MOQ 500, one-time RMB 2,912 sample/mould
fee on the shared metal quote only. The component mirrors the same cost for
the engine; it is not a second charge and is not multiplied across colours.
Fabric: Ryan RMB 9.00 conservative working cost, RMB 8.10 original price in
both source-price fields and notes, MOQ 100 per colour. Exact supplier colour
coverage remains `pending`, not falsely confirmed. Assembly/packaging unresolved.

Corporate Gift source `mcp_a844ebe21ba90961027c05752f5a8554c7a7d4bd` remains
unchanged, inactive Concept; its stored updateTime matched the before snapshot.
Its HKD 62 price was not transferred to the Figurine design.

## Release and safety

- Release commit `310c0157`, pushed to main.
- Firestore-only exact-owner-control rules compiled/uploaded/released first.
  No Storage deployment and no Admin/module grant to the service.
- Netlify deploy `6acf98da6f586be54696e38a`, ready, CLI production snapshot.
  API commit_ref is null; source attribution is the isolated release checkout.
- Local registration remains `oc_figurine_range` at persistent entrypoint
  `/Users/eddie/.codex/mcp-runtime/b0016-f3bd1291/mcp/figurine-range/server.mjs`.
  Tool definitions updated to release source; folder suffix is historical.
- Default/missing/revoked/expired owner controls deny writes; no env switch.
- Opened only two 30-minute exact private controls, executed fixed UUIDs,
  then set both `approved:false` after successful verification.
- Live closed-window probe returned `WRITES_DISABLED` before any catalogue
  read/write. The legacy two-component writer remains disabled.
- The source dirty checkout was not modified, pulled, rebased, merged or reset.

Design UUID: `6939c061-6bb8-4c45-a9c0-3b063916d159`.
Design audit:
`range_mcp_audit/mcp_range_70a2cc0a0ba82d0e75206c989d28800e3e19e2a5a19242e708d714164d7d3d48`.
BOM UUID: `bb6eb474-882d-4c4e-9e5e-daf5ca1b7a2a`.
BOM audit:
`range_mcp_audit/mcp_range_f26fdfa69e4012b78e8386914945bb59d9395d7dea74ad05e8cc9b30c38446b5`.
Both audits identify `service_principal:mcp-figurine-range-service` and
`requested_by:unknown`; they do not claim a human identity.

## Verification evidence

- 33 unit/MCP tests passed.
- 183 emulator assertions passed: 82 base RBAC +31 service boundary,
  8 historical two-component candidate +44 historical FM candidate,
  18 exact owner-control release. Historical fixtures are explicitly separate
  from production rules; exact release and base/boundary suites use release rules.
- 12 seeded browser checks at 375/1280px; lint and production build passed.
- Actual MCP startup/tools-list returned eight tools; deployed v3 read-only
  preflight passed before owner controls were opened.
- Live design create returned `created:true`; atomic BOM create returned
  `created:true` and all seven component/quote IDs.
- Dedicated scoped-token verifier re-read every variant, component, quote,
  SKU claim and both audits. Each variant selects exactly two components.
  It also verified supplier source notes, one shared fee, C1 preservation,
  no public cost fields, null selling prices and unchanged Corporate source.
- Same UUID requests returned `created:false`, `already_exists:true`, same
  range/component/quote/audit IDs. No duplicate records were created.
- After control revocation, the exact BOM request returned `WRITES_DISABLED`.

See [live post-read verification](B0016-LIVE-SETUP-VERIFICATION-2026-10-15.json)
and [closed write-window evidence](B0016-WRITE-WINDOW-CLOSED-2026-10-15.json).
Read the completed design with `get_range_design`; the preparation tool is
a pre-create proposal, not a general update or rename endpoint.
