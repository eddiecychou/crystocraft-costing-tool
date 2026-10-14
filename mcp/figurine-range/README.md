# B0016 Figurine Gifts MCP (isolated, review-gated)

This is a **separate stdio MCP server and Firebase service identity** for the
Crystal Fabric Mezuzah Case. It does not extend the Corporate Gift writer's
permissions and does not create another `products/{id}` record. Its source is
the existing hidden concept `products/mcp_a844ebe21ba90961027c05752f5a8554c7a7d4bd`.

Current state: **local implementation only**. The endpoint, rules, identity and
Codex registration are not live. The edge endpoint defaults to
`FIGURINE_MCP_WRITES_ENABLED` off. Do not provision, deploy, set that variable,
or call either create tool until Eddie approves the exact dry-run output.

## Tool manifest

| Tool | Effect |
|---|---|
| `search_range_designs` | Read-only name/number or exact-code lookup |
| `get_range_design` | Read-only one-design summary |
| `prepare_mezuzah_range_design` | Dry-run exact six-code check and planned range/claim/audit fields |
| `create_mezuzah_range_design` | Owner-approved, atomic inactive Concept design + six code claims + audit |
| `prepare_mezuzah_range_components` | Dry-run source quotes, reviewed component-code collisions and six planned records |
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

The Feihong metal case is RMB 11.30/piece, MOQ 500; the RMB 2,912 one-time
sample/mould fee is attached to that metal component only. M3 screws are
excluded. Ryan's panel was quoted at RMB 8.10; the owner-selected conservative
working unit cost is RMB 9.00, MOQ 100 **per colour**. Assembly and packaging
are unresolved. Neither tool computes or publishes a finished-product price;
the Corporate Gift concept's HKD 62 is intentionally not copied.

## Idempotency, audit, and approval

Create requests require a UUID, `approved:true`, `dry_run:false`, and matching
acknowledgements. The UUID and canonical payload hash determine the record IDs.
One Firestore REST `commit` uses create-only preconditions for all new records
and an update-time precondition for the BOM link; a failure leaves no partial
records. Retrying the same UUID and payload returns the original IDs. Reusing
that UUID with changed content fails. Both operations write an append-only
`range_mcp_audit` record with `service_principal:mcp-figurine-range-service`,
`requested_by:unknown`, source IDs, request hash and server timestamp. The
audit does not pretend to identify a human operator.

## Deployment sequence (requires a new owner approval)

1. Review the real-data dry-run, exact codes, colour/plating warnings, and
   proposed component codes. Resolve any conflict first.
2. Run all local tests, the Firestore rules validator, and the RBAC emulator.
   Review the **new, not deployed** `firestore.rules` prototype. Rules go first;
   the Netlify app and local MCP are separate deployments.
3. Only with explicit approval, provision the dedicated Auth user with
   `modules:[]` using `npm run provision-service`. It must not get `figurine`,
   `supply`, `products`, `pricing`, or admin.
4. Deploy the approved rules, then the app endpoint, then register/restart the
   local MCP server and verify `tools/list` plus harmless reads/dry-runs.
5. Keep `FIGURINE_MCP_WRITES_ENABLED` unset/false until separate approval for
   the live create. Never run a live create against B0016 from a smoke test.

After deployment, the Codex MCP registration is a separate local config step:

```toml
[mcp_servers.oc_figurine_range]
command = "node"
args = ["/Users/eddie/Developer/costing-tool/mcp/figurine-range/server.mjs"]
env_vars = ["OC_FIREBASE_API_KEY", "OC_BASE_URL", "OC_FIREBASE_PROJECT_ID"]
```

The isolated worktree can run `node --test mcp/figurine-range/*.test.mjs`.
These tests use a fake Firestore transport and make **no production writes**.
