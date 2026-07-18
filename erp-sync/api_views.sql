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
-- Drop erp_item whether it currently exists as a plain view or a matview.
do $$
declare k "char";
begin
  select relkind into k from pg_class
   where relname = 'erp_item' and relnamespace = 'public'::regnamespace;
  if k = 'm' then execute 'drop materialized view public.erp_item cascade';
  elsif k = 'v' then execute 'drop view public.erp_item cascade';
  end if;
end $$;

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

-- ── BOM (Phase 3) ────────────────────────────────────────────────────────────
-- raw.itemdetail is the single-level BOM, revisioned (~10.3M rows). erp_bom
-- collapses it to the CURRENT BOM = the lines of each parent's latest revision.
-- explode_bom() then walks it recursively for a full multi-level explosion.
drop materialized view if exists public.erp_bom cascade;

create materialized view public.erp_bom as
with latest as (
  select iditemcode, max(nullif(idrevision, '')::int) as rev
  from raw.itemdetail
  where idsubitemcode is not null and idsubitemcode <> ''
  group by iditemcode
)
select
  d.iditemcode                        as parent_code,
  d.idsubitemcode                     as component_code,
  nullif(d.iditemtype, '')            as component_type,
  coalesce(nullif(d.idqty, '')::numeric, 0) as qty,
  l.rev                               as revision
from raw.itemdetail d
join latest l
  on l.iditemcode = d.iditemcode
 and nullif(d.idrevision, '')::int = l.rev
where d.idsubitemcode is not null and d.idsubitemcode <> '';

create index if not exists ix_erp_bom_parent on public.erp_bom (parent_code);

-- Recursive multi-level explosion of one item. ext_qty = product of quantities
-- down the path. is_assembly = the component itself has a BOM (expandable).
-- Cycle-guarded (path membership) and depth-capped at 20.
create or replace function public.explode_bom(p_code text)
returns table (
  level int, parent_code text, component_code text, component_type text,
  qty numeric, ext_qty numeric, is_assembly boolean, path text[]
) language sql stable as $$
  with recursive tree as (
    select 1 as level, b.parent_code, b.component_code, b.component_type,
           b.qty, b.qty as ext_qty, array[b.parent_code, b.component_code] as path
    from public.erp_bom b
    where b.parent_code = p_code
    union all
    select t.level + 1, b.parent_code, b.component_code, b.component_type,
           b.qty, t.ext_qty * b.qty, t.path || b.component_code
    from public.erp_bom b
    join tree t on b.parent_code = t.component_code
    where t.level < 20 and not b.component_code = any(t.path)
  )
  select t.level, t.parent_code, t.component_code, t.component_type, t.qty, t.ext_qty,
         exists (select 1 from public.erp_bom c where c.parent_code = t.component_code) as is_assembly,
         t.path
  from tree t
  order by t.path;
$$;

-- ── Sales invoices & orders (Phase 4) ────────────────────────────────────────
-- Small header tables (~5k rows each) + their line details. Plain views (live
-- over raw); the header id is aliased to `code` to match the generic API/search.
create or replace view public.erp_sales_invoice as
select
  sino                                     as code,
  nullif(sistatus, '')                     as status,
  nullif(sidate, '')::timestamp            as date,
  nullif(sicustomer, '')                   as customer_code,
  nullif(sicustomername, '')               as customer,
  nullif(sicurrency, '')                   as currency,
  nullif(siamount, '')::numeric            as amount,
  nullif(sidiscamount, '')::numeric        as discount,
  nullif(sidepositamount, '')::numeric     as deposit,
  nullif(sipono, '')                       as customer_po,
  nullif(siref, '')                        as ref,
  nullif(sisalesperson, '')                as salesperson,
  nullif(sishipmentdate, '')::timestamp    as ship_date,
  nullif(sipaymentterms, '')               as payment_terms,
  nullif(lastupdate, '')::timestamp        as last_update,
  nullif(sigstamount, '')::numeric         as tax
from raw.salesinvoice;

create or replace view public.erp_sales_invoice_line as
select
  sdsino                          as invoice_no,
  nullif(sdseq, '')::int          as seq,
  nullif(sditemcode, '')          as item_code,
  nullif(sddesc, '')              as description,
  nullif(sditemtype, '')          as item_type,
  nullif(sdqty, '')::numeric      as qty,
  nullif(sdunitprice, '')::numeric as unit_price,
  nullif(sdlineamount, '')::numeric as amount,
  nullif(sdrefdocno, '')          as ref_doc
from raw.salesinvoicedetail;

