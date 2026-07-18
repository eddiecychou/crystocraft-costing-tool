-- "This component code isn't used by any current BOM — what do the BOMs use?"
--
-- Searching the whole item master by a text stem was useless: FM-124PT02.01-C
-- reduced to the stem "FM" and returned every FM part in the ERP. Two better
-- signals, both restricted to components that CURRENT BOMs actually use:
--
--   1. The same code with the `.NN` segment removed. The superseded in-house
--      codes carry one — FM-124PT02.01-C -> FM-124PT02-C (463 BOMs),
--      FM-K(32).03-C -> FM-K(32)-C (526). Right ~34% of the time, and when it
--      is right it is exactly right, so it goes first.
--   2. Otherwise, used components sharing the longest prefix, most-used first.
--
-- Suggestions, not answers: the caller shows them for a human to choose.
create or replace function public.erp_code_alternatives(p_code text)
returns table (code text, bom_count int, name text, reason text)
language sql stable as $$
  with q as (
    select upper(trim(p_code)) as c,
           upper(regexp_replace(trim(p_code), '\.[0-9]{1,2}', '', 'g')) as s
  ),
  exact as (
    select u.code, u.bom_count, i.name,
           'same code without the .NN segment'::text as reason,
           0 as ord, 999 as common
    from q
    join public.erp_component_usage u on upper(u.code) = q.s and upper(u.code) <> q.c
    left join public.erp_item i on i.code = u.code
  ),
  near as (
    select u.code, u.bom_count, i.name,
           'similar code, used by current BOMs'::text as reason,
           1 as ord,
           (select max(n) from generate_series(4, least(length(q.c), length(u.code))) n
             where left(upper(u.code), n) = left(q.c, n)) as common
    from q
    join public.erp_component_usage u
      on left(upper(u.code), 4) = left(q.c, 4) and upper(u.code) <> q.c
    left join public.erp_item i on i.code = u.code
    where u.bom_count > 0
  )
  select code, bom_count, name, reason from (
    select * from exact
    union all
    select * from near where code not in (select code from exact)
  ) t
  where common is not null
  order by ord, common desc, bom_count desc
  limit 10;
$$;

revoke all on function public.erp_code_alternatives(text) from anon, authenticated;
grant execute on function public.erp_code_alternatives(text) to service_role;

notify pgrst, 'reload schema';
