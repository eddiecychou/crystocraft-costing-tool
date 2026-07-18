"""Item-master images: reconcile the ERP image folder against the references,
then upload the matched files to Supabase Storage.

Run at the office (the folder is on the LAN; the database side is cloud).

    # 1. See what's there before moving anything — read-only, safe.
    .venv/bin/python sync_images.py --folder "/Volumes/JES/Images" --report

    # 2. Upload the matched files.
    .venv/bin/python sync_images.py --folder "/Volumes/JES/Images" --upload

Background and counts: IMAGE-SYNC-PLAN.md. The short version — the ERP stores a
bare filename (FM-2HRT.jpg) with no path, 31,823 of 44,460 item codes have one,
but only 29,919 DISTINCT files, because a design's colour variants share a
photo. So we key on FILENAME, not item code.

Matching is case-insensitive: the ERP's casing is inconsistent
(FM-C-S-CRR-w.jpg beside fm-c-chm-4/a.jpg), Windows never cared, and object
storage does. Everything is stored lower-cased to match erp_item.picture1.
"""
import argparse
import os
import sys
from collections import defaultdict

import psycopg2
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))

BUCKET = "erp-item-images"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".gif"}


def referenced_files():
    """{lower_filename: [item_code, ...]} from the latest revision of each item."""
    sql = """
        with latest as (
          select distinct on (itcode)
                 itcode,
                 lower(nullif(trim(itpicture1), '')) as p1,
                 lower(nullif(trim(itpicture2), '')) as p2
          from raw.item
          order by itcode, nullif(itrevision, '')::int desc nulls last
        )
        select itcode, p1, p2 from latest where p1 is not null or p2 is not null
    """
    refs = defaultdict(list)
    with psycopg2.connect(os.environ["SUPABASE_DB_URL"]) as conn, conn.cursor() as cur:
        cur.execute(sql)
        for code, p1, p2 in cur.fetchall():
            for name in (p1, p2):
                if name:
                    refs[name].append(code)
    return refs


def scan_folder(folder):
    """{lower_filename: full_path}. Recursive — the folder may have subdirectories,
    and a filename is unique enough to key on (verified: no duplicates expected,
    but we report any we find rather than silently picking one)."""
    found, dupes = {}, defaultdict(list)
    for root, _dirs, files in os.walk(folder):
        for fn in files:
            key = fn.lower()
            path = os.path.join(root, fn)
            if key in found:
                dupes[key].append(path)
            else:
                found[key] = path
    return found, dupes


def report(refs, found, dupes, folder):
    ref_names = set(refs)
    disk_names = set(found)
    images_on_disk = {n for n in disk_names if os.path.splitext(n)[1] in IMAGE_EXT}

    matched = ref_names & disk_names
    missing = ref_names - disk_names
    orphans = images_on_disk - ref_names

    total_bytes = sum(os.path.getsize(found[n]) for n in matched)

    print(f"\nFolder: {folder}")
    print(f"  files on disk            {len(disk_names):>8,}   (images: {len(images_on_disk):,})")
    print(f"  referenced by the ERP    {len(ref_names):>8,}")
    print(f"  MATCHED (would upload)   {len(matched):>8,}   {total_bytes / 1e9:.2f} GB")
    print(f"  referenced but MISSING   {len(missing):>8,}")
    print(f"  on disk, never referenced{len(orphans):>8,}   (not uploaded)")
    if dupes:
        print(f"  !! same filename in >1 folder: {len(dupes):,} — first match wins; check these")

    if missing:
        # These are the broken references the plan predicted (~200: bad
        # extensions, embedded '/', etc). Listed so they can be fixed by hand.
        print(f"\n  First 25 missing — the item codes using them lose their image:")
        for name in sorted(missing)[:25]:
            codes = refs[name]
            print(f"    {name:<44} {len(codes):>4} item(s)  e.g. {codes[0]}")
        out = os.path.join(HERE, "inventory", "images_missing.txt")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w") as f:
            for name in sorted(missing):
                f.write(f"{name}\t{len(refs[name])}\t{','.join(refs[name][:5])}\n")
        print(f"  full list -> {out}")

    return matched


def upload(matched, found):
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Upload needs SUPABASE_URL and SUPABASE_SECRET_KEY in erp-sync/.env "
                 "(the same values Netlify uses). Report mode needs neither.")
    import urllib.request

    def put(name, path):
        with open(path, "rb") as fh:
            body = fh.read()
        req = urllib.request.Request(
            f"{url}/storage/v1/object/{BUCKET}/{name}",
            data=body, method="POST",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "image/jpeg",
                # Re-runnable: replace rather than fail on an existing object.
                "x-upsert": "true",
            },
        )
        urllib.request.urlopen(req, timeout=60).read()

    done = failed = 0
    for i, name in enumerate(sorted(matched), 1):
        try:
            put(name, found[name])
            done += 1
        except Exception as e:
            failed += 1
            if failed <= 10:
                print(f"  ! {name}: {type(e).__name__} {str(e)[:90]}")
        if i % 500 == 0:
            print(f"  {i:,}/{len(matched):,} uploaded ({failed} failed)")
    print(f"\nUploaded {done:,}, failed {failed:,}, bucket '{BUCKET}'.")
    if failed:
        print("Re-run to retry — uploads are upserts, so already-copied files are cheap.")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--folder", required=True, help="ERP image folder (LAN path or mounted share)")
    ap.add_argument("--report", action="store_true", help="reconcile only, change nothing (default)")
    ap.add_argument("--upload", action="store_true", help="upload matched files to Supabase Storage")
    args = ap.parse_args()

    if not os.path.isdir(args.folder):
        sys.exit(f"Not a folder: {args.folder}")

    print("Reading image references from the mirror…")
    refs = referenced_files()
    print(f"  {len(refs):,} distinct filenames referenced")

    print("Scanning the folder…")
    found, dupes = scan_folder(args.folder)

    matched = report(refs, found, dupes, args.folder)

    if args.upload:
        print(f"\nUploading {len(matched):,} files to '{BUCKET}'…")
        upload(matched, found)
    else:
        print("\nReport only — nothing uploaded. Re-run with --upload when the "
              "numbers above look right.")


if __name__ == "__main__":
    main()
