# Automatic Today / Overdue rollover

17 October 2026, Australia/Sydney. Owner authorized implementation, regression tests and deployment, then specified Hong Kong time for the OC. The initial local-time draft candidate was not published; this revision uses Hong Kong time.

## Fix

Previously the date was computed during render only, so an idle open page could keep yesterday’s date until another update or refresh. Dashboard and CustomerWorkspace now use `useOcToday` backed by one shared OC day store. It schedules the next **Hong Kong midnight (UTC+8)**, regardless of device timezone or daylight-saving changes elsewhere. Focus, pageshow and visibility return catch up after sleep or background throttling. A single one-minute watchdog handles foreground system clock changes. Same-day ticks do not notify/render every customer. Timers/listeners start with the first subscriber and stop with the last.

Counts, subtotals, already-open Today/Overdue sections, task labels, ordering and Dashboard date update together. Filters, conversation window and unsaved customer-page drafts remain intact. This is display-only: no page refresh, inbox sync, AI requests or Firestore writes. Customer task rows re-sort using the new day too. Dashboard heading and admin sidebar build stamp explicitly show Hong Kong time/HKT. Existing due-date strings stay as chosen; timestamp-based carried follow-ups use the Hong Kong calendar date. No storage/schema/rules/auth changes.

## Validation

Seven new fast tests cover timer sharing, exact midnight, all three wake events and cleanup, backwards clock correction, identical Hong Kong cutoffs across UTC/Sydney/New York/Los Angeles including DST transition dates, due-date versus timestamp handling, and leap/year boundaries. Five real-page emulator cases cover midnight/focus/pageshow/visibility/watchdog with both pages mounted, including native/carried tasks, Waiting, exclusions, an open editor, filters, label/order synchronization and unchanged stored data. The current suite runs 20 full cases plus 11 count/calendar cases each in UTC, Sydney and Los Angeles (53 executions). Existing GitHub Actions invokes both suites.

Actual-browser fictional proof uses the real Dashboard and real browser timers with a local-only simulated Hong Kong calendar. Before: Saturday17Oct, total1 = 0 overdue + 1 today. After crossing Hong Kong midnight without refresh/navigation: Sunday18Oct, total2 = 1 overdue + 1 today; the old Today task moved to Overdue and tomorrow’s task moved to Today. No runtime errors. Screenshots live in `/Users/eddie/.codex/visualizations/2026/10/14/01a13b22-c93b-79f2-9f8b-551754486033/dashboard-midnight-release-2026-10-17/`. Clock controls exist only in QA, never in the shipped app.

Candidate and production release checks will be appended after verification. Primary dirty checkout preserved; Firestore/Storage rules unchanged.
