> Superseded definition: Follow-ups Due now includes today as well as overdue. See [the Today + Overdue release](DASHBOARD-FOLLOWUPS-TODAY-2026-10-17.md). The earlier checks below record the previous overdue-only behavior.

# Dashboard Follow-ups Due regression checks — 17 October 2026

## Result and count definition

No application fault found. The existing tile counts overdue, unfinished tasks
(due_on before local today), per task rather than per customer. Waiting remains
unfinished. Today, future, undated, completed and reference-note records do not
count. Legacy dated interaction follow-ups remain actionable regardless of age.
Customer category/retail filters apply; summary period does not.

## Added coverage

Six new cases extend the existing real Dashboard + CustomerDetail emulator suite:

- Native task lifecycle from either page: create overdue, reschedule today/future/
  undated/past, Waiting, complete, reopen overdue or future, remount persistence.
  Adding notes does not alter the count.
- Legacy follow-up lifecycle from either page alongside a native task for the same
  customer. Checks totals of two, not one, and preserves original interaction
  content/date/status/attachments without creating duplicate carried task records.
- Already-open overdue drilldown stays equal to the tile as tasks are added,
  rescheduled, completed or reopened from either page. Rescheduling the last
  overdue task in its own editor correctly removes that workspace and yields zero.
- Customer category/retail filters, distinct tasks for one customer, selected
  customers outside the filters, completed tasks, dated reference notes,
  summary-period changes and filter changes while the drilldown is open.

All observations use real page components, subscriptions, transactions and rules
on the loopback emulator. Counts are read from the real tile and list; the test
harness does not copy the counting predicate. No live test records or writes.

## Calendar and CI

The bundle's page calendar is fixed to 2026-10-17 13:30 UTC. SDK/network timers
and polling use the real clock. Six count cases run again under UTC (today 17 Oct)
and Sydney (today 18 Oct), asserting the different local dates. No production
clock code changes. The harness accepts removal of a detached editor after a
successful reschedule; the next assertion verifies both actual tile and panel.

`npm run test:workspace-sync` now runs all 15 real-page tests and then the six
count cases in each timezone (27 executions). The existing GitHub Actions emulator
job already invokes that command, so future source/QA/workflow changes run them.
No application deployment or Firebase rules deployment is part of this test-only
change. Existing dirty original checkout remains untouched.

## Local verification — PASS

All 15 real-page tests pass. All six count cases pass in UTC and in Sydney
(27 total executions, including the original nine sync tests). The page/drilldown
and both-day-boundary checks pass without any production code change. Existing
workspace tests, syntax and whitespace checks pass. All data stayed in the local
emulator; the primary dirty checkout remains untouched.

## GitHub Actions — PASS

Test revision `b1904a253f6c2346af1864bee72003fe26fd68b8` is pushed to main and
the working branch. Both full workflows passed, including the existing security,
customer workflows, Product Design and all count/timezone cases:

- Main: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39028175078
- Branch: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39028174955

The test commit used [skip netlify]. Production remains deploy
`6ad348169572266f246d358f`, app source `5e68a07a`. No application/rules deployment,
production logic change, live test records or live writes were needed.
Original dirty checkout status SHA-256 unchanged:
`fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`.
