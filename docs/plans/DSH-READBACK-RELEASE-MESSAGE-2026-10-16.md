Hi DSH — the OC Elementor read-back and batch-safety fixes are deployed.

App commit: 89e207e1aa015051ae5aab01d2ceec730a2d499a.

The four reported layout failures were reproducible: PHP's slash/Unicode
escaping made equivalent Elementor JSON look different. safeWrite now compares
parsed layouts for requested values, drift and no-op checks. Real content
changes, array order, malformed JSON and genuinely ignored fields still fail.
Ordinary text/HTML is still checked exactly.

Please update and test before submitting or executing more work:

1. Re-vendor safe-write.mjs and safe-write.test.mjs verbatim into EVERY active
   vendor directory, including Deepseek Render/seo-control-plane/ and
   SEO/seo-control-plane/. Verify SHA256SUMS and vendor sync; standalone
   safe-write tests must report 47 passed, 0 failed.
   Writer fingerprint: b9f18f27f404. Validator 713ceb69fd16 and Yoast helper
   28eba647fe55 are unchanged.

2. Wire expectedBefore to the exact RAW target-field values captured for human
   review, e.g. { 'meta._elementor_data': reviewedRawLayout }. Do not supply a
   hash, rendered content, the English source for a translated target, or a
   newly fetched value substituted after approval. A changed source must stop
   BEFORE PUT. This protection requires your wiring; it is not enabled merely
   by deploying OC.

3. Handle 409 conflicts from batch creation. Combine edits to the same entity.
   To replace overlapping unexecuted pending work, send
   batch.supersedes: ['oldBatchId'] with a complete fresh replacement.
   This withdraws the WHOLE old batch atomically; carry forward every wanted
   change. Approved/in-flight/partial/executed batches cannot be superseded.
   Replacements always need fresh human approval.

4. Test PHP slash/Unicode escaping and object-key reordering as equivalent;
   changed values/array order, malformed data, ignored Yoast fields and no-op
   layouts must remain failures. Test stale expectedBefore with ZERO PUTs,
   overlapping batches returning 409, supersession audit links, old-tab review
   rejection and fresh approval for replacements. Poll immediately before
   execution; never execute cached or superseded work.

5. Do not replay the old partial layout writes just to turn their results green.
   Historical receipts remain unchanged. Check the current queue before
   rejecting or replacing any obsolete pending batches; some may already have
   been rejected. Keep backups, expectedFields, verified gating and stop-on-error.

6. Page Yoast metadata is a separate WordPress prerequisite and is NOT fixed by
   this OC deployment. Prepare a page-only registration for the two Yoast keys
   for owner approval, preserving per-page edit authorization and sanitisation.
   Test authorized save/read-back, denial for anonymous/customer users,
   unchanged post/product behavior, Yoast invalidation and public title/meta
   output. Then submit a fresh, narrowly scoped metadata batch without
   resending the current layout.

OC regression checks: 360 passed, zero failures. Fresh admin and approved-customer
logins passed on candidate and production. Please report all vendor hashes,
producer test results and the fresh batch ID before requesting approval.
