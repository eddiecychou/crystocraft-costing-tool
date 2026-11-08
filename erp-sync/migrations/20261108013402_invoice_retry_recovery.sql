-- SH-05B. Review docs/plans/V8.20-INVOICE-RETRY-RECOVERY.md before application.
-- Additive receipts only: no historical rows/backfill or number/sequence reset.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
declare core oid := to_regprocedure('oc_invoice_private.allocate_core(text,text,text,text,bigint,text,text)');
  legacy oid := to_regprocedure('public.allocate_sales_invoice(text,text,text,text,bigint,text,text)');
begin
  if core is null then
    if to_regnamespace('oc_invoice_private') is not null then
      raise exception 'Unreviewed invoice private schema already exists';
    end if;
    if legacy is null or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='allocate_sales_invoice')<>1 then
      raise exception 'Review the existing invoice allocator/overloads before migration';
    end if;
    if not exists(select 1 from pg_proc where oid=legacy and pg_get_userbyid(proowner)='postgres'
      and prosecdef and proconfig=array['search_path=public, pg_temp']::text[]) then
      raise exception 'Allocator owner or security configuration changed';
    end if;
    create schema oc_invoice_private authorization postgres;
    alter function public.allocate_sales_invoice(text,text,text,text,bigint,text,text) set schema oc_invoice_private;
    alter function oc_invoice_private.allocate_sales_invoice(text,text,text,text,bigint,text,text) rename to allocate_core;
  elsif not exists(select 1 from pg_proc where oid=core and pg_get_userbyid(proowner)='postgres'
    and prosecdef and proconfig=array['search_path=public, pg_temp']::text[]) then
    raise exception 'Private allocation core security configuration changed';
  end if;
end $guard$;
revoke all on schema oc_invoice_private from public,anon,authenticated,service_role;
revoke all on function oc_invoice_private.allocate_core(text,text,text,text,bigint,text,text)
  from public,anon,authenticated,service_role;
create table if not exists oc_invoice_private.invoice_allocations (
  operation_id uuid primary key,
  order_id text not null,
  request jsonb not null,
  si_no text not null,
  uc_no text,
  uc_id bigint,
  invoice_id bigint not null unique references public.app_sales_invoice(id),
  invoice_snapshot jsonb not null,
  uc_snapshot jsonb,
  created_at timestamptz not null default now()
);
alter table oc_invoice_private.invoice_allocations enable row level security;
revoke all on oc_invoice_private.invoice_allocations from public,anon,authenticated,service_role;

-- Old tabs/deployments cannot bypass identity. No number is issued here, even
-- after an app rollback or reapplication of the earlier grant-only migration.
create or replace function public.allocate_sales_invoice(
  p_year text,p_customer text default '',p_currency text default 'HKD',
  p_order_id text default null,p_uc_id bigint default null,p_uc_no text default null,
  p_created_by text default null
) returns table(o_si_no text,o_uc_no text,o_uc_id bigint,o_invoice_id bigint)
language plpgsql security definer set search_path=public,pg_temp as $legacy$
begin
  raise exception 'Refresh OC and resume invoicing on the saved order; invoice recovery request required';
