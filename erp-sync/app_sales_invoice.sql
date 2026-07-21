-- ── App-issued sales invoices ────────────────────────────────────────────────
-- The first financial record the app writes to Postgres rather than Firestore.
--
-- WHY HERE AND NOT FIRESTORE. An invoice is two things at different times: a
-- working document while it is edited, then a permanent financial fact once
-- issued. The order stays in Firestore, which suits live editing and line
-- subcollections. The FACT lands here, beside uc_registry and the JES mirror,
-- because everything that consumes it is relational — Cindy's exports, the
-- PBIS feed, and reconciliation against raw.salesinvoice.
--
-- WHAT IT ACTUALLY FIXES. Allocation used to write a UC to Postgres and an
-- order to Firestore with nothing making the two agree; abandon the form after
-- allocating and the UC was burned with no invoice behind it. Both writes now
-- happen in one transaction, so a UC and its invoice exist together or not
-- at all.
create table if not exists public.app_sales_invoice (
  id           bigserial primary key,
  si_no        text        not null unique,
  year         text        not null,             -- '26', matching the number
  uc_id        bigint      references public.uc_registry(id),
  uc_no        text,                             -- denormalised for reading
  order_id     text,                             -- the Firestore order, if any
  customer     text,
  currency     text,
  total        numeric,
  invoiced_at  date,
  -- Voids are recorded, never deleted — JES keeps 90 of them and the SI series
  -- is expected to have holes.
  status       text        not null default 'issued',
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz,
  updated_by   text
);

create index if not exists app_sales_invoice_year_idx on public.app_sales_invoice (year);
create index if not exists app_sales_invoice_uc_idx   on public.app_sales_invoice (uc_id);

-- Allocate the next invoice number and its UC, atomically.
--
-- THE NUMBER IS DERIVED, NOT SEEDED. JES_SI_SEED_BY_YEAR in soNumber.js was a
-- hardcoded copy of JES's last number, and on 2026-07-21 it was already stale —
-- CuiLing had issued SI260094 after it was written, so the app's first invoice
-- would have reused her number. Here the next number is computed from the
-- greater of what the app has issued and what the MIRROR shows JES issued, so
-- the only way to collide is for JES to issue one after the last sync. That is
-- a real remaining risk, and it is why new invoices must be raised in the app
-- only — but it can no longer happen through simple staleness.
create or replace function public.allocate_sales_invoice(
  p_year       text,
  p_customer   text default '',
  p_currency   text default 'HKD',
  p_order_id   text default null,
  p_uc_id      bigint default null,
  p_created_by text default null
) returns table (si_no text, uc_no text, uc_id bigint, invoice_id bigint)
language plpgsql
as $$
declare
  v_next int;
  v_app  int;
  v_jes  int;
  v_si   text;
  v_ucno text;
  v_ucid bigint;
  v_id   bigint;
begin
  -- Serialise allocation for this year. Without it two concurrent callers read
  -- the same max and both take the same number.
  perform pg_advisory_xact_lock(hashtext('si_alloc_' || p_year));

  select coalesce(max(substring(si_no from 5)::int), 0) into v_app
    from public.app_sales_invoice
   where year = p_year and si_no ~ ('^SI' || p_year || '[0-9]+$');

  select coalesce(max(substring(btrim(sino) from 5)::int), 0) into v_jes
    from raw.salesinvoice
   where btrim(sino) ~ ('^SI' || p_year || '[0-9]+$');

  v_next := greatest(v_app, v_jes) + 1;
  v_si   := 'SI' || p_year || lpad(v_next::text, 4, '0');

  if p_uc_id is null then
    insert into public.uc_registry (year, customer, currency, status, created_by)
    values ('/' || p_year, p_customer, p_currency, 'open', p_created_by)
    returning id, public.uc_registry.uc_no into v_ucid, v_ucno;
  else
    select r.id, r.uc_no into v_ucid, v_ucno
      from public.uc_registry r where r.id = p_uc_id;
    if v_ucid is null then
      raise exception 'UC id % not found', p_uc_id;
    end if;
  end if;

  insert into public.app_sales_invoice
    (si_no, year, uc_id, uc_no, order_id, customer, currency, invoiced_at, created_by)
  values
    (v_si, p_year, v_ucid, v_ucno, p_order_id, p_customer, p_currency, current_date, p_created_by)
  returning id into v_id;

  return query select v_si, v_ucno, v_ucid, v_id;
