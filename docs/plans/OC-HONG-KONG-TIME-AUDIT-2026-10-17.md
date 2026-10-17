# OC-wide Hong Kong time audit

17 October 2026. Owner authorized the remaining OC audit, tests and deployment.

## Findings and implementation

Audited 74 human-date display call sites across51 files, plus current-date defaults, filters, year selection and import parsing. Shared Hong Kong helpers now cover CRM/marketing correspondence and AI-summary date labels, Pipeline review records, supplier/product/stock records, portal sign-in/invitation activity, ERP/SEO/Woo sync status, Product Design projects, quote/catalogue/invoice/credit-note/packing/PO PDFs and Excel/CSV date display and filenames. Shared customer invoice/order views benefit too. Numeric/currency locale formatting is unchanged.

All explicit-offset timestamps remain the same instant; Firestore timestamps and machine ISO wire/audit values remain UTC. No database backfill, bulk correction or source-data rewrite. Chosen invoice/quote/PO/task/date-only strings remain the same calendar date. OC/ERP ISO wall times without an offset are interpreted as Hong Kong time, rather than whichever computer opens them. Legacy date-only interactions round-trip through HKT midnight when explicitly edited, preserving the selected day.

Current-date defaults (quotes, credit notes, purchase orders, freight, stock movements, imports and exports) use the Hong Kong business day. Credit-note defaults are evaluated when a form opens rather than at module load. SO/PU/UC year selection uses the Hong Kong year. Woo's previous-month filter uses Hong Kong month boundaries and handles leap years/year rollover. CSV filters include the complete Hong Kong calendar day. Dashboard New Orders uses30 Hong Kong calendar days including today, excludes future dates. Portal today/yesterday/activity-day buckets use Hong Kong days. Elapsed-time windows, security expiries and stored timestamps are unchanged.

The existing manual WhatsApp parser was device-local despite its documented Hong Kong iPhone export format. New parsing uses UTC+8 and the import screen states that assumption. Existing conversations are not rewritten; the existing overlap review remains in force. Existing source-provided Woo/ERP accounting date strings remain date-only business facts. Existing UTC calendar-only +2-day Woo ship-date arithmetic is retained.

## Regression and visual evidence

Seven cross-zone cases use UTC, Sydney, Los Angeles and Hong Kong devices. They check midnight/year/month/leap boundaries, date-only versus timestamp meaning, explicit-offset preservation, empty/invalid values, date/time formatting, inclusive CSV date ranges, current 30-day window, AI evidence dates, actual SO/PU year functions and the real QuotePDF tree. Source guard prevents new device-local formatter/getter/UTC-today bypasses. All71 existing WhatsApp parser/fingerprint/overlap/media/migration/checkpoint checks pass with HKT parsing. `test:oc-time` runs in prebuild and both branch/main GitHub Actions.

The existing real Dashboard/CustomerDetail emulator suite remains the integration check for task sync, midnight/wake updates, editor preservation and no calendar-triggered writes (53 executions across device timezones). Existing PDF/Excel/unit/remark/search/AI/security-related prebuild suites also run.

Rendered the actual mixed-unit QuotePDF to `/private/tmp/oc-hkt-quote.pdf`, rasterized and visually inspected page1: entered15 October2026 remains15 October2026; quantities/units, columns, totals and footer remain legible and aligned. No live data used.

## Local and branch verification — PASS

Final source `bd3032c1be9556c8660be31c7a60361e574aba81` (audit implementation `977b94c1402f2bb3c53792b10e67720b3d4a4ba2` plus legacy month-name/slash parsing correction). Production build passed578 prebuild checks (279 Node cases +299 standalone assertions), no-undef lint, whitespace checks and11 Firebase config tests. The real-page sync suite passed53 local executions; the final source also passed the complete branch Actions jobs, including that suite: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39031549525 .

No direct device-local date/time formatters/calendar getters or UTC-derived today defaults remain in UI/domain source outside the shared policy. UTC full timestamps for storage/security/wire payloads and documented calendar-only UTC arithmetic remain intentional.

## Candidate — PASS

Final candidate `6ad3660384d84bed4c548763`, served `/assets/index-7WJefeFz.js`, sidebar V8.18 /17Oct20:11HKT. Served Firebase configuration probe200.

Fresh real-page email/password sign-ins in separate clean tabs:

- Admin `claude-qa@crystocraft.com`: expected OC Dashboard, Settings/Portal,3 follow-ups (3 overdue/0 today),13 New Orders,297 Range products /722 SKUs, refresh and empty authenticated runtime error log. Portal Login activity filtered to only the QA admin displayed `17 Oct 2026, 20:13` for the fresh sign-in, matching independently checked `12:13 UTC` /20:13HKT. No other account changed.
- Approved customer `customer-qa@crystocraft.com`: expected QA wholesale company, customer `/shop`,295 designs, Mini Butterfly Music Box Chrome USD12.51 /Gold USD12.84 and ~9 weeks /MOQ100, product refresh and empty authenticated runtime error log. No Settings/Add task controls; direct `/dashboard` redirected to `/shop`.

Per-role screenshots and the rendered PDF evidence are in `/Users/eddie/.codex/visualizations/2026/10/14/01a13b22-c93b-79f2-9f8b-551754486033/oc-wide-hkt-release-2026-10-17/`. Candidate QA sessions signed out after verification.

## Production evidence

Published `6ad366e4b56825e4ed6dda61` from final source `bd3032c1be9556c8660be31c7a60361e574aba81` on17 October2026 at20:16:38HKT (12:16:38UTC). Served bundle `/assets/index-uiqxPjur.js`; Firebase configuration probe200; sidebar V8.18 /17Oct20:15HKT. Main Actions passed: https://github.com/eddiecychou/crystocraft-costing-tool/actions/runs/39031816115 .

Fresh production admin email/password sign-in passed: correct OC Dashboard/Settings/Portal,3 follow-ups (3 overdue/0 today),13 New Orders,297 products /722 SKUs, refresh persistence and empty authenticated runtime error log. Filtered Login activity for the QA admin displayed17Oct2026 20:17HKT for the new sign-in, matching the independently checked12:17UTC clock. Screenshot saved as `production-admin-activity.png`.

Fresh production approved-customer email/password sign-in passed: expected QA company and `/shop` shell,295 designs, actual Mini Butterfly Music Box Chrome USD12.51 /Gold USD12.84 and ~9 weeks /MOQ100, product refresh persistence and empty authenticated runtime error log. Settings/Add task absent; direct `/dashboard` redirected to `/shop`. Screenshots saved. Both QA sessions signed out.

## State and boundaries

Application source pushed to main and production verified. Per-role checks passed on candidate AND current production. Rules were not deployed or changed: Firestore SHA256 `92e35cd019e7be61a4f676131bcffad72c7b56e0cba427f52225cb89992b2468`, Storage `94981d875ec150038619275c387f20d3a2b8ea021e53ecb3130ee66a2700828c`. Original dirty checkout unchanged (porcelain SHA256 `fca5caf4923d0a7794ceaf571996019e4fea9602f75851e7f413dad1240bf846`). Owner browser untouched.

No live customer/task/note/Pipeline/product/financial writes, imports or AI runs were performed during verification. Normal fresh QA sign-ins stamp account activity; these are the only routine test writes. No historical timestamps, issued document dates/numbers or accounting dates were migrated. Docs-only evidence follow-up uses `[skip netlify]` to preserve the verified app build.
