# B0016 end-to-end setup — prepared for one owner approval

Status: production remains read/dry-run only. Nothing created, renamed,
published or approved by these preparations. Original dirty checkout preserved.

## Exact scope

- One Figurine design `mcp_range_70a2cc0a0ba82d0e75206c989d28800e`,
  `active:false`, `status:concept`, six exact B0016-000-G variants:
  BK, BL, C1, MT, PE and VL. All selling-price fields stay null.
- Shared metal `FM-B0016BY00-G`, RMB 11.30, MOQ 500. RMB 2,912 sample/mould
  fee belongs only to this shared component/quote; its component cost mirror
  is the same cost, not a second charge. No screws.
- Matching fabric `FM-CF003-BK/BL/C1/MT/PE/VL`, RMB 9 working cost,
  original RMB 8.10 retained in structured source-price fields and notes,
  MOQ 100 per colour. Exact supplier colour coverage stays marked pending.
- Six new component records and safe in-place rename/reuse of existing
  `rc_mv7xu3mmayc5g` from `P-CF003-C1` to `FM-CF003-C1`. Preserve its ID,
  name, notes, images, updated timestamp and all unrelated fields.
- Seven preferred supplier quotes; source Corporate Gift concept and its
  HKD 62 price are not edited or transferred.
- Six durable SKU claims, two immutable service-attributed audit records,
  and two private expiring owner approval controls. Customer-readable range
  holds references only, never supplier prices or internal notes.
- Design commit: 8 operations. Atomic colour BOM commit: 16 operations.
  BOM failure leaves all its components/quotes/C1 rename unchanged. If the
  design phase has already succeeded, resume its same UUID, never recreate.

## Fresh checks

33 unit/MCP tests, 183 emulator assertions (165 existing + 18 exact release),
12 seeded mobile/desktop browser checks, production build and no-undef lint
pass. Candidate rule tests use local emulators only, never production writes.

293 designs and 840 components checked. No target-SKU or FM-code conflicts.
Projected downstream usage audit found zero C1 references, child collections,
stock/reservations, costs or supplier assignments. Audit limitations: no
external ERP/offline spreadsheets or free-text communications scanned.
Repeat the audit immediately before the approved write.

The supplied B/000/G and missing BK/MT taxonomy entries remain review warnings.
No global taxonomy entries or colour availability will be invented. The owner
has expressly requested the six supplied codes; pending supplier coverage is
retained as evidence status, not promoted to confirmation.

## Narrow release

`scripts/b0016-release-rules.mjs` generates a candidate rules file without
editing or deploying the currently hard-false production gate. Candidate
permissions require an owner-controlled, expiring `b0016_setup_release`, exact
design payload/range ID, design audit and six claims. The BOM also requires its
existing exact typed approval and fresh zero-reference/zero-conflict C1 audit.
The old two-component write clauses are removed from the candidate release.

Candidate endpoint helper `netlify/edge-functions/lib/b0016SetupRelease.js`
enables only the exact design UUID and exact BOM UUID/range/hash listed in the
private control. Missing, revoked, expired or mismatched controls fail closed;
legacy two-component create remains denied. The active endpoint is unchanged.

Private controls can only be provisioned by the reviewed owner-only script
`scripts/provision-b0016-setup-approval.mjs`, after explicit approval with both
reviewed hashes. Its default is dry-run and it never writes catalogue data.
It writes only two allow-listed private approval paths and closes both after
successful verification (or on failure). No Admin/module grant to MCP.

Design UUID: `6939c061-6bb8-4c45-a9c0-3b063916d159`.
Design hash: `66d319d2fcd27b9f62d062c05f0465991386fe93acf12a296c2be78341dba7ea`.
BOM UUID: `bb6eb474-882d-4c4e-9e5e-daf5ca1b7a2a`.
BOM hash: `7d4b3b36dd256aa42367c221a80cdc2b9cb7af5dcdaa7879b3e45eaad07cac28`.
Plan revision v3 explicitly retains the original supplier price in notes.

## One approval, then execution

1. Obtain owner's combined release/live-write approval for this exact scope.
2. Promote reviewed candidate rules and approval-bound endpoint; deploy rules
   first, then application. Commit/push only this isolated approved release.
3. Refresh live checks and provision 30-minute owner controls. Validate typed
   timestamps, exact C1 before snapshot and full-precision update precondition.
4. Create design using the dedicated MCP service and the fixed UUID.
5. Run live colour dry-run for its actual ID. Match the reviewed hash and
   exact fields; refresh the BOM owner approval if timestamps require it.
6. Commit the atomic seven-component BOM through the same scoped service.
7. `scripts/verify-b0016-setup.mjs` re-reads all six variants, seven components,
   seven quotes, claims, audits and unchanged Corporate Gift source. Check
   each variant selects shared metal plus exactly its matching fabric.
8. Verify idempotent retry IDs while the window is open, then revoke both
   controls. Confirm subsequent creates are disabled and report the edit URL.

These are prototype Security Rules designed around narrow identity and exact
owner plans; emulator coverage is not a proof against every possible attack.
They must be reviewed and verified before wider use.
