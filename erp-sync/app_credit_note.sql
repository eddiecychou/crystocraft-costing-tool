-- ── App-issued credit notes (Sales Return / Credit Note Phase C) ──────────────
-- Same split as app_sales_invoice.sql's own header principle: the WORKING
-- record lives in Firestore (credit_notes/{id}, editable, no financial weight
-- yet); this table holds only the PERMANENT financial fact, written once, at
-- the moment a credit note is posted. There is no 'draft' row here — a row's
-- mere existence in this table means it was posted. Never allocates a new
-- UC/SI (Cindy, 2026-08-17): a credit note only ever references one already
-- issued.
--
-- Numbering: CN + a sequence number + '/' + 2-digit year, e.g. 'CN600/26'.
-- Unlike SI/SO/PU (which reset every year), the sequence NEVER resets —
-- same shape as UC#, confirmed directly (Cindy, 2026-08-17: "CN number does
-- not reset back to 001 each year"). JES's last real credit note was
-- CN581/26; seeded to start at 600 so the app's first number can't collide
-- with it (Cindy, 2026-08-18).
create sequence if not exists public.cn_seq start with 600;

create table if not exists public.app_credit_note (
  id                 bigserial primary key,
  cn_no              text        not null unique,
  year               text        not null,             -- '26' — a label; the sequence itself never resets
  uc_id              bigint      references public.uc_registry(id),
  uc_no              text,                              -- denormalised
  si_no              text,                              -- original invoice, reference only
  order_id           text,                              -- the Firestore order, if any
  customer           text,
  channel            text,
  currency           text,
  -- system_amount = calculated from lines; accounting_amount = what finance
  -- actually records; adjustment = the gap between them. Never a silent
  -- overwrite of system_amount — same rule as app_sales_invoice's total vs
  -- accounting_total.
  system_amount      numeric,
  accounting_amount  numeric,
  adjustment         numeric,
  adjustment_reason  text,
  -- Record only — Cindy, 2026-08-17: "Do not post restock to stock ledger.
  -- It is for record-only." No code path may ever turn this into a stock
  -- movement.
  disposition        text,
  reason             text,
  remarks            text,                              -- printed above the signature on the credit note
  lines              jsonb,                              -- [{item_code, description, qty_returned, unit, unit_price}]
  record_date        date,
  accounting_date    date,
  marketplace_ref    text,
  firestore_id       text,                              -- the credit_notes/{id} working doc this was posted from
  -- Voids are recorded, never deleted — same posture as app_sales_invoice.
  status             text        not null default 'posted',
  created_at         timestamptz not null default now(),
  created_by         text,
  voided_at          timestamptz,
  voided_by          text,
  updated_at         timestamptz,
  updated_by         text
);

create index if not exists app_credit_note_year_idx on public.app_credit_note (year);
create index if not exists app_credit_note_uc_idx   on public.app_credit_note (uc_id);
create index if not exists app_credit_note_order_idx on public.app_credit_note (order_id);

-- Allocate the CN number and insert the posted fact, atomically — same
-- reasoning as allocate_sales_invoice: number and record either both land or
-- neither does. SECURITY DEFINER for the same reason too (service_role has no
-- broader grant on uc_registry than this function needs).
create or replace function public.allocate_credit_note(
  p_firestore_id      text,
  p_customer          text default '',
  p_channel           text default '',
  p_currency          text default 'HKD',
  p_order_id          text default null,
  p_uc_id             bigint default null,
  p_uc_no             text default null,      -- full form, e.g. 'UC4791/25'
  p_si_no             text default null,
  p_system_amount     numeric default null,
  p_accounting_amount numeric default null,
  p_adjustment_reason text default null,
  p_disposition       text default null,
  p_reason            text default null,
  p_remarks           text default null,
  p_lines             jsonb default '[]'::jsonb,
  p_record_date       date default null,
  p_accounting_date   date default null,
  p_marketplace_ref   text default null,
  p_created_by        text default null
) returns table (o_cn_no text, o_id bigint)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_year text := to_char(current_date, 'YY');
  v_cn   text;
  v_id   bigint;
  v_ucid bigint;
  v_ucno text;
  v_accounting numeric;
  v_adjustment numeric;
