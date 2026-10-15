# Automated catalogue search regressions — V8.18

Tests render the actual four catalogue pages (admin Range/Products, customer FigurineShop/CorporateShop) with in-memory Firestore snapshots in JSDOM. Production search, row identity, category/status filters, pagination, saved storage values, URL constraints and customer visibility logic remain unchanged. Remote services and unrelated rendering widgets are mocked; all network calls and Firestore writes are forbidden.

27 component tests cover repeated queries, case, no matches/clear, duplicate names/codes/SKUs, results beyond page1, page reset, delayed loading with saved filters, obsolete category repair, remount restoration, live new-product snapshots, saved availability filters, design/SKU queries, URL design/format narrowing and sensitive-customer image exclusion. Duplicate-key warnings are fatal.

`npm run test:product-search` also includes existing quote/filter regressions: **39/39 passed**. The broader catalogue/carousel/availability/config suite: **80/80 passed**. Production build and no-undefined lint pass (existing bundle-size advisory only).

Mutation verification: temporarily replacing each grid's product-ID key with a repeated code/name makes its repeated-search test fail, for all four pages. Each source was restored immediately. The same mutation also stops `npm run build` during prebuild, before Vite compilation. No application source changes remain.

Automation: `prebuild` runs the search suite before every normal application build, including Netlify Git deployments. Local Node20 verification mirrors the hosting runtime. A standalone GitHub Actions workflow was attempted but GitHub rejected the push because the current Personal Access Token lacks `workflow` scope. The unpushed workflow was removed from the commit; no token or account permissions were expanded and branch protection settings were not changed. Build-time regression protection remains active.

This is a test/build-tooling change. The commit uses `[skip netlify]` to retain the already verified production application. No app or Firebase rules deployment and no live product/quote/account mutations.


## GitHub Actions enabled — 15 October 2026

Workflow `.github/workflows/product-search.yml` created on main through the already connected GitHub app in commit `f4afdc78817964145c61a0e27c4e02204e0d65f2`; local worktree fast-forwarded to the same commit. Relevant push/PR path triggers plus manual dispatch, Ubuntu + Node20 + npm ci + the39-check search command. The job has read-only contents access, checkout credentials are not persisted, and no project secrets are supplied.

First real run **PASS**: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/38706116158 — run38706116158/job116325844981 completed successfully, including clean npm ci and the search suite.

Read-only credential audit confirmed the local Git credential belongs to eddiecychou, is a fine-grained PAT and is stored through macOS Keychain. Its workflow-edit permission remains limited. Owner action for future local workflow edits: edit the existing fine-grained token's repository permissions, retain Contents read/write and grant Workflows read/write for this repo; save. The connected GitHub app enabled the current workflow without changing token permissions. Branch protection settings are unchanged.


## Local workflow-push permission restored — 15 October 2026

Owner explicitly authorized adding and saving Workflows read/write on `portal-macbookpro`, after being informed that its existing scope covers all owned repositories. GitHub confirmed the update; reopening the token showed Read and Write access to code and workflows. Existing code permission, repository scope and expiration were preserved. No token value was regenerated, copied or displayed.

A comment-only workflow update documenting the CI job's read-only/no-secret design is included with this record to verify an ordinary local Git push through the existing macOS Keychain credential. Commit uses `[skip netlify]`; no application or rules deployment.
