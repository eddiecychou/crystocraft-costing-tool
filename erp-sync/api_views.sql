-- Curated read layer for the app (Phase 1: customer + supplier lookup).
-- Clean, typed views over the raw ERP mirror. The app never queries raw.* —
-- only these views, and only via the server-side /api/erp edge function
-- (service_role). Views live in `public` but are granted to service_role only,
-- so the browser's anon key cannot read them.
--
-- Re-run this file anytime (idempotent). After changing a view, the NOTIFY at
-- the bottom refreshes PostgREST so the REST API sees the change.

-- ── Customers ────────────────────────────────────────────────────────────────
-- Dropped rather than replaced: `create or replace view` can only APPEND
-- columns, and the detail fields below sit before active/last_update.
drop view if exists public.erp_customer cascade;
create view public.erp_customer as
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
  -- Detail-panel fields. Only columns with real coverage are exposed: of
  -- customer's 113 columns, 73 are under 5% populated (JES is a jewellery
  -- package — most of the rest is gold/hallmark/consignment machinery).
  coalesce(pt.ptdesc1, nullif(ctpaymentterms, ''))   as payment_terms,
  coalesce(pm.pmdesc1, nullif(ctpaymentmethod, ''))  as payment_method,
  nullif(ctshipmethod, '')                          as ship_method,
  nullif(ctshipmentterms, '')                       as shipment_terms,
  nullif(ctsalesmanhk, '')                          as salesman,
  nullif(ctcredit, '')::numeric                     as credit_limit,
  nullif(ctmarkup, '')::numeric                     as markup,
  nullif(ctgroup, '')                               as customer_group,
  nullif(ctphone2, '')                              as phone2,
  nullif(ctemail2, '')                              as email2,
  nullif(ctcooscontact, '')                         as coos_contact,
  nullif(ctcoosemail, '')                           as coos_email,
  nullif(ctaragcontact, '')                         as ar_contact,
  nullif(ctaragemail, '')                           as ar_email,
  nullif(ctquotationremarks, '')                    as quotation_remarks,
  nullif(ctsalesorderremarks, '')                   as order_remarks,
  nullif(ctinvoiceremarks, '')                      as invoice_remarks,
  nullif(ctremarks, '')                             as remarks,
  -- ctbank is populated on only 10 of 458 customers and holds one of two
  -- 2003-era codes; there is no usable bank master in JES. See
  -- V7.15_ERP_Inventory.md §"No bank master".
  nullif(ctbank, '')                                as bank_code,
  (coalesce(nullif(raw.customer.expired, ''), 'F') <> 'T') as active,
  nullif(raw.customer.lastupdate, '')::timestamp    as last_update
from raw.customer
left join raw.paymentmethod pm on pm.pmcode = nullif(ctpaymentmethod, '')
left join raw.paymentterms  pt on pt.ptcode = nullif(ctpaymentterms, '');

-- ── Suppliers ────────────────────────────────────────────────────────────────
drop view if exists public.erp_supplier cascade;
create view public.erp_supplier as
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
  -- Detail-panel fields (see the note on erp_customer above).
  nullif(regexp_replace(sushipaddress, '\r+', ', ', 'g'), '') as ship_address,
  coalesce(pt.ptdesc1, nullif(supaymentterms, ''))   as payment_terms,
  coalesce(pm.pmdesc1, nullif(supaymentmethod, ''))  as payment_method,
  nullif(sushipmethod, '')                          as ship_method,
  nullif(sushipmentterms, '')                       as shipment_terms,
  nullif(suphone2, '')                              as phone2,
  nullif(subank, '')                                as bank_code,
  (coalesce(nullif(raw.supplier.expired, ''), 'F') <> 'T') as active,
  nullif(raw.supplier.lastupdate, '')::timestamp    as last_update