end $$;

revoke all on public.app_sales_invoice from anon, authenticated;
grant select, insert, update on public.app_sales_invoice to service_role;
grant usage, select on sequence public.app_sales_invoice_id_seq to service_role;
revoke all on function public.allocate_sales_invoice(text,text,text,text,bigint,text) from anon, authenticated;
grant execute on function public.allocate_sales_invoice(text,text,text,text,bigint,text) to service_role;

notify pgrst, 'reload schema';
drop function if exists public.allocate_sales_invoice(text,text,text,text,bigint,text);

create function public.allocate_sales_invoice(
  p_year       text,
  p_customer   text default '',
  p_currency   text default 'HKD',
  p_order_id   text default null,
  p_uc_id      bigint default null,
  p_uc_no      text default null,     -- full form, e.g. 'UC4920/26'
  p_created_by text default null
) returns table (o_si_no text, o_uc_no text, o_uc_id bigint, o_invoice_id bigint)
language plpgsql
as $$
declare
  v_next int; v_app int; v_jes int;
  v_si text; v_ucno text; v_ucid bigint; v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('si_alloc_' || p_year));

  select coalesce(max(substring(a.si_no from 5)::int), 0) into v_app
    from public.app_sales_invoice a
   where a.year = p_year and a.si_no ~ ('^SI' || p_year || '[0-9]+$');

  select coalesce(max(substring(btrim(s.sino) from 5)::int), 0) into v_jes
    from raw.salesinvoice s
   where btrim(s.sino) ~ ('^SI' || p_year || '[0-9]+$');

  v_next := greatest(v_app, v_jes) + 1;
  v_si   := 'SI' || p_year || lpad(v_next::text, 4, '0');

  if p_uc_id is not null then
    select r.id, r.uc_no || coalesce(r.year,'') into v_ucid, v_ucno
      from public.uc_registry r where r.id = p_uc_id;
    if v_ucid is null then raise exception 'UC id % not found', p_uc_id; end if;

  elsif coalesce(btrim(p_uc_no), '') <> '' then
    -- The order already carries a UC as text. Resolve it to a registry row so
    -- the invoice links properly; the app stores the FULL form ('UC4920/26')
    -- while the registry splits it across uc_no and year.
    select r.id, r.uc_no || coalesce(r.year,'') into v_ucid, v_ucno
      from public.uc_registry r
     where r.uc_no || coalesce(r.year,'') = btrim(p_uc_no)
     limit 1;
    -- Deliberately lenient: a UC typed in before the registry existed may not
    -- resolve. Keep the text and link nothing, rather than refusing to invoice
    -- — an unlinked invoice is recoverable, a blocked one stops the business.
    if v_ucid is null then v_ucno := btrim(p_uc_no); end if;

  else
    insert into public.uc_registry (year, customer, currency, status, created_by)
    values ('/' || p_year, p_customer, p_currency, 'open', p_created_by)
    returning uc_registry.id, uc_registry.uc_no || '/' || p_year into v_ucid, v_ucno;
  end if;

  insert into public.app_sales_invoice
    (si_no, year, uc_id, uc_no, order_id, customer, currency, invoiced_at, created_by)
  values
    (v_si, p_year, v_ucid, v_ucno, p_order_id, p_customer, p_currency, current_date, p_created_by)
  returning app_sales_invoice.id into v_id;

  return query select v_si, v_ucno, v_ucid, v_id;
end $$;

revoke all on function public.allocate_sales_invoice(text,text,text,text,bigint,text,text) from anon, authenticated;
grant execute on function public.allocate_sales_invoice(text,text,text,text,bigint,text,text) to service_role;
notify pgrst, 'reload schema';
