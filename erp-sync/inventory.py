"""ERP archive inventory — read-only survey of the Supabase mirror.

V7.15 step 1: work out which of the ~494 mirrored JES tables actually carry live
business meaning, so we know what an ERP replacement has to cover. Writes a
machine-readable JSON plus a human-readable markdown report; touches nothing.

  python inventory.py schemas     # what's in the database at all
  python inventory.py tables      # exact row counts + sizes + column inventory
  python inventory.py recency     # max date per table (slow: no indexes in raw.*)
  python inventory.py report      # render markdown from the collected JSON
"""
import json
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

HERE = Path(__file__).parent
OUT = HERE / "inventory"
OUT.mkdir(exist_ok=True)

load_dotenv(HERE / ".env")
DSN = os.environ["SUPABASE_DB_URL"]


def connect():
    return psycopg2.connect(DSN)


def q(sql, params=None, timeout_ms=None):
    with connect() as conn, conn.cursor() as cur:
        if timeout_ms:
            cur.execute(f"SET statement_timeout = {int(timeout_ms)}")
        cur.execute(sql, params)
        return cur.fetchall()


def save(name, obj):
    path = OUT / name
    path.write_text(json.dumps(obj, indent=2, default=str))
    print(f"wrote {path} ({len(json.dumps(obj, default=str))/1024:.0f} KB)")


# ── schemas ───────────────────────────────────────────────────────────────────

def cmd_schemas():
    rows = q("""
        select table_schema,
               count(*) filter (where table_type = 'BASE TABLE') as tables,
               count(*) filter (where table_type = 'VIEW')       as views
        from information_schema.tables
        where table_schema not in ('pg_catalog', 'information_schema')
        group by 1 order by 2 desc nulls last
    """)
    for s, t, v in rows:
        print(f"  {s:<24} {t:>5} tables  {v:>4} views")

    mv = q("""
        select schemaname, matviewname from pg_matviews
        where schemaname not in ('pg_catalog', 'information_schema')
        order by 1, 2
    """)
    if mv:
        print("\n  materialized views:")
        for s, m in mv:
            print(f"    {s}.{m}")


# ── tables: exact counts, sizes, columns ──────────────────────────────────────

COUNTS_SQL = """
select c.relname                                   as table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %%I.%%I',
                                  n.nspname, c.relname),
                           false, true, '')))[1]::text::bigint as exact_rows,
       pg_total_relation_size(c.oid)               as total_bytes
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = %s and c.relkind = 'r'
order by 2 desc nulls last
"""


def cmd_tables(schema="raw"):
    print(f"counting rows in {schema}.* (exact, server-side)...")
    rows = q(COUNTS_SQL, (schema,), timeout_ms=15 * 60 * 1000)

    print(f"reading column metadata for {len(rows)} tables...")
    cols = q("""
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = %s
        order by table_name, ordinal_position
    """, (schema,))

    by_table = {}
    for t, col, dtype in cols:
        by_table.setdefault(t, []).append({"name": col, "type": dtype})

    data = [{
        "table": t,
        "rows": int(n) if n is not None else None,
        "bytes": int(b),
        "columns": by_table.get(t, []),
    } for t, n, b in rows]

    save(f"{schema}_tables.json", data)

    total_rows = sum(d["rows"] or 0 for d in data)
    empty = [d for d in data if not d["rows"]]
    print(f"\n  {len(data)} tables · {total_rows:,} rows · "
          f"{sum(d['bytes'] for d in data)/1e9:.2f} GB")
    print(f"  {len(empty)} tables are EMPTY (dead weight)")
    print(f"\n  top 25 by row count:")
    for d in data[:25]:
        print(f"    {d['table']:<32} {d['rows']:>12,}  {d['bytes']/1e6:>8.1f} MB")


# ── recency: how current is each table ────────────────────────────────────────

DATE_TYPES = ("date", "timestamp without time zone",
              "timestamp with time zone", "character varying")


def cmd_recency(schema="raw"):
    """Max value of each table's date-ish columns. Slow — raw.* has no indexes,
    so every one of these is a sequential scan. Skips empty tables."""
    data = json.loads((OUT / f"{schema}_tables.json").read_text())
    live = [d for d in data if d["rows"]]
    print(f"probing {len(live)} non-empty tables for recency (seq scans, slow)...")

    results = []
    for i, d in enumerate(live, 1):
        # Every column in the mirror is `text` (the sync stringifies), so type
        # tells us nothing — match on name instead. Values are ISO
        # ('2006-07-20 00:00:00'), which sorts correctly as text.
        datecols = [c["name"] for c in d["columns"]
                    if "date" in c["name"].lower()]
        if not datecols:
            results.append({"table": d["table"], "rows": d["rows"],
                            "latest": None, "date_column": None})
            continue

        # Don't trust the column NAME — 'lastupdateby' contains the substring
        # "date" but holds usernames. Only aggregate values that actually look
        # like an ISO date, so a mis-detected column contributes nothing.
        exprs = ", ".join(
            f"""max(case when "{c}" ~ '^[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}'
                         then "{c}" end)""" for c in datecols)
        try:
            row = q(f'select {exprs} from "{schema}"."{d["table"]}"',
                    timeout_ms=120 * 1000)[0]
            pairs = [(c, v) for c, v in zip(datecols, row) if v]
            best = max(pairs, key=lambda p: p[1]) if pairs else (None, None)
            results.append({"table": d["table"], "rows": d["rows"],
                            "latest": best[1], "date_column": best[0]})
        except Exception as e:  # timeout or bad data — record and move on
            results.append({"table": d["table"], "rows": d["rows"],
                            "latest": None, "date_column": None,
                            "error": str(e).strip()[:120]})

        if i % 25 == 0:
            print(f"  {i}/{len(live)}...")

    save(f"{schema}_recency.json", results)
    dated = [r for r in results if r["latest"]]
    dated.sort(key=lambda r: r["latest"], reverse=True)
    print(f"\n  most recently active tables:")
    for r in dated[:30]:
        print(f"    {r['table']:<32} {r['latest'][:10]}  {r['rows']:>10,}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "schemas"
    {"schemas": cmd_schemas, "tables": cmd_tables, "recency": cmd_recency}[cmd]()
