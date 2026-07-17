-- Refresh the materialized read-layer views. Run after each ERP sync so the
-- app sees current data. sync.py runs this automatically on a clean finish.
-- CONCURRENTLY keeps the view readable during the refresh (needs the unique
-- index created in api_views.sql).
refresh materialized view concurrently public.erp_item;
