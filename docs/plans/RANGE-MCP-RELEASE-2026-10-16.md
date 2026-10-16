# Range MCP and simple product entry — release evidence

16 October 2026. User authorized push/deploy, fresh admin/customer verification, and separately approved read-only MCP provisioning. User requested equal direct OC and agent entry, with simple review/correction and reusable lessons.

## Delivered

Application commit `40059babc45e0211241dc3e8374f0a183ed207ad` includes initial MCP implementation `4ea80038798de5d2a2e3a05c6f4df1fc99319574`. Feature branch and main pushed. Original dirty/divergent checkout was not reset or edited.

Quick Add uses the existing editor and saves new entries as hidden Concept with null wholesale prices. Optional sections expand in place. Duplicate design/format offers Open existing product. Existing records retain the full editor. The agent accepts one natural-language brief, resolves library IDs, consolidates blocking questions and prepares one readable preview. Corrections target the same family. See `docs/skills/RANGE-PRODUCT-ENTRY.md`.

Five separately scoped MCP tools support bounded family/component reads, signed dry runs and idempotent guarded commits. Existing B0016 implementation/manifest are unchanged. No new approval queue or automatic publication was added.

## Release states

- Firestore and Storage rules separately compiled, uploaded and released to `crystocraft-costing` before app release.
- Final candidate: `6ad1a8bf948ab6b0765682f1`, https://6ad1a8bf948ab6b0765682f1--ua-product-manager.netlify.app, asset `/assets/index-CrZcglAs.js`.
- Production: `6ad1aa16e706899d666a907a`, application commit above, published 2026-10-16T04:38:39.163Z, https://portal.crystocraft.com, asset `/assets/index-BRBZPoRR.js`.
- Main GitHub Actions run 38851597115: completed success. Feature run 38851119743: completed success.
- Public Firebase configuration probes: HTTP 200 on final candidate and production. These are supplemental, not login proof.

## Real-page verification

Fresh password sign-ins used approved QA accounts only. No QA role, password, approval status or owner browser session changed.

| Stage | Admin | Approved customer |
|---|---|---|
| Final candidate | Fresh login, Dashboard/admin navigation; 296 products/720 SKUs; refresh; Quick Add hidden Concept action; no save; console errors none | Fresh login, customer company/currency, catalogue and Sacred Angel search/detail, ~9 weeks/MOQ 100, refresh; settings redirects to shop; console errors none |
| Production | Fresh login, Dashboard/admin navigation; 296 products/720 SKUs; refresh; Quick Add hidden Concept action; no save; console errors none | Fresh repeated login, customer company/currency, catalogue/search/detail, ~9 weeks/MOQ 100, refresh; settings redirects to shop/no admin links; console errors none |

An initial production customer session displayed Awaiting approval. Refresh restored the correct customer view; a subsequent full sign-out and fresh password sign-in passed without refresh. Read-only server verification confirmed the customer profile remained customer/approved. No account repair or authentication code change was performed; the initial transient is retained here, not represented as a clean first attempt. Root cause was not established. Monitor if reported again.

Screenshots retained locally under `/private/tmp/range-release-evidence/`: candidate-admin-quick-add.png, candidate-customer-detail.png, production-quick-add.png, production-customer-detail.png. QA sessions signed out afterward.

## Automated and emulator checks

- Full prebuild: 392 reported tests/assertions; Vite production build passed.
- Range planner 13, Quick Add 2, new stdio 3, legacy MCP 16; emulator integration 14/14; grouped rules suite 3; RBAC 82/82; login/config 11/11 passed.
- Source/functions no-undef lint and diff checks passed.
- Actual editor emulator save/readback: hidden Concept/null prices and finish chips preserved; duplicate rejected; correction retained the same ID. No live product fixture.
- Both candidate and production: five tools listed, bounded family read passed, existing-family no-op dry run returned signed preview with no missing facts/conflicts. `commit_enabled:false`. Commit with valid preview was rejected `WRITES_DISABLED`; no product approval created and no catalogue writes.

## Read-only setup and remaining approval

Separate `mcp-range-upload-service` principal has service role, range-upload-v1 scope, modules [], and only range_upload custom claim. Private control verified enabled:true, writes_enabled:false, write_expires_at:null. Netlify function flag RANGE_UPLOAD_WRITES_ENABLED=false. Signing secret is server-only and secret, scoped to functions in production/deploy-preview/branch-deploy. No credential values are included here.

Local `oc_range_upload` registration uses the separate stable client and a private mode-0600 refresh-token file. Actual configured stdio runtime was verified; an already-open agent session may need MCP reconnect before the new namespace appears. Existing clients remain registered separately.

Live use still requires owner approval of the actual product preview and a separately authorized, bounded operator write window under the existing README gates. No general admin authority, publishing or pricing authority was granted. Normal authorized OC editing remains available.

## Rule hashes

- firestore.rules: `6a234f7731206d00f60634e50051a3fdd9fec8e73fdb17436a83adf5f8582ba6`
- storage.rules: `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`

Primary checkout status fingerprint remained `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`. This evidence-only follow-up commit uses [skip netlify] so the verified application deploy remains unchanged.
