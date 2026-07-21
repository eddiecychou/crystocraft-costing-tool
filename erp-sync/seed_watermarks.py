"""Seed meta.sync_state watermarks before the first incremental run.

WHY THIS EXISTS
---------------
`tables.yaml` enables incremental mode for seven tables, but every row in
meta.sync_state still has last_watermark = NULL (checked 2026-07-21). In
sync.py, a NULL watermark means *no WHERE clause* — so the "first incremental
run" would pull every row of every one of those tables and push it through the
UPSERT path instead of TRUNCATE+INSERT. For ItemDetail (10,346,277 rows) that
is not "minutes instead of five hours"; it is materially slower than the full
load it replaced.

So the first run needs a starting watermark. The safe one is a timestamp
comfortably BEFORE the full load that populated the mirror, so that anything
edited since is re-pulled. Those full loads ran 2026-07-19 08:45–13:16 UTC
(= 16:45–21:16 HK). JES writes LastUpdate in local time, so seeding
2026-07-19 00:00:00 sits before all of them in either timezone — it re-pulls
about two and a half days of changes and cannot skip an edit.

Erring in the other direction (seeding too late) would silently drop edits,
which is the exact failure the incremental probe was meant to rule out. If in
doubt, move SEED earlier, never later.

Usage (from erp-sync/, LAN not required — this only touches Supabase):

    .venv/bin/python seed_watermarks.py --dry-run
    .venv/bin/python seed_watermarks.py

Then run the sync as normal. Afterwards, meta.sync_state should show real
watermarks and small row counts for these tables.
"""

import argparse
import os

import psycopg2
from dotenv import load_dotenv

# Before every full load in the 2026-07-19 pass, in JES local time and UTC both.
SEED = "2026-07-19 00:00:00"

# The seven tables set to incremental in tables.yaml. JobOrderBOM is absent on
# purpose: it is still mode=full and must not be given a watermark.
TABLES = [
    "item",
    "itemdetail",
    "itemtransaction",
    "salesorder",
    "salesorderdetail",
    "salesinvoice",
    "purchase",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--seed", default=SEED, help=f"watermark to write (default {SEED})")
    args = ap.parse_args()

    load_dotenv()
    conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"])
    cur = conn.cursor()

    cur.execute(
        "SELECT table_name, last_watermark, row_count FROM meta.sync_state "
        "WHERE table_name = ANY(%s) ORDER BY table_name",
        (TABLES,),
    )
    rows = cur.fetchall()

    missing = set(TABLES) - {r[0] for r in rows}
    if missing:
        raise SystemExit(f"not in meta.sync_state — run a full sync first: {sorted(missing)}")

    already = [r[0] for r in rows if r[1] is not None]
    if already:
        # A non-null watermark means a real incremental run has happened.
        # Overwriting it with an older seed is harmless (it re-pulls), but
        # overwriting with a newer one would skip rows — so stop and let a
        # human decide rather than guessing.
        raise SystemExit(
            f"already have watermarks, refusing to overwrite: {already}\n"
            "If you really mean to re-seed, clear them by hand first."
        )

    for name, _, count in rows:
        print(f"{name:20} {count:>10,} rows  ->  watermark {args.seed}")

    if args.dry_run:
        print("\n[dry run] nothing written")
        return

    cur.execute(
        "UPDATE meta.sync_state SET last_watermark = %s WHERE table_name = ANY(%s)",
        (args.seed, TABLES),
    )
    conn.commit()
    print(f"\nseeded {cur.rowcount} tables")


if __name__ == "__main__":
    main()
