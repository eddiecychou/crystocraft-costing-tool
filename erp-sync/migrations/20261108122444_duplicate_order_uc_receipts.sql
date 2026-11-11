-- A receipt records one deliberate Shipping copy. The existing registry
-- default supplies the UC. No historical rows or sequences are rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema oc_shipping_private authorization postgres;
revoke all on schema oc_shipping_private from public, anon, authenticated, service_role;
create table oc_shipping_private.duplicate_order_ucs (
  operation_id uuid primary key,
  request jsonb not null,
  uc_id bigint not null unique,
  uc_no text not null,
  created_at timestamptz not null default now()
);
alter table oc_shipping_private.duplicate_order_ucs enable row level security;
revoke all on oc_shipping_private.duplicate_order_ucs from public, anon, authenticated, service_role;

create function public.duplicate_order_uc(p_operation_id uuid, p_request jsonb, p_issue boolean)
returns table(operation_id uuid, request_json jsonb, uc_id text, uc_no text)
language plpgsql security definer set search_path = '' as $body$
declare
  receipt oc_shipping_private.duplicate_order_ucs%rowtype;
  registry public.uc_registry%rowtype;
begin
  if p_operation_id is null or p_issue is null
     or jsonb_typeof(p_request) is distinct from 'object'
     or not (p_request ?& array['order_id','source_id','actor_uid','created_by','year','customer','currency'])
     or exists (select from jsonb_each(p_request) e
          where e.key <> all(array['order_id','source_id','actor_uid','created_by','year','customer','currency'])
             or (jsonb_typeof(e.value) <> 'string' and not (e.key = 'created_by' and e.value = 'null'::jsonb)))
     or p_request->>'year' !~ '^/[0-9]{2}$'
     or p_request->>'order_id' = '' or p_request->>'source_id' = ''
     or p_request->>'actor_uid' = '' or p_request->>'currency' = '' then
    raise exception 'Invalid duplicate order request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('duplicate_order_uc:' || p_operation_id::text, 0));
  select r.* into receipt from oc_shipping_private.duplicate_order_ucs r where r.operation_id = p_operation_id;
  if found then
    if receipt.request is distinct from p_request then
      raise exception 'Duplicate UC receipt mismatch';
    end if;
    select u.* into registry from public.uc_registry u where u.id = receipt.uc_id;
    if not found or receipt.uc_no is distinct from registry.uc_no || registry.year
       or registry.customer is distinct from p_request->>'customer'
       or registry.currency is distinct from p_request->>'currency'
       or registry.year is distinct from p_request->>'year' or registry.status is distinct from 'open'
       or coalesce(registry.order_no, '') <> '' or coalesce(to_jsonb(registry)->>'jes_si', '') <> '' then
      raise exception 'Issued duplicate UC requires review';
    end if;
  elsif p_issue then
    insert into public.uc_registry (year, customer, currency, created_by, status, balance, confirmed)
      values (p_request->>'year', p_request->>'customer', p_request->>'currency', p_request->>'created_by', 'open', 0, false)
      returning * into registry;
    insert into oc_shipping_private.duplicate_order_ucs (operation_id, request, uc_id, uc_no)
      values (p_operation_id, p_request, registry.id, registry.uc_no || registry.year)
      returning * into receipt;
  else
    return;
  end if;
  return query select receipt.operation_id, receipt.request, receipt.uc_id::text, receipt.uc_no;
end
$body$;

revoke all on function public.duplicate_order_uc(uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.duplicate_order_uc(uuid,jsonb,boolean) to service_role;
do $check$
begin
  if has_function_privilege('anon','public.duplicate_order_uc(uuid,jsonb,boolean)','EXECUTE')
     or has_function_privilege('authenticated','public.duplicate_order_uc(uuid,jsonb,boolean)','EXECUTE')
     or not has_function_privilege('service_role','public.duplicate_order_uc(uuid,jsonb,boolean)','EXECUTE') then
    raise exception 'Duplicate order UC execution grants need review';
  end if;
end $check$;
notify pgrst, 'reload schema';
commit;