end $legacy$;
revoke all on function public.allocate_sales_invoice(text,text,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.allocate_sales_invoice(text,text,text,text,bigint,text,text) to service_role;

create or replace function public.allocate_sales_invoice_once(p_operation_id uuid,p_request jsonb)
returns table(operation_id uuid,order_id text,request_json jsonb,o_si_no text,o_uc_no text,o_uc_id bigint,o_invoice_id bigint)
language plpgsql security definer set search_path=public,pg_temp as $once$
declare receipt oc_invoice_private.invoice_allocations%rowtype; allocated record;
begin
  if p_operation_id is null or p_operation_id::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or jsonb_typeof(p_request) is distinct from 'object'
    or not(p_request ?& array['year','customer','currency','order_id','uc_id','uc_no','created_by','actor_uid','purpose','reason','invoiced_at'])
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['year','customer','currency','order_id','uc_id','uc_no','created_by','actor_uid','purpose','reason','invoiced_at']))
    or jsonb_typeof(p_request->'year')<>'string' or (p_request->>'year')!~'^[0-9]{2}$'
    or jsonb_typeof(p_request->'customer')<>'string' or length(p_request->>'customer')>200
    or jsonb_typeof(p_request->'currency')<>'string' or length(p_request->>'currency') not between 1 and 8
    or jsonb_typeof(p_request->'order_id')<>'string' or (p_request->>'order_id')!~'^[A-Za-z0-9_-]{1,64}$'
    or jsonb_typeof(p_request->'actor_uid')<>'string' or length(p_request->>'actor_uid') not between 1 and 128
    or jsonb_typeof(p_request->'created_by')<>'string' or length(p_request->>'created_by')>320
    or jsonb_typeof(p_request->'purpose')<>'string' or (p_request->>'purpose') not in ('first','split','reissue')
    or jsonb_typeof(p_request->'reason')<>'string' or length(p_request->>'reason')>500
    or (p_request->>'purpose'<>'first' and length(btrim(p_request->>'reason'))=0)
    or jsonb_typeof(p_request->'invoiced_at')<>'string' or (p_request->>'invoiced_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_request->'uc_id') not in ('null','number')
    or jsonb_typeof(p_request->'uc_no') not in ('null','string')
    or length(coalesce(p_request->>'uc_no',''))>64 then
    raise exception 'Invalid saved invoice allocation request';
  end if;
  perform (p_request->>'invoiced_at')::date;
  -- Lock order: operation, then the existing core's per-year lock.
  perform pg_advisory_xact_lock(hashtextextended('invoice_operation_'||p_operation_id::text,0));
  select a.* into receipt from oc_invoice_private.invoice_allocations a where a.operation_id=p_operation_id;
  if found then
    if receipt.request is distinct from p_request then
      raise exception 'Invoice operation was reused with different saved details';
    end if;
  else
    select * into allocated from oc_invoice_private.allocate_core(
      p_request->>'year',p_request->>'customer',p_request->>'currency',p_request->>'order_id',
      (p_request->>'uc_id')::bigint,p_request->>'uc_no',p_request->>'created_by');
    insert into oc_invoice_private.invoice_allocations(operation_id,order_id,request,si_no,uc_no,uc_id,invoice_id,invoice_snapshot,uc_snapshot)
      values(p_operation_id,p_request->>'order_id',p_request,allocated.o_si_no,allocated.o_uc_no,allocated.o_uc_id,allocated.o_invoice_id,
        (select to_jsonb(a) from public.app_sales_invoice a where a.id=allocated.o_invoice_id),
        (select to_jsonb(u) from public.uc_registry u where u.id=allocated.o_uc_id))
      returning * into receipt;
  end if;
  return query select receipt.operation_id,receipt.order_id,receipt.request,receipt.si_no,receipt.uc_no,receipt.uc_id,receipt.invoice_id;
end $once$;
revoke all on function public.allocate_sales_invoice_once(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.allocate_sales_invoice_once(uuid,jsonb) to service_role;

create or replace function public.lookup_invoice_allocation(p_operation_id uuid)
returns table(operation_id uuid,order_id text,request_json jsonb,o_si_no text,o_uc_no text,o_uc_id bigint,o_invoice_id bigint)
language sql stable security definer set search_path=public,pg_temp as $lookup$
  select a.operation_id,a.order_id,a.request,a.si_no,a.uc_no,a.uc_id,a.invoice_id
  from oc_invoice_private.invoice_allocations a where a.operation_id=p_operation_id;
$lookup$;
revoke all on function public.lookup_invoice_allocation(uuid) from public,anon,authenticated;
grant execute on function public.lookup_invoice_allocation(uuid) to service_role;
-- Follow-up writes are receipt-bound and compare the complete typed row under
-- a lock. An unchanged timestamp alone is not sufficient concurrency evidence.
create or replace function public.apply_invoice_allocation_followup(
  p_operation_id uuid,p_stage text,p_expected jsonb,p_patch jsonb
) returns table(result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $followup$
declare receipt oc_invoice_private.invoice_allocations%rowtype;
  invoice public.app_sales_invoice%rowtype; expected_invoice public.app_sales_invoice%rowtype; patch_invoice public.app_sales_invoice%rowtype;
  uc public.uc_registry%rowtype; expected_uc public.uc_registry%rowtype; patch_uc public.uc_registry%rowtype;
begin
  select a.* into receipt from oc_invoice_private.invoice_allocations a where a.operation_id=p_operation_id;
  if not found or jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'A saved receipt and reviewed follow-up rows are required';
  end if;
  if p_stage='financial' then
    if exists(select 1 from jsonb_object_keys(p_patch) k where k<>all(array['si_no','year','uc_no','order_id','customer','currency','total','invoiced_at','invoice_date','customer_po','remarks','accounting_total','adjustment','adjustment_reason','channel','external_order_no','updated_at','updated_by']))
      or p_patch->>'si_no' is distinct from receipt.si_no or p_patch->>'order_id' is distinct from receipt.order_id
      or p_patch->>'uc_no' is distinct from receipt.uc_no or p_patch->>'year' is distinct from substring(receipt.si_no from 3 for 2) then
      raise exception 'Follow-up does not match the issued invoice receipt';
    end if;
    select * into invoice from public.app_sales_invoice a where a.id=receipt.invoice_id for update;
    if not found or invoice.si_no<>receipt.si_no or invoice.order_id is distinct from receipt.order_id then
      raise exception 'Financial invoice ownership requires review';
    end if;
    -- Lost acknowledgments are no-ops even if another writer changed an
    -- unrelated field afterward. Required nulls remain part of this comparison.
    if (p_patch-array['updated_at','updated_by']) <@ to_jsonb(invoice) then return query select to_jsonb(invoice);return;end if;
    expected_invoice:=jsonb_populate_record(null::public.app_sales_invoice,p_expected);
    if invoice is distinct from expected_invoice then raise exception 'Financial details changed concurrently; review before retrying';end if;
    if invoice is distinct from jsonb_populate_record(null::public.app_sales_invoice,receipt.invoice_snapshot) then
      raise exception 'Financial details changed after allocation; review before retrying';
    end if;
    patch_invoice:=jsonb_populate_record(invoice,p_patch);
    if abs(coalesce(patch_invoice.accounting_total-patch_invoice.total,0))>0.005 and coalesce(btrim(patch_invoice.adjustment_reason),'')='' then
      raise exception 'Accounting adjustment requires a reason';
    end if;
    update public.app_sales_invoice a set customer=patch_invoice.customer,currency=patch_invoice.currency,
      total=patch_invoice.total,invoiced_at=patch_invoice.invoiced_at,invoice_date=patch_invoice.invoice_date,
      customer_po=patch_invoice.customer_po,remarks=patch_invoice.remarks,accounting_total=patch_invoice.accounting_total,
      adjustment=patch_invoice.adjustment,adjustment_reason=patch_invoice.adjustment_reason,channel=patch_invoice.channel,
      external_order_no=patch_invoice.external_order_no,updated_at=patch_invoice.updated_at,updated_by=patch_invoice.updated_by
      where a.id=receipt.invoice_id returning * into invoice;
    return query select to_jsonb(invoice);
  elsif p_stage='woo' then
    if receipt.uc_id is null or exists(select 1 from jsonb_object_keys(p_patch) k where k<>all(array['source','customer_id','order_no','total','deposit','balance','bal_pay_date','remarks','confirmed','status','updated_at','updated_by'])) then
      raise exception 'Invalid saved WooCommerce follow-up';
    end if;
    select * into uc from public.uc_registry u where u.id=receipt.uc_id for update;
    if not found then raise exception 'Saved UC record is missing';end if;
    if (p_patch-array['updated_at','updated_by']) <@ to_jsonb(uc) then return query select to_jsonb(uc);return;end if;
    expected_uc:=jsonb_populate_record(null::public.uc_registry,p_expected);
    if uc is distinct from expected_uc then raise exception 'UC details changed concurrently; review before retrying';end if;
    if uc is distinct from jsonb_populate_record(null::public.uc_registry,receipt.uc_snapshot) then
      raise exception 'UC details changed after allocation; review before retrying';
    end if;
    patch_uc:=jsonb_populate_record(uc,p_patch);
    update public.uc_registry u set source=patch_uc.source,customer_id=patch_uc.customer_id,order_no=patch_uc.order_no,
      total=patch_uc.total,deposit=patch_uc.deposit,balance=patch_uc.balance,bal_pay_date=patch_uc.bal_pay_date,
      remarks=patch_uc.remarks,confirmed=patch_uc.confirmed,status=patch_uc.status,updated_at=patch_uc.updated_at,updated_by=patch_uc.updated_by
      where u.id=receipt.uc_id returning * into uc;
    return query select to_jsonb(uc);
  else raise exception 'Unknown invoice follow-up stage';end if;
end $followup$;
revoke all on function public.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb) to service_role;

do $postcheck$ begin
  if has_schema_privilege('service_role','oc_invoice_private','USAGE')
    or has_function_privilege('service_role','oc_invoice_private.allocate_core(text,text,text,text,bigint,text,text)','EXECUTE')
    or has_function_privilege('anon','public.allocate_sales_invoice_once(uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.allocate_sales_invoice_once(uuid,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.lookup_invoice_allocation(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.lookup_invoice_allocation(uuid)','EXECUTE')
    or has_function_privilege('anon','public.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.allocate_sales_invoice_once(uuid,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.lookup_invoice_allocation(uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb)','EXECUTE') then
    raise exception 'Invoice recovery private execution checks failed';
  end if;
end $postcheck$;
notify pgrst,'reload schema';
commit;
