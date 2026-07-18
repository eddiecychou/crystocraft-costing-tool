"""Does LastUpdate actually move when a row is EDITED?

Incremental sync pulls rows where LastUpdate > watermark. That is only safe if
JES writes LastUpdate on every UPDATE, not just on INSERT. If it doesn't, an
edited row is silently skipped for ever — quietly wrong, which is worse than
today's slow-but-correct full replace.

This cannot be reasoned out from the mirror; it needs the live server. Run it
at the office, ON THE LAN:

    cd erp-sync && .venv/bin/python probe_lastupdate.py

READ-ONLY. It never writes to the ERP. The evidence is statistical: if a table
only ever set LastUpdate at insert time, its LastUpdate values would sit in
lockstep with the document dates and never drift later. Rows whose LastUpdate
is clearly AFTER the document date are proof that an edit refreshed it.
"""
import os
import sys

from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))

sys.path.insert(0, HERE)
# D['q'] is the SOURCE-side quoter ([brackets] for SQL Server). NOT sync.qi,
# which quotes and lower-cases for POSTGRES — wrong dialect for this script.
from sync import src_conn, D

# The four giants incremental sync would target first, with the document-date
# column to compare LastUpdate against.
TARGETS = [
    ("Item",            "ItemCode",   None),
    ("ItemDetail",      "IDItemCode", None),
    ("SalesOrderDetail", "SDSONo",    None),
    ("ItemTransaction", "ITPK",       "ITDate"),
    ("SalesOrder",      "SONo",       "SODate"),
    ("SalesInvoice",    "SINo",       "SIDate"),
    ("Purchase",        "PUNo",       "PUDate"),
]


def probe(cur, table, pk, datecol):
    print(f"\n=== {table} ===")

    cur.execute(f"SELECT COUNT(*) FROM dbo.{D['q'](table)}")
    total = cur.fetchone()[0]

    cur.execute(f"SELECT COUNT(*) FROM dbo.{D['q'](table)} WHERE LastUpdate IS NULL")
    nulls = cur.fetchone()[0]
    print(f"  rows: {total:,}   LastUpdate NULL: {nulls:,}")
    if nulls:
        print(f"  !! {nulls:,} rows have NO LastUpdate — incremental sync would "
              f"never pick them up. They need a full pass at least once.")

    cur.execute(f"SELECT MIN(LastUpdate), MAX(LastUpdate) FROM dbo.{D['q'](table)}")
    lo, hi = cur.fetchone()
    print(f"  LastUpdate range: {lo} .. {hi}")

    if not datecol:
        print("  (no document date to compare against — see the sampled rows below)")
    else:
        # If LastUpdate were insert-only it would never sit meaningfully after
        # the document date. Count rows where it does, by margin.
        cur.execute(f"""
            SELECT
              SUM(CASE WHEN DATEDIFF(day, {D['q'](datecol)}, LastUpdate) > 1   THEN 1 ELSE 0 END),
              SUM(CASE WHEN DATEDIFF(day, {D['q'](datecol)}, LastUpdate) > 30  THEN 1 ELSE 0 END),
              SUM(CASE WHEN DATEDIFF(day, {D['q'](datecol)}, LastUpdate) > 365 THEN 1 ELSE 0 END),
              COUNT(*)
            FROM dbo.{D['q'](table)}
            WHERE LastUpdate IS NOT NULL AND {D['q'](datecol)} IS NOT NULL
        """)
        d1, d30, d365, n = cur.fetchone()
        print(f"  LastUpdate later than {datecol}:  >1d {d1:,}   >30d {d30:,}   >1y {d365:,}   (of {n:,})")
        if n:
            pct = 100.0 * (d30 or 0) / n
            if pct > 1:
                print(f"  => {pct:.1f}% were touched well after creation: LastUpdate "
                      f"DOES move on edit. Incremental sync is safe for this table.")
            else:
                print(f"  => only {pct:.2f}% differ. Either this table is genuinely "
                      f"never edited, or LastUpdate is INSERT-ONLY. Do not enable "
                      f"incremental for it on this evidence alone — confirm by "
                      f"editing one record in JES and re-running (see below).")

    # A single row's own history is the clearest signal available read-only.
    cur.execute(f"""
        SELECT TOP 3 {D['q'](pk)}, LastUpdate, LastUpdatedBy
        FROM dbo.{D['q'](table)} WHERE LastUpdate IS NOT NULL ORDER BY LastUpdate DESC
    """)
    print("  most recently touched:")
    for r in cur.fetchall():
        print(f"    {str(r[0])[:28]:<30} {r[1]}  {r[2]}")


def main():
    print("Probing LastUpdate semantics on the LIVE ERP (read-only).")
    with src_conn() as sconn:
        cur = sconn.cursor()
        for table, pk, datecol in TARGETS:
            try:
                probe(cur, table, pk, datecol)
            except Exception as e:
                print(f"\n=== {table} ===\n  probe failed: {type(e).__name__}: {str(e)[:160]}")

    print("""
─────────────────────────────────────────────────────────────────────────────
DEFINITIVE CHECK (2 minutes, needs JES open)

The statistics above are strong evidence, not proof. To be certain:

  1. Note a row's LastUpdate from the output above.
  2. In JES, open that record, change something harmless (a remark), save.
  3. Re-run this script.

If LastUpdate moved, incremental sync is safe. If it did NOT move, incremental
sync would silently miss every edit — keep that table on full mode. Record the
answer per table in PROJECT-PLAN.md; it decides the whole approach.
─────────────────────────────────────────────────────────────────────────────""")


if __name__ == "__main__":
    main()
