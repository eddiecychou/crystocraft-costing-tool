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

## Candidate and local scheduler deployment

- Implementation `9ee995f1cf5a15e138f625375a3287e55497612a`; final source
  `52ffb39c4c339681813e4c7462547cdb69896785` adds only the WhatsApp CI path.
- Candidate `6ad36a7fb984d44e167d5578`, asset `/assets/index-DOIfUEND.js`;
  served Firebase configuration probe HTTP 200. Candidate source bundle was built
  at implementation commit; final source differs only in the Actions path list.
- Fresh candidate admin/customer password sign-ins PASS. Admin Dashboard and
  Range 297/297 (722 SKUs), Settings/Portal available. Daily Drafts 0 pending /188
  sent, explanation visible and refresh preserved. No generation/send clicked.
- Customer QA company/USD correct; Range 295 designs, butterfly music-box detail,
  Chrome USD12.51/Gold USD12.84 and ~9-week lead time loaded after refresh. No
  Settings; /dashboard redirected /shop. Runtime errors empty before logout.
- Branch Actions final source PASS:
  https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39032878106
- Installed copied runner matches tested SHA256. Three plists loaded with
  60-second polling, `TZ=Asia/Hong_Kong`, no calendar interval or RunAtLoad.
  Immediately after bootstrap all three were idle with zero runs; no import
  executed as a test. Current periods seeded to hourly17Oct20HKT, daily17Oct,
  weekly11Oct. Next calendar jobs Sunday18Oct03:00 HKT; hourly next21:00HKT.
- Backup: `~/Library/Application Support/Crystocraft/oc-scheduler/backup-20261017T123510Z`.
- Existing dirty-checkout status SHA256 remains
  `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`.
- Production push to main completed; final production evidence follows.

## Production release

- Main source `52ffb39c4c339681813e4c7462547cdb69896785` deployed as
  `6ad36b70228ef8cdbaad31cc`, published 17 Oct 2026 20:36:00 HKT.
- Served `/assets/index-BzakMyOO.js`; configuration probe HTTP 200.
  Sidebar V8.18 · 17 Oct, 20:35 HKT.
- Main Actions PASS:
  https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39033091484
- Fresh production admin sign-in PASS; Dashboard 3 due = 3 overdue / 0 today,
  Settings/Portal available; Range 297/297, 722 SKUs. Daily Drafts explanation
  visible, history 0 pending / 188 sent retained after refresh; runtime errors empty.
- New local runner logs show HKT+08:00 polling with not-due (or shared lock busy),
  no imports triggered on install. Full fake-executor boundary tests passed;
  actual future 03:00 run has not been forced or claimed as already observed.
- Fresh production approved-customer sign-in PASS: correct QA company/USD,
  Range 295 designs, butterfly music-box prices/lead time retained on refresh,
  no Settings, /dashboard redirects /shop. Runtime errors empty; QA signed out.
- Screenshots (candidate and production, both roles):
  `/Users/eddie/.codex/visualizations/2026/10/14/01a13b22-c93b-79f2-9f8b-551754486033/scheduled-hkt-release-2026-10-17/`.
- Firebase Firestore/Storage rules unchanged and not deployed. Dirty original
  checkout remains untouched. No customer records/products published, imports
  forced, marketing generated or messages sent for verification.
- Scope: this Mac's three installed OC jobs and the deployed app. Other Macs
  require their own reviewed scheduler installation; no machine timezone changed.
