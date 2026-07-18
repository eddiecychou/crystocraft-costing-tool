-- Survey of the item-master image references, ahead of syncing the image
-- folder itself. Read-only. The DB stores bare filenames (e.g. FM-2HRT.jpg);
-- the folder they live in is configured outside the database.
with latest as (
  select distinct on (itcode)
         itcode,
         nullif(trim(itpicture1), '') as p1,
         nullif(trim(itpicture2), '') as p2
  from raw.item
  order by itcode, nullif(itrevision, '')::int desc nulls last
),
files as (
  select p1 as name from latest where p1 is not null
  union
  select p2 from latest where p2 is not null
)
select
  (select count(*) from latest)                                  as item_codes,
  (select count(*) from latest where p1 is not null)              as with_primary,
  (select count(*) from files)                                    as distinct_files,
  (select count(*) from files where name !~* '\.(jpg|jpeg|png|bmp|gif)$') as bad_extension,
  (select count(*) from files where name ~ '[/\\]')               as has_slash,
  (select count(*) from files where name ~ '[<>:"|?*]')           as illegal_win,
  (select count(*) from files where name ~ '[^ -~]')              as non_ascii,
  (select count(*) from files where name <> btrim(name))          as untrimmed;
