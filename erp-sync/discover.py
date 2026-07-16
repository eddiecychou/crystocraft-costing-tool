#!/usr/bin/env python3
"""
On-site schema discovery — READ-ONLY. Run this once you can connect, to see the
REAL table names, row counts, and total DB size. Use the output to (a) sanity-
check the DB size against the Supabase free tier (500 MB, README Step 0b), and
(b) fill in tables.yaml with actual table names instead of the placeholders.

    python discover.py                 # list every user table + row count
    python discover.py --yaml          # also print a tables.yaml starter block
    python discover.py --top 40        # only the 40 largest tables

It reuses sync.py's connection code, so it honours the same .env / SOURCE_ENGINE
/ MSSQL_DRIVER_KIND. It runs only SELECTs against system catalogs and cannot
modify the ERP.
"""
import argparse
from sync import src_conn, SOURCE_ENGINE

# ── per-engine catalog queries ────────────────────────────────────────────────
# MSSQL: sys.partitions gives fast (approximate) row counts with no COUNT(*).
MSSQL_TABLES = """
    SELECT s.name AS schema_name, t.name AS table_name,
           SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END) AS rows
    FROM sys.tables t
    JOIN sys.schemas s   ON s.schema_id = t.schema_id
    JOIN sys.partitions p ON p.object_id = t.object_id
    GROUP BY s.name, t.name
    ORDER BY rows DESC, s.name, t.name
"""
MSSQL_DBSIZE = """
    SELECT CAST(SUM(a.total_pages) * 8.0 / 1024 AS DECIMAL(12,1))
    FROM sys.allocation_units a
"""

# Firebird: no cheap rowcount, so COUNT(*) per user table (can be slow on huge DBs).
FB_TABLES = """
    SELECT TRIM(RDB$RELATION_NAME)
    FROM RDB$RELATIONS
    WHERE RDB$SYSTEM_FLAG = 0 AND RDB$VIEW_BLR IS NULL
    ORDER BY 1
"""


def discover_mssql(conn):
    cur = conn.cursor()
    cur.execute(MSSQL_TABLES)
    rows = [(f"{r[0]}.{r[1]}" if r[0] != "dbo" else r[1], r[1], int(r[2] or 0))
            for r in cur.fetchall()]
    cur.execute(MSSQL_DBSIZE)
    db_mb = cur.fetchone()[0]
    cur.close()
    return rows, float(db_mb or 0)


def discover_firebird(conn):
    cur = conn.cursor()
    cur.execute(FB_TABLES)
    names = [r[0] for r in cur.fetchall()]
    out = []
    for name in names:
        c2 = conn.cursor()
        try:
            c2.execute(f'SELECT COUNT(*) FROM "{name}"')
            n = int(c2.fetchone()[0])
        except Exception:
            n = -1  # couldn't count (permission/lock) — flag, don't crash
        finally:
            c2.close()
        out.append((name, name, n))
    cur.close()
    out.sort(key=lambda t: (-t[2], t[0]))
    return out, None  # Firebird DB size: check the .fdb file size on DB12


def main():
    ap = argparse.ArgumentParser(description="Read-only ERP schema discovery")
    ap.add_argument("--yaml", action="store_true", help="print a tables.yaml starter block")
    ap.add_argument("--top", type=int, default=0, help="only show the N largest tables")
    args = ap.parse_args()

    with src_conn() as conn:
        if SOURCE_ENGINE == "mssql":
            rows, db_mb = discover_mssql(conn)
        else:
            rows, db_mb = discover_firebird(conn)

    shown = rows[: args.top] if args.top else rows
    total_rows = sum(n for _, _, n in rows if n > 0)

    print(f"\nengine={SOURCE_ENGINE}   tables={len(rows)}   total rows≈{total_rows:,}")
    if db_mb is not None:
        tier = "OK for free tier" if db_mb < 400 else "OVER ~400 MB — see README Step 0b"
        print(f"total DB size ≈ {db_mb:,.1f} MB   ({tier})")
    else:
        print("DB size: check the .fdb file size directly on DB12 (Firebird)")
    print("-" * 60)
    print(f"{'rows':>12}  table")
    for full, _short, n in shown:
        print(f"{n:>12,}  {full}" if n >= 0 else f"{'?':>12}  {full}  (count failed)")

    if args.yaml:
        print("\n# ── tables.yaml starter (review before using; set pk per table) ──")
        for full, short, n in shown:
            mode = "full" if 0 <= n < 100_000 else "incremental  # large: needs pk + watermark"
            print(f"  - source: {short}\n    mode: {mode}")


if __name__ == "__main__":
    main()
