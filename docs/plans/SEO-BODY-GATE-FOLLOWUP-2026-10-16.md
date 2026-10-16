# SEO gate: Elementor body and readback follow-up

16 October 2026. Local implementation on `codex/seo-elementor-body-gate`, isolated
from the dirty primary checkout, based on upstream `736707d7`. User asked for the
modifications in DSH's response to release e516a1c9. No production release or
WordPress writes were performed.

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
- Complete prebuild regression pipeline passed before the final additional media
  control coverage; final focused SEO suite passed after that addition.
- Production Vite build passed with existing large-chunk warnings.
- Changed implementation files pass no-undef lint and diff whitespace checks.
- All execution/readback tests use injected data, not WordPress network writes.
- No hosted candidate or production login was attempted for this local code.
  Fresh admin and customer checks on both are required for a future app release.

Detailed contract and DSH re-vendoring steps: `seo-control-plane/README.md`.
DSH privacy/cache evidence remains attributed; it was not re-certified by OC.

## SHA-256 of shared artifacts

- `validate-payload.mjs`: `37583b7dfd5cbb79ba23f83c236cc3861f701d7bdbbecdf7327d7aae40a68a3a`
- `validate-payload.test.mjs`: `c60b8956cf6775f5caaa39cbf5fa21fdd9767cce569e1ce4bca2905afbb6675a`
- `safe-write.mjs`: `dcc09bf8d1a015bf3fa4db8bdceb5d02b3b6291c83151981dea6cdc58ebbdb21`
- `safe-write.test.mjs`: `ff377077b1b144beca86e2a55d513874473fbadae71eed152bfc835815e03cb2`
- `yoast-indexable.mjs`: `28eba647fe55594f521793c44a1365a1c7108c8864ebcf9ad3ded79dde08a8a9`

These identify the local candidate artifacts, not a production release pin.
Before DSH adoption, use the immutable approved release commit with the existing
read-only vendor checker against every active directory. No automatic downgrade
or working-tree copy instructions.
