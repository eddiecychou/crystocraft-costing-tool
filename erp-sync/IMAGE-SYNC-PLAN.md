# Item-master image sync — plan (prepared off-LAN, 2026-07-18)

The ERP stores item photos as files in a folder, with only the **filename** in
the database. Owner: low quality, but enough to show what an item looks like.

Everything below that could be worked out from the Supabase mirror has been.
What remains genuinely needs the office LAN, so this is written to make the
on-site part short.

## What the database says (already known — no LAN needed)

| | |
|---|---|
| Item codes (latest revision) | 44,460 |
| With a primary image | **31,823 (72%)** |
| Distinct image filenames (as stored) | 29,919 |
| **Distinct files, case-insensitively** | **29,460** |
| With a second image | 8,366 |

Those two counts differ by **459**: that many filenames differ from another
*only* by capitalisation. On Windows they are the same file, so lower-casing
isn't tidiness — without it we'd treat one photo as two and half the uploads
would 404 depending on which casing a row happened to store.

`raw.item.itpicture1` / `itpicture2` hold a bare filename — `FM-2HRT.jpg` — no
path. `itpicture1type` is `COLOR` (1.11 M rows), `SKETCH` (14.8 k), plus a few
Chinese equivalents (彩圖 / 草圖 / 其他).

**One image serves many item codes.** `FM-2HRT.jpg` is used by `#2HRT-1(CL)`,
`(PI)` and `(RE)` — a design's colour variants share a photo. That's why 31,823
codes need only 29,919 files, and it means the upload should key on **filename**,
not item code.

Exposed as `picture1` / `picture2` / `picture1_type` on `public.erp_item`
(lower-cased — see below). The files themselves are not synced yet, so these
are references to nothing until the folder is copied.

## Dirty data to expect (counted, not guessed)

- **179 filenames have a bad or missing extension** — `.jig`, `.jgp`, `.jp`,
  `u0171-081-grejpg` (the dot is missing), and some with no extension at all
  (`#D-C-PCK-1(GR)`).
- **31 filenames contain a forward slash** — `FM-A/H-1W.jpg`, `fm-c-chm-4/a.jpg`.
  A `/` is **illegal in a Windows filename**, so either the real file is named
  differently or the reference is simply wrong. Must be checked on disk; do not
  assume a mapping.
- **Casing is inconsistent** — `FM-C-S-CRR-w.jpg` next to `fm-c-chm-4/a.jpg`.
  Windows filesystems are case-insensitive so JES never cared, but **object
  storage is case-sensitive**. Hence lower-casing in `erp_item`; the uploader
  must lower-case its keys to match.
- 1 non-ASCII filename. No other Windows-illegal characters, no untrimmed names.

Expect roughly **200 of 29,919 (0.7%) to need manual attention** — small enough
to list and fix by hand, too many to ignore.

## On site (needs the LAN)

1. **Find the folder.** `systemsetting` has a dozen image-path columns but all
   are suffixed `_notuse`, so the live path is configured elsewhere — check
   `JES.ini` and the JES client's settings. *This is the one genuine unknown.*
2. Then steps 2–4 are one script, `sync_images.py`, already written and tested
   against the database half:

   ```
   .venv/bin/python sync_images.py --folder "<path>" --report   # safe, read-only
   .venv/bin/python sync_images.py --folder "<path>" --upload
   ```

   `--report` reconciles and changes nothing: matched / missing / orphaned
   counts, the total GB that would be uploaded, and a full list of broken
   references written to `inventory/images_missing.txt`. Run that first and
   check the numbers before `--upload`.

Upload needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env` (the same
values Netlify already uses). `--report` needs neither. Uploads are upserts,
so re-running after a partial failure is cheap.

## Where the files should live

**Supabase Storage**, not Firebase. The reference lives in `erp_item`, the
access path is already `/api/erp` (admin-gated, server-side key), and it keeps
ERP-derived data in one place. Firebase Storage holds *the app's own* product
images, which are a different thing — these are read-only ERP history and
shouldn't be mixed in with images the team edits.

Bucket `erp-item-images`, private, served through a signed URL from the edge
function. Sizing: 29,919 low-quality JPEGs at ~50–150 KB is roughly **1.5–4.5 GB**
— confirm from the actual folder before uploading, since it affects the plan.

## Then

- ERP Lookup → Items: show a thumbnail per row, full image on click.
- Later, and worth a separate decision: these could seed the product catalogue
  for items that have no app image yet. Owner's call — the quality is low, so
  they may be fine internally and not for customers.

## Incremental behaviour

Re-uploading 30 k files on every sync is wasteful. Upload only when the
filename is new or the source file's mtime/size has changed. Deletions in the
ERP folder should **not** delete from storage — an item whose photo was removed
should keep the last known image rather than showing nothing.