begin
  v_cn := 'CN' || nextval('public.cn_seq')::text || '/' || v_year;

  -- Reference only — resolve to a uc_registry row when possible, but never
  -- allocate a new one (Cindy, 2026-08-17). A UC typed in before the registry
  -- existed may not resolve; keep the text and link nothing rather than
  -- refusing to post.
  if p_uc_id is not null then
    select r.id, r.uc_no || coalesce(r.year, '') into v_ucid, v_ucno
      from public.uc_registry r where r.id = p_uc_id;
  elsif coalesce(btrim(p_uc_no), '') <> '' then
    select r.id, r.uc_no || coalesce(r.year, '') into v_ucid, v_ucno
      from public.uc_registry r
     where r.uc_no || coalesce(r.year, '') = btrim(p_uc_no)
     limit 1;
    if v_ucid is null then v_ucno := btrim(p_uc_no); end if;
  end if;

  v_accounting := coalesce(p_accounting_amount, p_system_amount, 0);
  v_adjustment := v_accounting - coalesce(p_system_amount, 0);

  insert into public.app_credit_note
    (cn_no, year, uc_id, uc_no, si_no, order_id, customer, channel, currency,
     system_amount, accounting_amount, adjustment, adjustment_reason,
     disposition, reason, remarks, lines, record_date, accounting_date,
     marketplace_ref, firestore_id, created_by)
  values
    (v_cn, v_year, v_ucid, v_ucno, p_si_no, p_order_id, p_customer, p_channel, p_currency,
     p_system_amount, v_accounting, v_adjustment, p_adjustment_reason,
     p_disposition, p_reason, p_remarks, p_lines, p_record_date, p_accounting_date,
     p_marketplace_ref, p_firestore_id, p_created_by)
  returning app_credit_note.id into v_id;

  return query select v_cn, v_id;
end $$;

-- Void — flips status, never deletes. Idempotent: voiding an already-void
-- row is a no-op, not an error, so a retried request can't fail loudly for
-- no reason.
create or replace function public.void_credit_note(p_id bigint, p_voided_by text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.app_credit_note
     set status = 'void', voided_at = now(), voided_by = p_voided_by, updated_at = now()
   where id = p_id and status <> 'void';
end $$;

-- ── Change audit ─────────────────────────────────────────────────────────────
-- Same posture as bank_accounts_audit / app_sales_invoice_audit: append-only,
-- SECURITY DEFINER trigger, service_role gets SELECT only.
create table if not exists public.credit_note_audit (
  id              bigint generated always as identity primary key,
  credit_note_id  bigint,
  action          text        not null,          -- insert | update | delete
  changed_at      timestamptz not null default now(),
  changed_by      text,
  before          jsonb,
  after           jsonb
);

create or replace function public.credit_note_audit_fn() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.credit_note_audit (credit_note_id, action, changed_by, before, after)
  values (
    coalesce(new.id, old.id),
    lower(tg_op),
    coalesce(new.voided_by, new.updated_by, new.created_by, old.updated_by),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

drop trigger if exists trg_credit_note_audit on public.app_credit_note;
create trigger trg_credit_note_audit after insert or update or delete on public.app_credit_note
  for each row execute function public.credit_note_audit_fn();

-- ── Access: server-side only (same posture as app_sales_invoice / uc_registry) ─
revoke all on public.app_credit_note, public.credit_note_audit from anon, authenticated;
grant select, insert, update on public.app_credit_note to service_role;
grant select on public.credit_note_audit to service_role;
grant usage, select on sequence public.cn_seq to service_role;

revoke all on function public.allocate_credit_note(
  text, text, text, text, text, bigint, text, text, numeric, numeric, text, text, text, text, jsonb, date, date, text, text
) from anon, authenticated;
grant execute on function public.allocate_credit_note(
  text, text, text, text, text, bigint, text, text, numeric, numeric, text, text, text, text, jsonb, date, date, text, text
) to service_role;

revoke all on function public.void_credit_note(bigint, text) from anon, authenticated;
grant execute on function public.void_credit_note(bigint, text) to service_role;

notify pgrst, 'reload schema';
