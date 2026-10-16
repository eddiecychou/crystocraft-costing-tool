# Reusable Crystocraft Range MCP — implementation / review

Local implementation only. User instruction explicitly prohibits live fixtures, push to main, rules/app deployment and publication. The dirty primary checkout was not edited/reset. Isolated managed worktree `~/.codex/worktrees/range-mcp/costing-tool`, branch `codex/reusable-range-mcp`, upstream base `f2742198`.

## Evidence inspected

Canonical CLAUDE.md, docs/skills router and architecture/release boundaries; expansion spec and Product Design upload workflow; current upstream RangeForm, RangeComponentForm, criticalComponents, rangeSku, settings and rules. Primary checkout HEAD is `008bb75e`, with pre-existing dirty/divergent work; implementation started from fetched upstream, not that checkout.

Fresh configured MCP SDK `tools/list` returned the existing **eight** B0016 tools (the attached connector metadata exposed six, so it was not used as the authoritative count). Runtime is the existing b0016-f3bd1291 installation. Harmless `search_range_designs({query:'B0016',limit:2})` returned successfully with zero matches. That narrow result does not certify absence of live historical records. Runtime/registration and all legacy source files were left unchanged. Read-only Firebase metadata confirmed Standard edition, Firestore Native `(default)`, asia-east2, pessimistic concurrency. No database settings changed.

## Implementation

See [operator guide](../../mcp/range/README.md), [complete manifest](../../mcp/range/manifest.json), [pure planner](../../src/domain/rangeUpload.js), [transaction service](../../netlify/functions/lib/rangeUploadService.js), [normal UI persistence](../../src/rangePersistence.js).

Five new narrow tools in a separate server/endpoint; independent scoped identity, current-settings validation, canonical item codes and stable IDs. Create defaults hidden Concept/null price. Known-field corrections preserve unknown root/variant fields, existing media, quotes, prices and stock. No generic Firestore operations, activation, price/cost/stock/quote edits or arbitrary media uploads. Readback excludes private supplier/cost fields.

Read-only dry runs issue expiry/scope/version-bound HMAC tokens. Human-only operator approval is outside the MCP manifest. Commit rechecks current identity/profile/private control, owner authority, exact review and versions inside one Admin SDK transaction; family, explicit missing components, reservations, private audit/receipt and approval consumption commit atomically. UUID retries return the original receipt, including after token expiry, without a second write. Uncertain readback is explicit.

Normal Range form, ERP create, seed import, component editor/bulk/import paths now share family and component reservations. Family/component claims are immutable tombstones; removal/reuse needs owner reconciliation, not silent replacement. Existing same-identity edits remain permitted. B0016 writer files/schema/transport unchanged; generic plans refuse an active legacy release window.

The rules test found a Firestore v2 recursive child wildcard also matching the Range parent document, bypassing the parent create/update reservation checks. Requiring actual subcollection/document segments closes that overlap while preserving child access.

## Verification / limits

Counts and final evidence are recorded below after execution. Emulator fixtures use only `demo-range-mcp` and loopback hosts. Real Admin SDK transaction tests cover write-free prepare, owner approval, canonical coach, arbitrary other family/multiple finishes/chips, exact reuse/new part, stale images/settings/reference drift, idempotency, simultaneous MCP requests, manual UI vs MCP, punctuation collisions, explicit rollback interruption and no quote/stock/price side effects. Prototype rules tests include scoped service misprofiled as admin/staff/customer, direct private access and Storage denial; normal reserved writes accepted and orphan/hijack/unreserved operations refused. Existing RBAC and B0016 compatibility tests also run.

Actual RangeForm and RangeComponentForm are rendered against the committed emulator fixture through a dedicated local QA entry/config. This is visual persisted-data proof, not a hosted deployment or fresh real-user login. Production build uses the normal Firebase config guard (public configuration only). The QA config is not in the production entry graph.

No remote push, candidate deployment, production app deployment, rules deployment, capability provisioning, live catalogue writes, or publication occurred. Hosted candidate/production fresh admin+customer release gates remain **BLOCKED pending separate owner-authorized release**, not passed/skipped. Owner approval is also needed for the separate identity/control/signing secret, any write window, and each exact product preview. A live fixture is not necessary and has not been authorized.

V1 bounded server scans cap at 2,000 families/components; beyond that an index migration is required. Privileged external Admin SDK writers must use reservations or be paused. Same-URL Storage object replacement is not versioned by Firestore. Existing hidden records are still readable by approved customers via current rules if their ID is known: hidden is not a privacy boundary, so private supplier/cost data must stay off the family. Existing admin stock UI may display absent stock as zero; this implementation writes no synthetic stock/availability. See operator guide for coordinated rules/app cutover, old-client reload, tombstones, retry/reconciliation and approval steps.

Clean-install note: the inherited B0016 dependency lock contained absolute local-machine symlink targets. Both MCP lockfiles were regenerated from the package manifests against the npm registry so fresh CI installs are portable; legacy tool implementation/schema/transport files remain unchanged. A clean dependency install and both fresh stdio test suites pass.

## Final verification ledger

| Check | Result |
| --- | --- |
| Current upstream recheck | `main` still `f2742198bd46dc7771a201b0b0fdf780e59ae4b4` (read-only remote-head query) |
| Pure planner | 13/13 |
| Fresh new stdio manifest, schema/transport/client boundary | 3/3; checked-in manifest exactly matches runtime listTools |
| Existing eight-tool MCP suite | 16/16, including clean registry install |
| Real Admin SDK emulator transactions | 14/14, including manual family/component writers vs MCP, inter-family punctuation race, stale external images/references/settings, retry, interruption rollback and expired-window status |
| New Firestore/Storage security suites | 3/3 grouped tests; repeated direct denial across service/admin/staff/customer misprofiles, accepted normal admin workflows |
| Existing RBAC suite on shared emulator project | 82 passed, 0 failed, including Storage positive/negative checks |
| Existing B0016 exact release prototype rules | 18 passed, 0 failed |
| Additional B0016 colour-BOM, code audit, FM and release unit suites | 17/17 |
| Complete root prebuild | All green (390 reported tests/assertions, including the 13 planner tests); includes actual admin/customer search regressions |
| Normal production Vite build | PASS with the public-Firebase build guard enabled; existing large-chunk warnings only |
| Node endpoint packaging | esbuild bundle targeting Node 20 loaded locally; unauthenticated request returned 401 before credentials/Admin initialization |
| Undefined-name lint / diff whitespace | Zero errors |
| Actual OC form persisted-data review | PASS against local emulator fixture; [family screenshot](range-mcp-evidence/family-form.png), [component screenshot](range-mcp-evidence/component-form.png) |
| Hosted candidate / production real admin and customer login | **BLOCKED pending separate release approval**; never inferred from mock-admin emulator UI |

The initial broader RBAC attempt used a different test project from the Storage emulator and failed Storage's profile cross-lookups. Re-running sequentially with the documented shared demo project passed all 82 checks. A local QA Firebase dependency mismatch was resolved through explicit root-SDK aliases in the dedicated preview config; the production Firebase module is unchanged. The emulator Admin SDK emits a metadata credential lookup warning in this local environment; it connects only to the explicitly required loopback Firestore host and fixed demo project, and all transaction assertions pass. These local tooling issues are not represented as production defects or hosted login proof.

Prototype Security Rules were added to keep Firestore data safe by denying the new scoped service direct catalogue/private mutations and requiring validated, exactly approved server transactions. They have not been deployed and need a separate security review before live use. Review also covers the server's Admin SDK authority, private capability provisioning and coordinated normal-client reservation cutover.
