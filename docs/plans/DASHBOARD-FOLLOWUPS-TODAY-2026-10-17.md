# Follow-ups Due — Today and Overdue

17 October 2026, Australia/Sydney. Owner requested implementation, regression updates and deployment.

## Behavior

Follow-ups Due counts unfinished tasks due **on or before the browser’s local today**, including Waiting and carried interaction follow-ups. The tile displays total and separate overdue/today counts. Clicking it opens separate Overdue and Today task sections, with independent empty states. Future/undated tasks, completed tasks and notes remain excluded. Category/retail filters apply to both groups. Conversation window does not affect them. No customer records, task storage, permissions or AI behavior are migrated.

## Regression coverage

The real Dashboard and CustomerDetail remain mounted together against local Firestore. Fifteen cases include six count cases repeated in UTC and Australia/Sydney at the same instant on different local dates (27 executions). Checks include creating from either page, rescheduling through past/today/future/undated, Waiting, completion/reopening, carried follow-ups, customer/category/retail isolation, notes and completed exclusions, remount persistence, and the already-open tile/group agreement. A task moving between Today and Overdue must change only subtotals, from either page. Existing GitHub Actions emulator job invokes the updated suite.

Fictional desktop and 375px browser preview uses the actual Dashboard, shows one overdue and one today task, and makes no live reads/writes. Mobile viewport/content both 375px.

Release validation and deploy evidence will be recorded after candidate and production checks. Firebase rules are unchanged; primary dirty checkout is preserved.
