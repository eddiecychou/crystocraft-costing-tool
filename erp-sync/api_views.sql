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

-- ── Access: server-side only. Browser (anon) must NOT read these. ────────────
revoke all on public.erp_customer, public.erp_supplier from anon, authenticated;
grant select on public.erp_customer, public.erp_supplier to service_role;

-- Refresh PostgREST's schema cache so /rest/v1/erp_customer etc. appear.
notify pgrst, 'reload schema';
