# B0016 final colour-BOM dry-run review

Status: local code + read-only live data verification. **Zero production writes;
no push, deployment, service provisioning or price publication.**

Worktree: `/private/tmp/costing-b0016-colour-bom`, branch
`codex/b0016-colour-bom`, base `eee91f31`. Earlier pending B0016 hardening was
copied into this isolated worktree; the original OC checkout and earlier
Figurine worktree are unchanged.

## Planned records (subject to separate approval)

One `active:false`, `status:concept` range design with the six exact SKUs and
no supplier-cost fields or selling price. Six SKU claims and a design audit
would accompany the separately approved design creation.

Every SKU uses one shared `FM-B0016BY00-G` metal case and one matching panel:

| Exact SKU | Fabric code | Component action |
|---|---|---|
| B0016-000-GBK | P-CF003-BK | New |
| B0016-000-GBL | P-CF003-BL | New |
| B0016-000-GC1 | P-CF003-C1 | Reuse `rc_mv7xu3mmayc5g` |
| B0016-000-GMT | P-CF003-MT | New |
| B0016-000-GPE | P-CF003-PE | New |
| B0016-000-GVL | P-CF003-VL | New |

The component phase proposes six new component documents, one narrow C1
cost-mirror update, seven supplier quote documents, the seven-ref BOM update
and one audit. No CF002, screws, assembly or finished-packaging component is
created. Preserve the Corporate Gift source concept, including its existing
HKD 62 price; never copy that price to the Figurine design.

## Internal supplier terms

- Feihong: RMB 11.30 per metal case, MOQ 500. RMB 142 sample + RMB 2,770 mould
  = RMB 2,912 one-time fee, one shared metal economic cost. The preferred
  quote and component mirror describe the same fee, not two charges.
- Ryan: RMB 8.10 source panel price retained separately from the owner's
  conservative RMB 9.00 working cost; MOQ 100 per colour. Proposed quotes
  explicitly mark supplier colour confirmation pending. Existing source
  descriptions do not map all six codes to the supplier's named colours.
- Supplier IDs and source component/quote paths are verified from existing
  records, not guessed. Costs/notes remain in supply-side components/quotes.
- Existing C1 currently has no supplier, cost or quote. Retain its exact code,
  name `mezuza水晶布`, images, notes, stock and movement history. Any concurrent
  assignment or new quote blocks automatic reuse; no silent overwriting.

## Verified outcomes and remaining review

Fresh privileged read scanned 293 designs and 840 components. No six-SKU or
new-component-code collisions; C1 matches the exact reviewed ID. This is a
snapshot, not a race-proof code reservation or a persisted audit certificate.

23 unit/MCP tests passed, including six-colour costing/MRP, shared stock pool,
single tooling fee, legacy compatibility, dry-run no-write, C1 preservation,
dedup, auth and blocked legacy-create bypass. Java-backed emulator suites:
82 base RBAC, 25 phase-one scope, 8 prior candidate-integrity and 30 new
seven-component/approval integrity checks passed (145 total).
Production build/no-undef lint passed. Browser QA uses seeded responses, not
production customer sessions: 12 checks passed at 375/1280px, including six
colour subtotals, disabled publication, no finished-price table, no writes,
no overflow and no runtime errors. The real local prepare handler was exercised
through a read-only owner-data bridge; the service endpoint is NOT deployed.

Review still required: unnamed B brand/000 format, G/Gold plating convention,
BK/MT missing library entries, supplier confirmation of exact colour coverage,
and approval for deployment. The six supplied finished codes are unchanged.
Assembly, final packaging and lead times are unresolved; do not publish prices.

**The seven-component writer is implemented locally but NOT enabled or deployed.**
`create_mezuzah_colour_bom` requires an actual existing inactive B0016 range ID,
UUID, approved dry-run hash, explicit approval and acknowledgement of pending
supplier colour coverage. All 16 records commit atomically, with create-only
preconditions for new records and update-time preconditions for C1/the range.
Retries verify all fields across components/quotes/BOM/audit, return original
IDs after a lost successful response and reject changed UUID content or partial
records. No automatic repair. The old two-component writer is blocked for
FM-B0016BY00-G and CF003 codes at both endpoint and legacy component rules.

The first candidate's full inline validation exceeded Firestore's 1,000
expression budget. The tested replacement requires a private exact owner plan
in `range_mcp_approvals/{auditId}`. Only an admin can provision/revoke it;
the MCP cannot list, create or change approvals. It binds the entire C1 before
snapshot, exact after fields, six new components, seven quotes, BOM and audit.
Rules require every quote/component/link plus a fresh mandatory audit together;
wrong fields, orphaned links, missing records, stale C1, expiry and replays fail.
The approval must preserve Firestore timestamp types in the C1 snapshot, not
serialize them as display strings. Preparation does not create an approval.

Checked-in `b0016WritesApproved()` remains `false`. The release endpoint hard-codes
`writesEnabled:false`, even if an environment variable is true; legacy audit
certification is not wired/enabled. Candidate
tests change the false gate only in emulator memory and seed their approval
fixtures only locally. A future release requires separate owner approval,
fresh privileged collision/C1 quote audits and review of this exact private
plan; no general Firestore Admin grant to the MCP identity.

Final read-only JSON: [B0016-FINAL-DRY-RUN-2026-10-14.json](B0016-FINAL-DRY-RUN-2026-10-14.json).
Request UUID `70e51438-1e69-4ec1-a122-bd6e0621a023`, preview hash
`92f3c12e7b1925eada34ab4db61a2a7a0550bd55f3d1dbfb43fa9ec88b3e5fec`.
There is no B0016 range design yet, so the JSON uses a range-ID placeholder.
After separately approved design creation, re-run preparation using its actual
ID: the hash and owner approval must be regenerated, not replayed from this
pre-design report. This is a live-data read-only local handler smoke test,
not a deployed MCP service test.

The read scope adds only exact-C1/child-quote reads for duplicate checking,
own output IDs (including missing IDs for safe retries) and exact own approval
reads. Unfiltered designs/components/suppliers/approvals remain denied.
All service writes remain denied. Deployment stays rules-first and
requires new owner approval; do not provision the identity or register/push
the endpoint as part of this dry-run task.

## Main release approval

Owner subsequently approved committing/pushing this implementation to main,
expressly retaining disabled writes and prohibiting B0016 creation or price
publication. Netlify app delivery may run on that push; no Firebase rules
deployment, service provisioning, approval creation or live data write is
included. Both checked-in rules and endpoint are hard-disabled. Enabling writes
requires a separate approved code/rules release, not an environment toggle.
