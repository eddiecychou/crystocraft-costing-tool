-- Curated read layer for the app (Phase 1: customer + supplier lookup).
-- Clean, typed views over the raw ERP mirror. The app never queries raw.* —
-- only these views, and only via the server-side /api/erp edge function
-- (service_role). Views live in `public` but are granted to service_role only,
-- so the browser's anon key cannot read them.
--
-- Re-run this file anytime (idempotent). After changing a view, the NOTIFY at
-- the bottom refreshes PostgREST so the REST API sees the change.

-- ── Customers ────────────────────────────────────────────────────────────────
create or replace view public.erp_customer as
select
  ctcode                                            as code,
  nullif(ctrefcode, '')                             as ref_code,
  ctdesc1                                           as name,
  nullif(ctdesc2, '')                               as short_name,
  nullif(ctcontact, '')                             as contact,
  nullif(ctphone1, '')                              as phone,
  nullif(ctfax1, '')                                as fax,
  nullif(ctemail1, '')                              as email,
  nullif(ctmobile1, '')                             as mobile,
  nullif(ctcurr, '')                                as currency,
  nullif(ctcountry, '')                             as country,
  nullif(ctcity, '')                                as city,
  nullif(ctsalesteam, '')                           as sales_team,
  nullif(ctwebsite, '')                             as website,
  nullif(regexp_replace(ctaddress, '\r+', ', ', 'g'), '') as address,
  (coalesce(nullif(expired, ''), 'F') <> 'T')       as active,
  nullif(lastupdate, '')::timestamp                 as last_update
from raw.customer;

-- ── Suppliers ────────────────────────────────────────────────────────────────
create or replace view public.erp_supplier as
select
  sucode                                            as code,
  nullif(surefcode, '')                             as ref_code,
  sudesc1                                           as name,
  nullif(sudesc2, '')                               as short_name,
  nullif(sutype, '')                                as type,
  nullif(sucontact, '')                             as contact,
  nullif(suphone1, '')                              as phone,
  nullif(sufax1, '')                                as fax,
  nullif(suemail1, '')                              as email,
  nullif(sumobile1, '')                             as mobile,
  nullif(sucurr, '')                                as currency,
  nullif(sucountry, '')                             as country,
  nullif(sucity, '')                                as city,
  nullif(suwebsite, '')                             as website,
  nullif(regexp_replace(suaddress, '\r+', ', ', 'g'), '') as address,
  (coalesce(nullif(expired, ''), 'F') <> 'T')       as active,
  nullif(lastupdate, '')::timestamp                 as last_update
from raw.supplier;

-- ── Item master (Phase 2) ────────────────────────────────────────────────────
-- Item is a revision-HISTORY table: ~1.4M rows but only ~44k distinct codes
-- (avg ~32 revisions each). A master lookup wants the LATEST revision per code,
-- so we expose that as a MATERIALIZED VIEW — small (~44k rows), indexed, fast.
-- Refresh it after each sync (refresh_views.sql / sync.py does this on success).
-- Cost columns are included; /api/erp is admin-only so they never reach non-admins.
create extension if not exists pg_trgm;
drop index if exists ix_item_code_trgm;       -- from an earlier iteration; search is on the matview now
drop index if exists ix_item_sdesc_trgm;
drop view if exists public.erp_item;
drop materialized view if exists public.erp_item;

create materialized view public.erp_item as
select distinct on (itcode)
  itcode                                            as code,
  nullif(itrefcode, '')                             as ref_code,
  nullif(ittype, '')                                as type,
  nullif(itprodtype, '')                            as prod_type,
  nullif(itshortdesc1, '')                          as name,
  nullif(itlongdesc1, '')                           as description,
  nullif(italloy, '')                               as alloy,
  nullif(itstonetype, '')                           as stone_type,
  nullif(ituom, '')                                 as uom,
  (coalesce(nullif(ithasbom, ''), 'N') in ('Y', 'T', '1')) as has_bom,
  nullif(itdesignno, '')                            as design_no,
  nullif(itbarcode, '')                             as barcode,
  nullif(itrevision, '')::int                       as revision,
  nullif(ittotalweight, '')::numeric                as weight_g,
  nullif(itacost, '')::numeric                      as a_cost,
  nullif(itbcost, '')::numeric                      as b_cost,
  nullif(itccost, '')::numeric                      as c_cost,
  nullif(itsrp, '')::numeric                        as srp,
  nullif(itlabourcost, '')::numeric                 as labour_cost,
  nullif(ittotalmetalcost, '')::numeric             as metal_cost,
  nullif(ittotalstonecost, '')::numeric             as stone_cost,
  nullif(ittotaladdcost, '')::numeric               as add_cost,
  (coalesce(nullif(expired, ''), 'F') <> 'T')       as active,
  nullif(lastupdate, '')::timestamp                 as last_update
from raw.item
order by itcode, nullif(itrevision, '')::int desc nulls last;

create unique index if not exists ux_erp_item_code    on public.erp_item (code);              -- enables REFRESH … CONCURRENTLY
create index        if not exists ix_erp_item_code_trg on public.erp_item using gin (code gin_trgm_ops);
create index        if not exists ix_erp_item_name_trg on public.erp_item using gin (name gin_trgm_ops);

-- ── Access: server-side only. Browser (anon) must NOT read these. ────────────
revoke all on public.erp_customer, public.erp_supplier, public.erp_item from anon, authenticated;
grant select on public.erp_customer, public.erp_supplier, public.erp_item to service_role;

-- Refresh PostgREST's schema cache so /rest/v1/erp_customer etc. appear.
notify pgrst, 'reload schema';
