# DSH Elementor layout writes

Owner asked to implement the attached 14 October request. Inspected current main
in the managed V8.18 worktree, preserving the unrelated dirty primary checkout.

Confirmed the validator required a prior tree even on a collection POST or a
plain-page conversion. Fixed creates and proven empty baselines while retaining
failures for incomplete/malformed sources. Added per-item reasoned exceptions,
original failure evidence, reviewer display and CI/prebuild regression coverage.
No exception can waive missing source evidence, invalid JSON or translation
publication restrictions. Human approval and safeWrite backups/read-back remain.

No live batch was changed, no WordPress page written, and no deployment performed.
DSH needs the updated validator + tests, the new fingerprint and a fresh batch.
Verification: production build passed; 130 existing application regression tests
passed, plus 214 SEO assertions/tests (validator 144, safe-write 47, batch guards
13, new first-layout/exception/UI tests 10), zero failures. Undefined-identifier
lint and whitespace checks passed. No live WordPress write or batch replay was
used as a test.

DSH handoff: re-vendor `seo-control-plane/validate-payload.mjs` and its `.test.mjs`,
pass `allow` through local validation and batch items, use collection endpoints
for creates, submit a fresh batch and obtain normal human approval. Old failed
batch vaGCoKKzOg8pVW6K9jVy is unchanged. OC changes are local and not deployed.

SHA-256 (exact):


- `seo-control-plane/validate-payload.mjs`: `713ceb69fd1621066f806dcc8f856446c44c8d9e8ecd1d0336761db273b2aea0`

- `seo-control-plane/validate-payload.test.mjs`: `703f987c6087a624cafd9a24d80596ae3cd6caa545012867792090f13ce06760`
