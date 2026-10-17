# Scheduled jobs and Daily Drafts — Hong Kong time

## Findings and changes

Inspected all repository schedule declarations, Actions, Netlify configuration,
local Crystocraft LaunchAgents and crontab. Exactly three local OC imports were
loaded; no user crontab and no scheduled Netlify/Actions business job were found.
Daily Drafts, campaigns and AI summaries are user-triggered. ERP nightly sync is
a documented future Windows task, not an installed job on this Mac.

Local calendar jobs previously ran at the Mac's Sunday/daily 03:00. The tested
runner now checks explicit UTC+8 periods: hourly live email ingestion, Sunday
03:00 HKT full email/archive rescan, daily 03:00 HKT WhatsApp archive import.
Launchd polls every minute, independently of device timezone. Install seeds
current periods without running imports. Shared email locking, success-only
atomic checkpoints, retries and one catch-up after sleep avoid simultaneous
email state changes and replay storms. Existing imports remain idempotent;
crash after import but before checkpoint can safely retry. A Mac must be awake
and logged in; this change does not create cloud ingestion.

Installer copies only the runner outside the checkout, backs up existing plists,
keeps existing repo targets/config/state and refuses unfamiliar or running jobs.
Existing dirty checkout is not modified. TZ is also explicit in committed shell
wrappers for future clean checkouts. No stored UTC timestamp convention changes.

Daily Drafts displays a brief timing explanation. Shared parsing fixes legacy
zone-less OC timestamps in cooldown/block checks, handles SDK/REST timestamps,
and excludes malformed history conservatively. Cooldowns remain elapsed 14/21
days; pending drafts survive midnight; no scheduled generation or sending added.
Provider-side quotas and IMAP search date semantics are unchanged.

## Verification

- `test:scheduled-time`: 5 Python + 2 Node cases, no live calls; four host zones,
  HKT midnight vs 03:00, Sunday/year/leap/DST, catch-up/duplicate/rollback, retry,
  shared email lock, no run on install, full elapsed cooldown boundaries.
- Included in prebuild/test:oc-time and Actions; schedule files trigger Actions.
- Full production build, lint/no-undef, 11 Firebase config checks passed.
- Candidate/prod role and scheduler deployment evidence to be appended after
  successful release. No live marketing sends, draft generation or imports are
  used as verification. No customer/product/rule changes.