from raw.supplier
left join raw.paymentmethod pm on pm.pmcode = nullif(supaymentmethod, '')
left join raw.paymentterms  pt on pt.ptcode = nullif(supaymentterms, '');

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
  -- Image references. The ERP stores a bare filename (FM-2HRT.jpg) pointing
  -- into a folder outside the database; the files themselves are not synced
  -- yet. 31,823 of 44,460 codes have one, but only 29,919 DISTINCT files —
  -- one image serves every colour variant of a design. Lower-cased because
  -- the source casing is inconsistent (FM-C-S-CRR-w.jpg vs fm-c-chm-4/a.jpg)
  -- and object storage, unlike Windows, is case-sensitive.
  lower(nullif(trim(itpicture1), ''))               as picture1,
  lower(nullif(trim(itpicture2), ''))               as picture2,
  nullif(itpicture1type, '')                        as picture1_type,
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

-- `markup` is a per-LINE factor (e.g. 0.70), distinct from the header-level
-- `discount`/`discount_pct` on the whole document — a line can be marked up or
-- down independently of the order's overall discount. Checked against a real
-- JES screenshot (SO150197 line UD015-D01-T00): `unit_price` (18.96) is the
-- REFERENCE/list price, not net — `amount` (39.82) already bakes in the
-- markup (qty 3 × 18.96 × 0.70 ≈ 39.82). JES's own UI shows a third value,
-- "Marked Unit Price" (13.27 = unit_price × markup = amount/qty), which isn't
-- stored on its own — it's derived, same as the app should derive it.
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
  nullif(sdrefdocno, '')          as ref_doc,
  nullif(sdmarkup, '')::numeric   as markup
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
  nullif(sdrefno, '')             as ref,
  nullif(sdmarkup, '')::numeric   as markup
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
  nullif(pdrefdocno, '')          as ref_doc,
  nullif(pdmarkup, '')::numeric   as markup
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

-- How many CURRENT BOMs use each component (5,817 distinct components).
-- Existence in the item master is a weak test — the app was found costing
-- FM-K(32).03-C, which exists and is used by ZERO current BOMs, while every
-- BOM uses FM-K(32)-C (526). A code that exists but is used nowhere is a
-- superseded item, and that is the signal worth surfacing.
create or replace view public.erp_component_usage as
select component_code            as code,
       count(*)::int             as bom_count,
       count(distinct parent_code)::int as parent_count
from public.erp_bom
group by component_code;

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

-- Item types for the Inventory picker (FG = Finished Goods, SF = Semi-Finished,
-- ST = Stone, SE = Set, AY = Alloy, SC = Stone Combination). Only 6 exist and
-- 5 appear in stock; stock_items lets the UI hide the ones that never do.
create or replace view public.erp_item_type as
select
  t.itcode                                        as code,
  coalesce(nullif(t.itlongdesc1, ''), nullif(t.itshortdesc1, '')) as name,
  coalesce(s.stock_items, 0)                      as stock_items
from raw.itemtype t
left join (
  select item_type, count(*) as stock_items
  from public.erp_stock where qty <> 0 group by item_type
) s on s.item_type = t.itcode;

-- ── Access: server-side only. Browser (anon) must NOT read these. ────────────
revoke all on public.erp_customer, public.erp_supplier, public.erp_item, public.erp_bom,
  public.erp_sales_invoice, public.erp_sales_invoice_line, public.erp_sales_invoice_surcharge,
  public.erp_sales_order, public.erp_sales_order_line, public.erp_sales_order_surcharge,
  public.erp_purchase, public.erp_purchase_line, public.erp_purchase_surcharge,
  public.erp_warehouse, public.erp_stock, public.erp_item_type,
  public.erp_component_usage from anon, authenticated;
grant select on public.erp_customer, public.erp_supplier, public.erp_item, public.erp_bom,
  public.erp_sales_invoice, public.erp_sales_invoice_line, public.erp_sales_invoice_surcharge,
  public.erp_sales_order, public.erp_sales_order_line, public.erp_sales_order_surcharge,
  public.erp_purchase, public.erp_purchase_line, public.erp_purchase_surcharge,
  public.erp_warehouse, public.erp_stock, public.erp_item_type,
  public.erp_component_usage to service_role;
revoke all on function public.explode_bom(text) from anon, authenticated;
grant execute on function public.explode_bom(text) to service_role;

-- Refresh PostgREST's schema cache so /rest/v1/erp_customer etc. appear.
notify pgrst, 'reload schema';

