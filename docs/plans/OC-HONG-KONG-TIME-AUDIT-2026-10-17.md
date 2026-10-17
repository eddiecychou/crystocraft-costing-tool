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

Release evidence follows after candidate and production checks. No rules deployment planned; dirty primary checkout preserved.