create or replace view public.erp_sales_order as
select
  sono                                     as code,
  nullif(sostatus, '')                     as status,
  nullif(sodate, '')::timestamp            as date,
  nullif(sopcdeliverydate, '')::timestamp  as delivery_date,
  nullif(socustomer, '')                   as customer_code,
  nullif(socustomername, '')               as customer,
  nullif(socurrency, '')                   as currency,
  nullif(soamount, '')::numeric            as amount,
  nullif(sodiscamount, '')::numeric        as discount,
  nullif(sodepositamount, '')::numeric     as deposit,
  nullif(sopono, '')                       as customer_po,
  nullif(soref, '')                        as ref,
  nullif(sosalesperson, '')                as salesperson,
  nullif(soshipmentdate, '')::timestamp    as ship_date,
  nullif(sopaymentterms, '')               as payment_terms,
  nullif(lastupdate, '')::timestamp        as last_update
from raw.salesorder;

create or replace view public.erp_sales_order_line as
select
  sdsono                          as order_no,
  nullif(sdseq, '')::int          as seq,
  nullif(sditemcode, '')          as item_code,
  nullif(sddesc, '')              as description,
  nullif(sditemtype, '')          as item_type,
  nullif(sdqty, '')::numeric      as qty,
  nullif(sdunitprice, '')::numeric as unit_price,
  nullif(sdlineamount, '')::numeric as amount,
  nullif(sdshipdate, '')::timestamp as ship_date,
  nullif(sdrefno, '')             as ref
from raw.salesorderdetail;

-- Surcharge lines: freight / delivery / packing / credit-card / misc charges,
-- keyed by document. A document total = line subtotal − discount + surcharges
-- (+ tax, invoices only). qty×unit_price is the surcharge line amount.
create or replace view public.erp_sales_invoice_surcharge as
select
  sssino                          as invoice_no,
  nullif(ssseq, '')::int          as seq,
  nullif(sssurchargecode, '')     as code,
  nullif(ssdesc, '')              as description,
  coalesce(nullif(ssqty, '')::numeric, 1) * coalesce(nullif(ssunitprice, '')::numeric, 0) as amount
from raw.salesinvoicesurcharge;

create or replace view public.erp_sales_order_surcharge as
select
  sssono                          as order_no,
  nullif(ssseq, '')::int          as seq,
  nullif(sssurchargecode, '')     as code,
  nullif(ssdesc, '')              as description,
  coalesce(nullif(ssqty, '')::numeric, 1) * coalesce(nullif(ssunitprice, '')::numeric, 0) as amount
from raw.salesordersurcharge;

-- Index the line + surcharge FKs so fetching one header's detail is fast.
create index if not exists ix_sis_sino on raw.salesinvoicesurcharge (sssino);
create index if not exists ix_sos_sono on raw.salesordersurcharge (sssono);
create index if not exists ix_sid_sino on raw.salesinvoicedetail (sdsino);
create index if not exists ix_sod_sono on raw.salesorderdetail (sdsono);

-- ── Purchase orders (Phase 5) ────────────────────────────────────────────────
-- Same shape as sales but keyed to a supplier. Total = lines − discount +
-- surcharges + tax (pugstamount).
create or replace view public.erp_purchase as
select
  puno                                     as code,
  nullif(pustatus, '')                     as status,
  nullif(pudate, '')::timestamp            as date,
  nullif(puduedate, '')::timestamp         as due_date,
  nullif(pusupplier, '')                   as supplier_code,
  nullif(pusuppliername, '')               as supplier,
  nullif(pucurrency, '')                   as currency,
  nullif(puamount, '')::numeric            as amount,
  nullif(pudiscamount, '')::numeric        as discount,
  nullif(pudepositamount, '')::numeric     as deposit,
  nullif(puref, '')                        as ref,
  nullif(pusalesperson, '')                as buyer,
  nullif(pushipmentdate, '')::timestamp    as ship_date,
  nullif(pupaymentterms, '')               as payment_terms,
  nullif(lastupdate, '')::timestamp        as last_update,
  nullif(pugstamount, '')::numeric         as tax
from raw.purchase;

create or replace view public.erp_purchase_line as
select
  pdpuno                          as po_no,
  nullif(pdseq, '')::int          as seq,
  nullif(pditemcode, '')          as item_code,
  nullif(pddesc, '')              as description,
  nullif(pditemtype, '')          as item_type,
  nullif(pdqty, '')::numeric      as qty,
  nullif(pdqtygrn, '')::numeric   as qty_received,
  nullif(pdunitprice, '')::numeric as unit_price,
  nullif(pdlineamount, '')::numeric as amount,
  nullif(pdrefdocno, '')          as ref_doc
from raw.purchasedetail;

create or replace view public.erp_purchase_surcharge as
select
  pspuno                          as po_no,
  nullif(psseq, '')::int          as seq,
  nullif(pssurchargecode, '')     as code,
  nullif(psdesc, '')              as description,
  coalesce(nullif(psqty, '')::numeric, 1) * coalesce(nullif(psunitprice, '')::numeric, 0) as amount
