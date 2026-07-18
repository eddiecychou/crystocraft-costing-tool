-- Crystocraft's own bank accounts for RECEIVING customer payments.
-- Single source of truth, replacing the free-text bank details retyped into
-- every quote/PI. Supplier remittance accounts are deliberately NOT here — they
-- are a BEC-fraud target and need their own change-audit design.
--
-- Why one row per currency: a customer wiring USD into an HKD account gets a
-- forced conversion or a rejection. The document must pick the account matching
-- the invoice currency, so `is_default` is enforced per currency, not globally.
--
-- Read/written only through /api/bank (admin-gated, server-side secret key),
-- like uc_registry. No anon/authenticated grants.

create table if not exists public.bank_accounts (
  id              bigint generated always as identity primary key,
  currency        text        not null,
  label           text,                    -- e.g. "Main USD"
  bank_name       text        not null,
  bank_address    text,
  beneficiary     text        not null,    -- account holder as the bank has it
  account_no      text,
  swift           text,
  iban            text,
  intermediary    text,                    -- correspondent bank, when required
  notes           text,
  is_default      boolean     not null default false,
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),
  created_by      text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

-- Currency is used as a key, so normalise it rather than trusting the caller.
create or replace function public.bank_accounts_norm() returns trigger
language plpgsql as $$
begin
  new.currency := upper(trim(new.currency));
  new.swift    := nullif(upper(regexp_replace(coalesce(new.swift, ''), '\s', '', 'g')), '');
  new.iban     := nullif(upper(regexp_replace(coalesce(new.iban,  ''), '\s', '', 'g')), '');
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_bank_accounts_norm on public.bank_accounts;
create trigger trg_bank_accounts_norm before insert or update on public.bank_accounts
  for each row execute function public.bank_accounts_norm();

-- At most one default per currency, enforced by the database rather than by
-- application code — two defaults would silently make document rendering
-- depend on row order.
create unique index if not exists ux_bank_default_per_currency
  on public.bank_accounts (currency) where is_default and active;

create index if not exists ix_bank_currency on public.bank_accounts (currency) where active;

-- ── Change audit ─────────────────────────────────────────────────────────────
-- Every write is recorded. These values move money; "who changed this account
-- number and when" must be answerable without guessing. Append-only.
create table if not exists public.bank_accounts_audit (
  id          bigint generated always as identity primary key,
  account_id  bigint,
  action      text        not null,          -- insert | update | delete
  changed_at  timestamptz not null default now(),
  changed_by  text,
  before      jsonb,
  after       jsonb
);

-- SECURITY DEFINER on purpose. The trigger has to insert into the audit table,
-- but service_role (what PostgREST/the API connects as) is deliberately granted
-- only SELECT there — so the API can read history and cannot forge, alter or
-- delete it. Running as the function owner is what lets the trigger write while
-- keeping the log append-only from the application's side.
-- search_path is pinned, as it must be for any SECURITY DEFINER function.
create or replace function public.bank_accounts_audit_fn() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.bank_accounts_audit (account_id, action, changed_by, before, after)
  values (
    coalesce(new.id, old.id),
    lower(tg_op),
    coalesce(new.updated_by, old.updated_by),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

drop trigger if exists trg_bank_accounts_audit on public.bank_accounts;
create trigger trg_bank_accounts_audit after insert or update or delete on public.bank_accounts
  for each row execute function public.bank_accounts_audit_fn();

-- ── Access: server-side only (same posture as uc_registry / erp_*) ───────────
revoke all on public.bank_accounts, public.bank_accounts_audit from anon, authenticated;
grant select, insert, update, delete on public.bank_accounts to service_role;
grant select on public.bank_accounts_audit to service_role;

notify pgrst, 'reload schema';
