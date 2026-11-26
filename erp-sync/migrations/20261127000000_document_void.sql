begin;
set local lock_timeout = '5s';

alter table public.app_sales_invoice
  add column void_reason text,
  add column voided_at timestamptz,
  add column voided_by text;

-- Include a void in the existing financial change history.
create or replace function public.app_sales_invoice_audit_fn() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE'
     and new.status             is not distinct from old.status
     and new.invoice_date       is not distinct from old.invoice_date
     and new.customer_po        is not distinct from old.customer_po
     and new.remarks            is not distinct from old.remarks
     and new.accounting_total   is not distinct from old.accounting_total
     and new.adjustment         is not distinct from old.adjustment
     and new.adjustment_reason  is not distinct from old.adjustment_reason
  then return new; end if;
  insert into public.app_sales_invoice_audit (invoice_id, action, changed_by, before, after)
  values (
    coalesce(new.id, old.id), lower(tg_op), coalesce(new.updated_by, old.updated_by),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create function oc_invoice_private.keep_void_invoice() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'void' and (tg_op = 'DELETE' or new is distinct from old) then
    raise exception 'Voided invoice history is read only' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger keep_void_invoice before update or delete on public.app_sales_invoice
  for each row execute function oc_invoice_private.keep_void_invoice();

create function public.void_app_sales_invoice(
  p_id bigint, p_si text, p_expected_updated_at timestamptz, p_by text, p_reason text
) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  receipt oc_invoice_private.invoice_allocations%rowtype;
  invoice public.app_sales_invoice%rowtype;
  saved_at timestamptz;
begin
  if p_id is null or p_id < 1 or coalesce(p_si,'') !~ '^SI[0-9]{6,}$'
     or length(p_si) > 64 or coalesce(btrim(p_by),'') = '' or length(p_by) > 128
     or coalesce(p_reason,'') !~ '[^[:space:]]' or length(btrim(p_reason)) > 500 then
    raise exception 'An exact SI, reviewer and reason are required' using errcode = '22023';
  end if;
  -- Follow-ups take this receipt lock before the invoice lock. Fence only
  -- the selected receipt, including when its UC is shared with other SIs.
  select * into receipt from oc_invoice_private.invoice_allocations
    where invoice_id = p_id for update;
  select * into invoice from public.app_sales_invoice
    where id = p_id and si_no = p_si for update;
  if not found then raise exception 'Invoice identity changed' using errcode = 'P0002'; end if;
  if receipt.operation_id is not null and (receipt.si_no is distinct from invoice.si_no
     or receipt.order_id is distinct from invoice.order_id or receipt.uc_id is distinct from invoice.uc_id
     or receipt.uc_no is distinct from invoice.uc_no) then
    raise exception 'Invoice receipt identity requires review' using errcode = '23514';
  end if;
  if invoice.status <> 'void' then
    if invoice.status <> 'issued' or invoice.updated_at is distinct from p_expected_updated_at then
      raise exception 'Invoice changed after review' using errcode = '23514';
    end if;
    saved_at := clock_timestamp();
    if receipt.operation_id is not null and receipt.followup_review is null then
      update oc_invoice_private.invoice_allocations
        set followup_review = jsonb_build_object('by', p_by, 'reason', btrim(p_reason), 'at', saved_at)
        where operation_id = receipt.operation_id;
    end if;
    update public.app_sales_invoice set status = 'void', void_reason = btrim(p_reason),
      voided_at = saved_at, voided_by = p_by, updated_at = saved_at, updated_by = p_by
      where id = p_id returning * into invoice;
  end if;
  return query select jsonb_build_object(
    'no', invoice.si_no, 'status', invoice.status, 'reason', invoice.void_reason,
    'voidedAt', invoice.voided_at
  );
end $$;

revoke all on function public.void_app_sales_invoice(bigint,text,timestamptz,text,text)
  from public, anon, authenticated;
grant execute on function public.void_app_sales_invoice(bigint,text,timestamptz,text,text) to service_role;
revoke all on function oc_invoice_private.keep_void_invoice() from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