from raw.purchasesurcharge;

create index if not exists ix_pd_puno on raw.purchasedetail (pdpuno);
create index if not exists ix_ps_puno on raw.purchasesurcharge (pspuno);

-- ── Inventory / stock on hand (Phase 6) ──────────────────────────────────────
-- Stock is computed from the MOVEMENT LEDGER (raw.itemtransaction), not from
-- raw.itemwhbal. itemwhbal looks like the obvious source but is a stale
-- snapshot: of its 8,599 non-zero rows, 8,368 have a null lastupdate and only
-- 25 were touched in 2026, and it disagrees with the ledger on exactly the
-- fast-moving warehouses (FWIP/FSTK). The ledger is live to the last sync,
-- internally consistent, and agrees with itemwhbal on 93.75% of a 400-row
-- sample — the disagreements being items that kept moving after the snapshot
-- went stale. See V7.15_ERP_Inventory.md.
--
-- itqtycal is signed (a sales invoice writes -800), so the running balance is
-- simply its sum. expired='T' rows (1,179 of 1.15M) are voided movements.
drop view if exists public.erp_warehouse;          -- depends on erp_stock, drop first
drop materialized view if exists public.erp_stock cascade;

create materialized view public.erp_stock as
select
  t.itwarehouse                                       as warehouse,
  t.itcode                                            as item_code,
  max(i.name)                                         as description,
  max(nullif(t.ititemtype, ''))                       as item_type,
  sum(coalesce(nullif(t.itqtycal, '')::numeric, 0))   as qty,
  -- Guard the date cast: the mirror is all `text` and holds junk dates
  -- (itembatchheader has a 4131 typo), so only aggregate ISO-looking values.
  max(case when t.itdate ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
           then nullif(t.itdate, '')::timestamp end)  as last_movement,
  count(*)                                            as movements
from raw.itemtransaction t
left join public.erp_item i on i.code = t.itcode
where coalesce(t.expired, 'F') <> 'T'
  and t.itwarehouse is not null and t.itwarehouse <> ''
group by t.itwarehouse, t.itcode;

-- Unique on the natural key so this can REFRESH … CONCURRENTLY too.
create unique index if not exists ux_erp_stock_wh_item on public.erp_stock (warehouse, item_code);
create index        if not exists ix_erp_stock_wh      on public.erp_stock (warehouse);
create index        if not exists ix_erp_stock_code_trg on public.erp_stock using gin (item_code gin_trgm_ops);
create index        if not exists ix_erp_stock_desc_trg on public.erp_stock using gin (description gin_trgm_ops);

-- Warehouse list for the picker. stock_items lets the UI show only warehouses
-- that actually hold something: 49 exist but only ~12 have any stock, and a
-- dropdown with 37 dead entries is worse than no dropdown. Defined AFTER
-- erp_stock because it reads from it.
create or replace view public.erp_warehouse as
select
  w.whcode                            as code,
  nullif(w.whdesc1, '')               as name,
  nullif(w.whdesc2, '')               as name_zh,
  nullif(w.whtype, '')                as type,
  nullif(w.whsbu, '')                 as sbu,
  coalesce(w.expired, 'F') <> 'T'     as active,
  nullif(w.lastupdate, '')::timestamp as last_update,
  coalesce(s.stock_items, 0)          as stock_items
from raw.warehouse w
left join (
  select warehouse, count(*) as stock_items
  from public.erp_stock where qty <> 0 group by warehouse
) s on s.warehouse = w.whcode;

-- ── Access: server-side only. Browser (anon) must NOT read these. ────────────
revoke all on public.erp_customer, public.erp_supplier, public.erp_item, public.erp_bom,
  public.erp_sales_invoice, public.erp_sales_invoice_line, public.erp_sales_invoice_surcharge,
  public.erp_sales_order, public.erp_sales_order_line, public.erp_sales_order_surcharge,
  public.erp_purchase, public.erp_purchase_line, public.erp_purchase_surcharge,
  public.erp_warehouse, public.erp_stock from anon, authenticated;
grant select on public.erp_customer, public.erp_supplier, public.erp_item, public.erp_bom,
  public.erp_sales_invoice, public.erp_sales_invoice_line, public.erp_sales_invoice_surcharge,
  public.erp_sales_order, public.erp_sales_order_line, public.erp_sales_order_surcharge,
  public.erp_purchase, public.erp_purchase_line, public.erp_purchase_surcharge,
  public.erp_warehouse, public.erp_stock to service_role;
revoke all on function public.explode_bom(text) from anon, authenticated;
grant execute on function public.explode_bom(text) to service_role;

-- Refresh PostgREST's schema cache so /rest/v1/erp_customer etc. appear.
notify pgrst, 'reload schema';
