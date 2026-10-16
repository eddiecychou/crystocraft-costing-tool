# SEO gate: Elementor body and readback follow-up

16 October 2026. Implemented on `codex/seo-elementor-body-gate`, isolated from the
dirty primary checkout, based on upstream `736707d7`. Application release
`dc3aa98ffe6206f337962c82b209e7738fd4f224` is pushed and deployed following explicit
owner approval. No live batch decisions or WordPress writes were performed.

## Changes

The gate validates the body representation being changed. Layout-only meta now
runs all four image/h2/script/table checks against decoded Elementor settings.
Both fallback HTML and layout are judged independently if both are supplied.
New declared structural nodes no longer inflate widget_count. Existing ID and
brand preservation, missing-source failures, approval, backups, execution claim,
cache invalidation and exact-value verification remain in force.

safeWrite distinguishes missing target fields from changed values and unwraps
reviewed raw body/title/excerpt objects symmetrically. Post-read missing fields
remain unverified with unlanded receipts and an explicit possible-write warning.
The review error banner now has Reload queue, with a click test proving no stale
work is approved. Claimed/refused receipts are tested as inert history that does
not block fresh same-entity work.

## Verification

- SEO suite: **284 passing reported checks/tests, zero failures**: portable
  validator 159, portable safeWrite 56, batch guard assertions 13, node tests 56.
- Final clean-install full prebuild: **429 reported checks/tests**, zero failures.
- Additional login/configuration suite: **11/11** pass.
- Production Vite build passed with existing large-chunk warnings.
- Changed implementation files pass no-undef lint and diff whitespace checks.
- All execution/readback tests use injected data, not WordPress network writes.
- Fresh real-page password sign-ins passed for both roles on candidate AND production, as recorded below.

Detailed contract and DSH re-vendoring steps: `seo-control-plane/README.md`.
DSH privacy/cache evidence remains attributed; it was not re-certified by OC.

## SHA-256 of shared artifacts

- `validate-payload.mjs`: `37583b7dfd5cbb79ba23f83c236cc3861f701d7bdbbecdf7327d7aae40a68a3a`
- `validate-payload.test.mjs`: `c60b8956cf6775f5caaa39cbf5fa21fdd9767cce569e1ce4bca2905afbb6675a`
- `safe-write.mjs`: `dcc09bf8d1a015bf3fa4db8bdceb5d02b3b6291c83151981dea6cdc58ebbdb21`
- `safe-write.test.mjs`: `ff377077b1b144beca86e2a55d513874473fbadae71eed152bfc835815e03cb2`
- `yoast-indexable.mjs`: `28eba647fe55594f521793c44a1365a1c7108c8864ebcf9ad3ded79dde08a8a9`

These identify the released artifacts at immutable application commit
`dc3aa98ffe6206f337962c82b209e7738fd4f224`. Use the existing read-only vendor checker
against every active directory. No automatic downgrade or working-tree copy instructions.


## Deployment and login evidence — completed 16 October 2026, 18:52 AEDT

- Candidate deploy: `6ad1d5acd3df5fee6e0280ab`,
  https://6ad1d5acd3df5fee6e0280ab--ua-product-manager.netlify.app,
  served `/assets/index-DIHpvUa_.js`. HTTP 200 Firebase configuration probe.
- Production deploy: `6ad1d68ae7d4263e3a54df83`,
  https://portal.crystocraft.com, served `/assets/index-DqDNtkwE.js`, app commit
  `dc3aa98ffe6206f337962c82b209e7738fd4f224`. Published
  2026-10-16T07:48:16.822Z (18:48 AEDT). HTTP 200 configuration probe.
- GitHub Actions main run **38869435176**: completed success. Feature run
  **38869187998**: completed success. These validate the application release,
  distinct from the later evidence-only documentation commit.
- Firebase rules: unchanged, not deployed in this release. Existing Range MCP
  write controls/configuration unchanged; no preview approvals issued.

| Check | Candidate admin | Candidate customer | Production admin | Production customer |
|---|---|---|---|---|
| Fresh password sign-in | PASS — claude-qa@crystocraft.com | PASS — customer-qa@crystocraft.com | PASS — claude-qa@crystocraft.com | PASS — customer-qa@crystocraft.com |
| Role/routing | Dashboard, Settings/admin nav | QA customer company, USD, /shop | Dashboard, Settings/admin nav | QA customer company, USD, /shop |
| Data | 297 Range products / 722 SKUs; SEO queue 12 history buttons | 24 catalogue cards; Sacred Angel Freestand detail | 297 Range products / 722 SKUs; SEO queue 12 history buttons | 24 catalogue cards; Sacred Angel Freestand detail |
| Refresh | Correct admin shell and loaded Range data | Correct customer/detail, ~9 weeks, MOQ 100 | Correct admin shell and loaded Range data | Correct customer/detail, ~9 weeks, MOQ 100 |
| Access separation | Admin navigation available | /settings redirects /shop; no admin links | Admin navigation available | /settings redirects /shop; no admin links, supplier/internal cost fields absent |
| Console/runtime | No errors captured before sign-out | No errors captured | No errors captured before sign-out | No errors captured |

Screenshots retained locally in `/private/tmp/seo-release-evidence/`:
`candidate-admin-queue.png`, `candidate-customer-detail.png`,
`production-admin-queue.png`, `production-customer-detail.png`.
QA sessions signed out afterward; owner Chrome session untouched. Approval and
Reload queue behavior tested with injected React/Firestore data; no owner's live
item was approved, withdrawn, claimed or submitted to WordPress for testing.

## DSH delivery

`DSH-SEO-Gate-dc3aa98-2026-10-16.zip` contains the five exact shared artifacts,
the immutable vendor checker, RELEASE.md with update/test instructions and
SHA256SUMS. Packaged suites pass 159/159 and 56/56; all checksum entries and
archive integrity verified; packaged vendor sync matches the immutable commit.
No Workbench directories were edited. DSH must update every active vendor,
rehearse the listed failures with stubbed writes and submit a fresh batch for
owner approval. Full hashes above identify the shipped artifact bytes.

The original dirty primary checkout remains on 008bb75e with unchanged status
fingerprint `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`.
This release evidence update uses [skip netlify]; it does not replace the verified
production app build.
