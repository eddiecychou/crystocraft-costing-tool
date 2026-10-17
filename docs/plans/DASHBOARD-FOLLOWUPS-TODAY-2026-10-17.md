# Follow-ups Due — Today and Overdue

17 October 2026, Australia/Sydney. Owner requested implementation, regression updates and deployment.

## Behavior

Follow-ups Due counts unfinished tasks due **on or before the browser’s local today**, including Waiting and carried interaction follow-ups. The tile displays total and separate overdue/today counts. Clicking it opens separate Overdue and Today task sections, with independent empty states. Future/undated tasks, completed tasks and notes remain excluded. Category/retail filters apply to both groups. Conversation window does not affect them. No customer records, task storage, permissions or AI behavior are migrated.

## Regression coverage

The real Dashboard and CustomerDetail remain mounted together against local Firestore. Fifteen cases include six count cases repeated in UTC and Australia/Sydney at the same instant on different local dates (27 executions). Checks include creating from either page, rescheduling through past/today/future/undated, Waiting, completion/reopening, carried follow-ups, customer/category/retail isolation, notes and completed exclusions, remount persistence, and the already-open tile/group agreement. A task moving between Today and Overdue must change only subtotals, from either page. Existing GitHub Actions emulator job invokes the updated suite.

Fictional desktop and 375px browser preview uses the actual Dashboard, shows one overdue and one today task, and makes no live reads/writes. Mobile viewport/content both 375px.

## Local and candidate verification — PASS

Source commit `4578c1f4f9a9feb5437c35be2ba9430597bcd869`. Production build passed all 493 prebuild checks (265 Node tests and 228 standalone assertions); workspace fast suite 53, Firebase config suite 11, no-undef lint and whitespace checks passed. All 27 integration executions passed (15 full + six UTC + six Sydney). The updated existing Actions job passed on the release branch: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39028691599 .

Candidate `6ad35b6be5225925b04a8f66`, served `/assets/index-wkUjRKIs.js`, sidebar V8.18 /17 Oct22:24. Firebase served-bundle probe returned 200. Fresh email/password sign-ins passed:

- Admin `claude-qa@crystocraft.com`: Dashboard, Settings/Portal navigation, 297 Range products /722 SKUs, refresh and authenticated runtime passed.
- Approved customer `customer-qa@crystocraft.com`: QA wholesale company, 295 designs, Mini Butterfly Music Box Chrome USD12.51 / Gold USD12.84, ~9 weeks /MOQ100, refresh and authenticated runtime passed. Settings/task controls absent; `/dashboard` redirected to `/shop`.

Only the dedicated `qa_customer_release_testing` company received two labelled test tasks: one yesterday and one today/Waiting. The live tile rose from 3 (3 overdue/0 today) to 5 (4 overdue/1 today). Each QA task appeared once in its correct group, and refresh preserved totals. Existing real-customer tasks were not edited. Separate clean-tab checks had no authenticated runtime errors. The initial shared-role tab logged a listener permission error when admin signed out; isolated per-role fresh tests were repeated and passed with empty error logs.

## Production verification — PASS

Published `6ad35ca693f5ef7050ea10c7` from source `4578c1f4f9a9feb5437c35be2ba9430597bcd869` at 17 October 2026 **22:32:55 AEDT** (11:32:55 UTC). Served bundle `/assets/index-C5GWy6Fm.js`; Firebase probe 200. Main GitHub Actions passed: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39029048612 .

Fresh email/password admin and approved-customer sign-ins passed on https://portal.crystocraft.com:

- Admin: expected OC Dashboard, Settings/admin navigation and 297 products /722 SKUs. Dashboard refresh preserved correct counts. Authenticated runtime error log empty. QA-only customer tasks loaded and stayed synchronized across the simultaneously mounted Dashboard and customer page.
- Approved customer: expected QA wholesale company and `/shop`, 295 designs, Mini Butterfly Music Box price/lead-time/MOQ data, product refresh persistence. Settings/Add task absent; direct `/dashboard` redirected to `/shop`. Authenticated runtime error log empty.

Live QA task evidence:

1. Initial tile/group count 5 = 4 overdue + 1 today; each labelled QA task in the correct section.
2. Complete Today task on Dashboard: 4 = 4 overdue + 0 today; customer page shows it completed.
3. Reopen on customer page: 5 = 4 overdue + 1 today, without Dashboard reload.
4. Move QA overdue task to today on customer page: total stays 5, split becomes 3 overdue + 2 today; both QA rows in Today and neither in Overdue.
5. Complete both QA tasks on Dashboard: 3 = 3 overdue + 0 today, preserved after refresh. Customer page shows **no outstanding tasks or notes**, eight completed/archived QA items. No real-customer tasks, notes, interactions or Pipeline decisions changed. No hard deletion.

QA sessions signed out, owner browser unchanged. Evidence screenshots in `/Users/eddie/.codex/visualizations/2026/10/14/01a13b22-c93b-79f2-9f8b-551754486033/followups-today-release-2026-10-17/`: candidate/production admin QA tasks and catalogue, customer product page, QA cleanup, plus fictional desktop/mobile grouping previews. The final shared screenshot is fictional to avoid exposing real customer follow-ups.

## State and boundaries

App pushed to main and deployed. Firebase Firestore/Storage rules are unchanged and were not deployed. Hashes remain `92e35cd019e7be61a4f676131bcffad72c7b56e0cba427f52225cb89992b2468` / `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`. Dirty primary checkout untouched (porcelain SHA256 `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`). No imports, catalogue writes or AI runs. Docs-only release evidence commit uses `[skip netlify]`, preserving the verified production build.
