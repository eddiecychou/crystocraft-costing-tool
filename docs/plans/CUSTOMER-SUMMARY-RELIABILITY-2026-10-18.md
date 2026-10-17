# Customer summary periods and reliability — 18 October 2026

Release preparation authorized by the owner on 18 October 2026.
Candidate and production two-role gates passed; see `SUMMARY-RELEASE-2026-10-18.md`.
No production AI summary generation or customer cache update has been performed.

## Changes

- Shared Dashboard / Customer Detail choices: 14, 30, 90, 180 and 365 rolling days.
  Each period has an independent cache; the existing one-month cache is retained.
  Longer periods cover imported email, WhatsApp and CRM interactions. Choosing a
  period does not run AI or change tasks, notes, counts or confirmed Pipeline.
- AI requests now contain at most three customers and 24,000 source characters
  total (previously six times 24,000). Recoverable incomplete requests split into
  smaller batches down to one customer. Successful results are saved only after
  every customer validates. No partial cache writes.
- Separate safe errors for timeout, truncated output, incomplete/invalid output,
  rate limiting, provider unavailability and credentials. Provider bodies and
  customer source text are not included in errors. Configuration/rate errors are
  not recursively split. Existing server retry remains bounded at two attempts.
- Assemble importer history pages under the correct customer/parent before
  filtering message dates. Missing referenced pages fail closed. Read all email
  thread docs so an import timestamp cannot hide older message evidence.
- Pipeline proposals retain the correct long-period cache label. Rules allow
  the two new source-cache names with existing CRM-only access and audit checks.

## Diagnosis and limits

The old error in the screenshot is a catch-all: it is not proof of a particular
AI failure. Inspection confirmed oversized batches, identical retries and no
failure category. Regression fixtures reproduce truncation, timeouts and invalid
responses and verify recovery/preservation. The original provider event cannot
be distinguished retrospectively from that screenshot. No customer conversations
were sent to AI for this investigation. Busy histories still use the existing
24,000-character per-customer evidence sampling and source-limited indicator;
these are summaries, not exhaustive audits of every message.

## Verification

- Full production build and prebuild regression suites passed.
- No-undef lint and diff whitespace checks passed.
- Summary suite covers periods, source sampling, failure modes, singleton fallback,
  complete-cache preservation, paged history and aggregate source limits.
- Firestore emulator: eight Pipeline cases passed, including both long-period
  proposals remaining unconfirmed and anonymous/customer denial.
- Real Dashboard and CustomerDetail mounted against fictional Firestore emulator
  records: all 21 cases passed, including both new options selecting their own
  saved summaries without replacing the one-month cache.

## Release

The owner has authorized push, app/rules deployment and fresh two-role checks.
Release app and the source-cache rules together
so longer-window Pipeline proposals work; follow RELEASE-WORKFLOW.md candidate
and production fresh admin/customer login gates. The release branch `codex/summary-release-20261018` starts at upstream
`6abec8af`; the local importer commits are deliberately excluded.
The primary dirty checkout and importer worktree are untouched.
