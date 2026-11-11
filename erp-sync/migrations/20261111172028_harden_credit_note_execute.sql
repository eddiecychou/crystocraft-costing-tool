-- Restrict execution on the reviewed credit-note functions.
-- Apply this migration to existing databases. app_credit_note.sql is setup SQL.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

do $permissions$
declare
  allocate_oid oid := to_regprocedure('public.allocate_credit_note(text,text,text,text,text,bigint,text,text,numeric,numeric,text,text,text,text,jsonb,date,date,text,text)');
  void_oid oid := to_regprocedure('public.void_credit_note(bigint,text)');
  audit_oid oid := to_regprocedure('public.credit_note_audit_fn()');
  service_oid oid := 'service_role'::regrole;
  target record;
begin
  if allocate_oid is null or void_oid is null or audit_oid is null or (
    select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('allocate_credit_note', 'void_credit_note', 'credit_note_audit_fn')
  ) <> 3 then
    raise exception 'Expected exactly the three reviewed credit-note signatures; inspect overloads';
  end if;

  for target in
    select * from (values
      (allocate_oid, '2812506bb2706ce5c595b1e819404558'),
      (void_oid, '63a6e86d34b877957d2dfa541c69753c'),
      (audit_oid, '89bbd27778f46f82dca42b6e270983c5')
    ) as reviewed(function_oid, definition_md5)
  loop
    if not exists (
      select 1 from pg_proc p
      where p.oid = target.function_oid
        and p.proowner = 'postgres'::regrole
        and p.prosecdef
        and p.proconfig = array['search_path=public, pg_temp']
        and md5(pg_get_functiondef(p.oid)) = target.definition_md5
    ) then
      raise exception 'Credit-note function definition or owner changed: %', target.function_oid::regprocedure;
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.app_credit_note'::regclass
      and tgname = 'trg_credit_note_audit'
      and tgfoid = audit_oid
      and tgenabled in ('O', 'A')
      and tgtype = 29 -- AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW
  ) then
    raise exception 'Credit-note audit trigger changed; review before restricting access';
  end if;

  revoke execute on function public.allocate_credit_note(
    text,text,text,text,text,bigint,text,text,numeric,numeric,text,text,text,text,jsonb,date,date,text,text
  ), public.void_credit_note(bigint,text) from public, anon, authenticated;
  grant execute on function public.allocate_credit_note(
    text,text,text,text,text,bigint,text,text,numeric,numeric,text,text,text,text,jsonb,date,date,text,text
  ), public.void_credit_note(bigint,text) to service_role;
  revoke execute on function public.credit_note_audit_fn() from public, anon, authenticated, service_role;

  if exists (
    select 1 from pg_proc p
    where p.oid in (allocate_oid, void_oid, audit_oid)
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE') <> (p.oid <> audit_oid)
        or exists (
          select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where acl.grantee <> p.proowner
            and (p.oid = audit_oid or acl.grantee <> service_oid or acl.is_grantable)
        )
      )
  ) then
    raise exception 'Credit-note execution grants do not match the reviewed access';
  end if;
end $permissions$;

notify pgrst, 'reload schema';
commit;