-- ── UC registry, dated from the invoice (Phase 7) ────────────────────────────
-- Cindy, 2026-07-21: "the UC registry has a date field, but it is better to
-- link to the SI date automatically if an SI is issued for that UC number."
--
-- She is right, and the field was worse than she thought: doc_date was NULL on
-- all 3,695 rows. It has never been populated, so the registry's Date column
-- has always fallen back to showing just the year suffix ("/26").
--
-- Derived here rather than copied into the table on purpose. A stored copy
-- would go stale the moment an invoice date is corrected in JES, and the whole
-- point of the registry is that it reconciles against the books.
--
-- The join key is jes_si -> salesinvoice.sino, not siref -> uc_no: 3,535 of
-- 3,586 registry rows with a jes_si match an invoice this way, against 3,251
-- the other way round. sino is unique across all 5,456 invoices, so the join
-- cannot fan out a registry row into duplicates.
--
-- The '^SI[0-9]' guard is not cosmetic. jes_si is a free-text column carried
-- over from Cindy's working .xls, and 29 rows hold status words rather than
-- invoice numbers — 'Cancelled', 'CANCELLED', 'Not use', 'Open'. Same family
-- as UC4933 in V7.16: the spreadsheet is a working file, not a clean feed.
--
-- Rows genuinely without an invoice (109 have no jes_si at all, mostly
-- source='Other') keep doc_date as a manual entry. Hence effective_date:
-- the invoice's date when there is one, the typed one otherwise.
--
-- NOTE u.* is expanded when the view is created, so re-run this file after
-- adding a column to uc_registry.
drop view if exists public.uc_registry_dated cascade;
create view public.uc_registry_dated as
select
  u.*,
  si.sidate::date                          as si_date,
  coalesce(si.sidate::date, u.doc_date)    as effective_date,
  -- Where the invoice actually lives, as a FACT rather than a typed field.
  --
  -- The `source` column cannot answer this and never could: 'ERP' does not
  -- mean "the invoice is in JES", because Online Shop (422), Alibaba (152) and
  -- Amazon (103) invoices are all in JES too. 'ERP' is a residual "direct
  -- sale" bucket wearing a system's name. Measured 2026-07-21.
  --
  -- Deliberately NOT called 'App' when absent. An invoice raised in JES this
  -- afternoon is not in the mirror either — the sync runs on the office LAN
  -- only. Absence means "not in the mirror", which is app-raised OR not yet
  -- synced, and the two cannot be told apart from here.
  case
    -- coalesce is required: `NULL !~ pattern` is NULL, not true, so a row
    -- with no jes_si would fall through and be reported as not_in_mirror.
    when coalesce(u.jes_si, '') !~ '^SI[0-9]' then null   -- no invoice, or a status word
    when si.sino is not null    then 'jes'
    else 'not_in_mirror'
  end                                      as invoice_location
from public.uc_registry u
left join raw.salesinvoice si
  on u.jes_si ~ '^SI[0-9]'
 and si.sino = u.jes_si;

revoke all on public.uc_registry_dated from anon, authenticated;
grant select on public.uc_registry_dated to service_role;

notify pgrst, 'reload schema';

-- ── Sync freshness (Phase 8) ─────────────────────────────────────────────────
-- "Reflects the last data sync — not live" was all the ERP Lookup page could
-- say, which left the obvious question unanswered: last sync when? Requested
-- 2026-07-21.
--
-- Two different times, and conflating them would mislead:
--   synced_at    — when sync.py last ran. How stale the MIRROR is.
--   data_through — the newest LastUpdate the incremental tables have pulled.
--                  How current the ERP DATA is. These differ: after the
--                  2026-07-21 run, synced_at was 13:28 but data_through was
--                  11:45, because nothing had been edited in JES since.
--
-- Restricted to the tables that actually carry a watermark: a full-mode table
-- has last_watermark NULL and would drag the max() to nothing.
drop view if exists public.erp_sync_status cascade;
create view public.erp_sync_status as
select
  max(last_run_at)                                     as synced_at,
  max(last_watermark) filter (where last_watermark <> '') as data_through,
  count(*)                                             as tables,
  sum(row_count)                                       as rows_mirrored
from meta.sync_state;

revoke all on public.erp_sync_status from anon, authenticated;
grant select on public.erp_sync_status to service_role;

notify pgrst, 'reload schema';
