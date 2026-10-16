# Prepared message for DSH

DSH — the OC fixes are now deployed from commit e516a1c9e9763a661e9191803de7a3d53000c685. GitHub Actions passed all 375 checks.

Worker update required before the next execution:

1. Stop/drain old workers and discard cached approved payloads. Poll with {op:'poll', execution_protocol:2} for discovery only. Immediately before executing a batch, call {op:'claim', id, execution_protocol:2}. Execute ONLY approved, result-free items from the successful claim response. A failed or uncertain claim means ZERO WordPress writes. Legacy polls now return 409 deliberately.

2. A successful claim marks the batch executing before the first result. Unclaimed pending/approved batches with no results can now be withdrawn using {op:'withdraw', id, reason}, the OC button, or an overlapping batch.supersedes replacement. Replacements require fresh approval. Claimed work and anything with a receipt cannot be withdrawn/replayed. Do not clear work by deliberately executing a failing batch. If a worker crashes after claim, inspect WordPress and receipts before reconciliation; never expire/release claims automatically.

3. Re-vendor validate-payload.mjs plus its test, safe-write.mjs plus its test, and retain the identical yoast-indexable.mjs in BOTH active directories. Standalone suites should pass 147 validator assertions and 49 safeWrite assertions. Use the supplied SHA256SUMS. Update your sync checker to read the immutable released commit above, not the OC working checkout or HEAD/main. The new read-only check-vendor-sync.mjs checks the five artifacts and never prints copy/downgrade commands.

4. expectedFields:['meta'] now covers nested metadata, including the layout. Narrow dotted declarations are still preferable. Metadata-only brand preservation skips with an explicit untouched-copy note, so rebuild the metadata-only batch without the former brand exception. Do not replay historical partial batches to manufacture a green result.

5. Keep expectedBefore wired to the exact reviewed RAW target snapshot. Reviewed snapshots AND fresh pre/post reads must use authorised context=edit. Require every intended private target key to be present; missing is not empty. Keep backups, validation, per-field readback, confirmed Yoast invalidation and stop-on-error.

Before a fresh live batch, test with stubbed WordPress PUTs: two workers claiming the same batch; claim versus withdrawal/supersession in both orders; failed/uncertain claim; stale expectedBefore; blocked validation; and recorded results that must not replay. Every losing or blocked path must make zero PUTs. Also test unused approved withdrawal from both API and UI, overlap conflicts, fresh replacement approval, old tabs, nested/meta_data declarations, and actual brand removal still failing.

Then test a fresh metadata-only batch end to end with full edit-context before keys: exact Yoast readback, no layout/body drift, backups and indexable invalidation. Retain the page-Yoast visibility protection. Verify anonymous/customer single, collection, embedded and query/language REST responses hide the private raw fields, while authorised edit reads retain them. Purge previously cached /wp-json/ responses at host/CDN layers, or exclude REST/authenticated edit responses from shared caches. Compare previously cached canonical URLs AND fresh cache-busted URLs; HTML-only purging is insufficient.

OC did not modify your worker, WordPress plugins, live batches or caches. The OC-side anonymous WordPress check returned HTTP 403, so your live privacy/cache verification remains required.

OC release verification: fresh admin AND approved-customer password sign-ins passed on candidate and production, including data loading, role separation and refresh. No passwords, roles, rules or live batch decisions were changed.
