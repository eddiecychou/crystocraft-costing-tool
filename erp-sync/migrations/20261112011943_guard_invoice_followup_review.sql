-- Keep the existing financial and UC compare-before-write logic. Serialize
-- writes and review on the receipt so a delayed RPC cannot cross a review.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if not exists (
    select 1 from pg_proc
    where oid = to_regprocedure('public.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb)')
      and proowner = 'postgres'::regrole and prosecdef
      and md5(prosrc) = 'f58589f2bbc72fae9782a74ac1bdb8e1'
  ) then raise exception 'The existing invoice follow-up function needs review'; end if;
end $preflight$;

alter table oc_invoice_private.invoice_allocations
  add column followup_review jsonb,
  add column followup_applied jsonb not null default '{}'::jsonb;

alter function public.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb)
  set schema oc_invoice_private;
revoke all on function oc_invoice_private.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb)
  from public, anon, authenticated, service_role;

create function public.apply_invoice_allocation_followup(
  p_operation_id uuid, p_stage text, p_expected jsonb, p_patch jsonb
) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $body$
declare
  receipt oc_invoice_private.invoice_allocations%rowtype;
  saved jsonb;
begin
  select * into receipt from oc_invoice_private.invoice_allocations
    where operation_id = p_operation_id for update;
  if not found then raise exception 'A saved invoice receipt is required'; end if;
  if receipt.followup_review is not null then
    return query select jsonb_build_object('followup_review', receipt.followup_review,
      'applied', receipt.followup_applied);
    return;
  end if;
  select write.result into strict saved
    from oc_invoice_private.apply_invoice_allocation_followup(p_operation_id,p_stage,p_expected,p_patch) write;
  update oc_invoice_private.invoice_allocations
    set followup_applied = followup_applied || jsonb_build_object(p_stage,true)
    where operation_id = p_operation_id and not (followup_applied ? p_stage);
  return query select saved;
end $body$;

create function public.review_invoice_allocation_followups(
  p_operation_id uuid, p_order_id text, p_by text, p_reason text
) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $body$
declare receipt oc_invoice_private.invoice_allocations%rowtype;
begin
  if coalesce(btrim(p_by),'') = '' or length(p_by) > 128
     or coalesce(btrim(p_reason),'') = '' or length(p_reason) > 500 then
    raise exception 'A reviewer and reason are required';
  end if;
  select * into receipt from oc_invoice_private.invoice_allocations
    where operation_id = p_operation_id and order_id = p_order_id for update;
  if not found then raise exception 'A matching saved invoice receipt is required'; end if;
  if receipt.followup_review is null then
    update oc_invoice_private.invoice_allocations
      set followup_review = jsonb_build_object('by', p_by, 'reason', p_reason, 'at', clock_timestamp())
      where operation_id = p_operation_id returning * into receipt;
  end if;
  return query select jsonb_build_object('followup_review', receipt.followup_review,
    'applied', receipt.followup_applied);
end $body$;

create function public.lookup_invoice_allocation_followups(p_operation_id uuid)
returns table(result jsonb)
language sql security definer set search_path = '' as $body$
  select jsonb_build_object('followup_review', a.followup_review, 'applied', a.followup_applied)
  from oc_invoice_private.invoice_allocations a where a.operation_id = p_operation_id
$body$;

create function public.apply_claimed_invoice_followup(
  p_operation_id uuid, p_stage text, p_expected jsonb, p_patch jsonb, p_deadline timestamptz
) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $body$
begin
  perform 1 from oc_invoice_private.invoice_allocations
    where operation_id = p_operation_id for update;
  if not found then raise exception 'A saved invoice receipt is required'; end if;
  if p_deadline is null or clock_timestamp() >= p_deadline then
    raise exception 'The invoice follow-up claim expired';
  end if;
  return query select * from public.apply_invoice_allocation_followup(
    p_operation_id, p_stage, p_expected, p_patch
  );
end $body$;

revoke all on function public.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb),
  public.review_invoice_allocation_followups(uuid,text,text,text),
  public.lookup_invoice_allocation_followups(uuid),
  public.apply_claimed_invoice_followup(uuid,text,jsonb,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb),
  public.review_invoice_allocation_followups(uuid,text,text,text),
  public.lookup_invoice_allocation_followups(uuid),
  public.apply_claimed_invoice_followup(uuid,text,jsonb,jsonb,timestamptz) to service_role;

do $grants$
declare signature text;
begin
  foreach signature in array array[
    'public.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb)',
    'public.review_invoice_allocation_followups(uuid,text,text,text)',
    'public.lookup_invoice_allocation_followups(uuid)',
    'public.apply_claimed_invoice_followup(uuid,text,jsonb,jsonb,timestamptz)'
  ] loop
    if has_function_privilege('anon', signature, 'execute')
      or has_function_privilege('authenticated', signature, 'execute')
      or not has_function_privilege('service_role', signature, 'execute')
    then raise exception 'Invoice follow-up execution grants need review'; end if;
  end loop;
  if has_function_privilege('service_role',
    'oc_invoice_private.apply_invoice_allocation_followup(uuid,text,jsonb,jsonb)', 'execute')
  then raise exception 'Server must use the guarded invoice follow-up function'; end if;
end $grants$;
notify pgrst, 'reload schema';
commit;
