-- SH-05A: permissions only. Do not replay app_sales_invoice.sql on production.
-- See docs/plans/V8.20-INVOICE-ALLOCATOR-PERMISSIONS.md before applying.
-- Generated with the pinned Supabase v2 migration-file command in an unlinked
-- local workspace. No invoice, UC, sequence, table or function body is changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

do $permissions$
declare
  target oid := to_regprocedure('public.allocate_sales_invoice(text,text,text,text,bigint,text,text)');
  definition text;
begin
  if target is null or (
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='allocate_sales_invoice'
  ) <> 1 then
    raise exception 'Expected one reviewed seven-argument invoice allocator; inspect overloads first';
  end if;
  if not exists (
    select 1 from pg_proc p where p.oid=target and p.prokind='f'
      and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef
      and p.proconfig=array['search_path=public, pg_temp']::text[]
  ) then
    raise exception 'Invoice allocator owner/security configuration changed; review before hardening';
  end if;
  definition := pg_get_functiondef(target);

  revoke all on function public.allocate_sales_invoice(text,text,text,text,bigint,text,text)
    from public, anon, authenticated;
  grant execute on function public.allocate_sales_invoice(text,text,text,text,bigint,text,text)
    to service_role;

  if has_function_privilege('anon',target,'EXECUTE')
    or has_function_privilege('authenticated',target,'EXECUTE')
    or not has_function_privilege('service_role',target,'EXECUTE') then
    raise exception 'Effective invoice execution grants do not match server-only access';
  end if;
  if pg_get_functiondef(target) is distinct from definition then
    raise exception 'Invoice allocator definition changed during permissions migration';
  end if;
end $permissions$;

notify pgrst, 'reload schema';
commit;
