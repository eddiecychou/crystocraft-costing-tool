# Automatic Today / Overdue rollover

17 October 2026, Australia/Sydney. Owner authorized implementation, regression tests and deployment, then specified Hong Kong time for the OC. The initial local-time draft candidate was not published; this revision uses Hong Kong time.

## Fix

Previously the date was computed during render only, so an idle open page could keep yesterday’s date until another update or refresh. Dashboard and CustomerWorkspace now use `useOcToday` backed by one shared OC day store. It schedules the next **Hong Kong midnight (UTC+8)**, regardless of device timezone or daylight-saving changes elsewhere. Focus, pageshow and visibility return catch up after sleep or background throttling. A single one-minute watchdog handles foreground system clock changes. Same-day ticks do not notify/render every customer. Timers/listeners start with the first subscriber and stop with the last.

Counts, subtotals, already-open Today/Overdue sections, task labels, ordering and Dashboard date update together. Filters, conversation window and unsaved customer-page drafts remain intact. This is display-only: no page refresh, inbox sync, AI requests or Firestore writes. Customer task rows re-sort using the new day too. Dashboard heading and admin sidebar build stamp explicitly show Hong Kong time/HKT. Existing due-date strings stay as chosen; timestamp-based carried follow-ups use the Hong Kong calendar date. No storage/schema/rules/auth changes.

## Validation

Seven new fast tests cover timer sharing, exact midnight, all three wake events and cleanup, backwards clock correction, identical Hong Kong cutoffs across UTC/Sydney/New York/Los Angeles including DST transition dates, due-date versus timestamp handling, and leap/year boundaries. Five real-page emulator cases cover midnight/focus/pageshow/visibility/watchdog with both pages mounted, including native/carried tasks, Waiting, exclusions, an open editor, filters, label/order synchronization and unchanged stored data. The current suite runs 20 full cases plus 11 count/calendar cases each in UTC, Sydney and Los Angeles (53 executions). Existing GitHub Actions invokes both suites.

Actual-browser fictional proof uses the real Dashboard and real browser timers with a local-only simulated Hong Kong calendar. Before: Saturday17Oct, total1 = 0 overdue + 1 today. After crossing Hong Kong midnight without refresh/navigation: Sunday18Oct, total2 = 1 overdue + 1 today; the old Today task moved to Overdue and tomorrow’s task moved to Today. No runtime errors. Screenshots live in `/Users/eddie/.codex/visualizations/2026/10/14/01a13b22-c93b-79f2-9f8b-551754486033/dashboard-midnight-release-2026-10-17/`. Clock controls exist only in QA, never in the shipped app.

## Local checks — PASS

Hong Kong revision source `32f2808ff4a4e3ae322fd829435ca58c9bcf378d` includes the automatic-clock change `5f13c3881a968c4e620d81bb1b6b6bc54f09af53`. Production build passed all 500 prebuild checks (272 Node tests +228 standalone assertions); workspace suite60, served-login config suite11, no-undef lint and whitespace checks passed. All 53 real-page executions passed (20 full +11 each under UTC/Sydney/Los Angeles). Seven new fast calendar/time tests include UTC/Sydney/New York/Los Angeles device-zone independence.

The Hong Kong browser proof specifically crossed 15:59:58→16:00 UTC (23:59:58→00:00 HKT) with real browser timers. Header changed to “Sunday, 18 October 2026 · Hong Kong time”; tile changed1→2, with Today and Overdue each1. No reload, navigation or runtime error. `hkt-before-midnight.png` and `hkt-after-midnight.png` retain the proof. The app has no clock-control/test-date entry point.

## Candidate — PASS

Candidate `6ad360b0fb63345685268c0f`, served `/assets/index-fyyP_5ix.js`, source `32f2808ff4a4e3ae322fd829435ca58c9bcf378d`. Firebase configuration probe200. Sidebar “V8.18 · 17 Oct, 19:47 HKT”, Dashboard “Saturday, 17 October 2026 · Hong Kong time”. Tile3 = 3 overdue /0 today, both group headings correct after refresh. No live task edits in this release.

Fresh email/password role checks passed in separate clean login tabs:

- Admin `claude-qa@crystocraft.com`: OC Dashboard, Settings/Portal, 297 Range products /722 SKUs, QA customer workspace with eight completed/archived items and no outstanding work, refresh and empty authenticated runtime error log.
- Approved customer `customer-qa@crystocraft.com`: expected QA wholesale company, `/shop`, 295 designs, Mini Butterfly Music Box detail (Chrome USD12.51 /Gold USD12.84; ~9 weeks /MOQ100), refresh and empty authenticated runtime error log. Settings/Add task absent, `/dashboard` redirected to `/shop`.

Candidate screenshots saved alongside the Hong Kong calendar proof. Branch Actions passed: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39030115527 .

## Production — PASS

Published `6ad36175cc902c220f93b1f1` at **17 October 2026 19:53:25 HKT** (11:53:25 UTC), from source `32f2808ff4a4e3ae322fd829435ca58c9bcf378d`. Served `/assets/index-DLbE_UJR.js`, Firebase probe200. Sidebar “V8.18 · 17 Oct, 19:52 HKT”; Dashboard explicitly “Saturday, 17 October 2026 · Hong Kong time”. Main Actions completed successfully: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39030339404 .

Fresh email/password sign-ins passed on https://portal.crystocraft.com:

- Admin `claude-qa@crystocraft.com`: correct OC Dashboard, Settings/Portal navigation. Tile3 = 3 overdue /0 today; open sections agree; date and counts preserved after refresh. Range297 products /722 SKUs and QA CRM workspace loaded; QA work remains eight completed/archived items with nothing outstanding. Authenticated error log empty.
- Approved customer `customer-qa@crystocraft.com`: correct QA wholesale company and customer `/shop` shell; Range295 designs, real Mini Butterfly Music Box detail, Chrome USD12.51 /Gold USD12.84, ~9 weeks /MOQ100, refresh persistence. Settings/Add task absent; direct `/dashboard` redirected to `/shop`. Authenticated error log empty.

Per-role candidate/production screenshots and HKT rollover proof are saved in the evidence folder above. Actual midnight/wake behavior was exercised in deterministic real-page emulator tests and the fictional browser fixture; live production was not held open until midnight or given a simulated clock. No test clock is shipped in the app.

Both QA sessions signed out. No live task/note/customer/Pipeline/product writes or AI calls were made for this release; normal real sign-ins may stamp activity. No Firestore/Storage deployment was needed. Rules hashes remain `92e35cd019e7be61a4f676131bcffad72c7b56e0cba427f52225cb89992b2468` / `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`. Primary dirty checkout is unchanged (porcelain SHA256 `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`); owner browser untouched. Docs-only evidence is pushed with `[skip netlify]`, preserving this verified production app.
