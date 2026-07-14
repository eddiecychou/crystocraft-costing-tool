-- ─────────────────────────────────────────────────────────────────────────────
-- Post-sync validation. Run these after each table sync. Edit the table names
-- to match what you actually synced. Run the "source" query on the ERP (MSSQL)
-- and the "target" query on Supabase, then compare.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. ROW COUNTS ───────────────────────────────────────────────────────────────
-- Source (run on MSSQL):
--   SELECT COUNT(*) FROM dbo.Customer;
-- Target (run on Supabase):
SELECT 'customer' AS table_name, COUNT(*) AS rows FROM raw."customer";
-- For a `full` table these must match exactly. For `incremental`, target >= the
-- rows seen so far (it accumulates). sync.py also logs both numbers each run.


-- 2. DUPLICATE PRIMARY KEYS (should return ZERO rows) ─────────────────────────
-- Catches a wrong `pk` in tables.yaml.
SELECT customerid, COUNT(*)
FROM raw."customer"
GROUP BY customerid
HAVING COUNT(*) > 1;


-- 3. NULL PRIMARY KEYS (should be 0) ──────────────────────────────────────────
SELECT COUNT(*) AS null_pks FROM raw."customer" WHERE customerid IS NULL;


-- 4. ORPHANED FOREIGN KEYS (detail rows with no matching header) ──────────────
-- Adjust table/column names to a real parent/child pair in your ERP.
-- SELECT d.orderno
-- FROM raw."salesorderdetail" d
-- LEFT JOIN raw."salesorderheader" h ON h.orderno = d.orderno
-- WHERE h.orderno IS NULL;


-- 5. SAMPLE RECORD SPOT-CHECK ─────────────────────────────────────────────────
-- Pick a few keys you recognise and eyeball them on BOTH sides. Pay special
-- attention to Chinese-text columns — garbled characters here mean a source
-- encoding/collation issue to fix before syncing more tables.
SELECT * FROM raw."customer" WHERE customerid IN ('C001', 'C002', 'C003');


-- 6. LAST-RUN STATUS (from the sync's own bookkeeping) ────────────────────────
SELECT table_name, row_count, last_watermark, last_run_at
FROM meta.sync_state
ORDER BY last_run_at DESC;
