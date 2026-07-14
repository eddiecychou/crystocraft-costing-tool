#!/usr/bin/env python3
"""
ERP -> Supabase one-way sync.

Design goals (see README.md for the full plan):
  * READ-ONLY on the source ERP database. It can never write to the ERP.
  * Idempotent: any run can be repeated safely.
  * Lands a near-verbatim mirror in the Postgres `raw` schema (all columns as
    text). You build curated tables/views in a separate `app` schema later.
  * Two modes per table:
      - full        : atomic TRUNCATE + reload inside one transaction.
      - incremental : upsert rows newer than the stored watermark.
  * Never installs anything on the servers. Run this from your laptop.

Usage:
    python sync.py --dry-run                 # read source, write nothing, report counts
    python sync.py --table Customer          # sync just one table
    python sync.py --table Customer --dry-run
    python sync.py                           # sync every table in tables.yaml

Credentials come from a local .env file (see .env.example). Nothing secret
belongs in this file or in tables.yaml.
"""
import os
import sys
import argparse
import logging
import datetime as dt

import yaml
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

# ── logging: console + file ───────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("sync.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("erp-sync")

SOURCE_ENGINE = os.environ.get("SOURCE_ENGINE", "mssql").lower()

# ── dialect differences between MSSQL and Firebird ────────────────────────────
# The only things that differ per engine are (a) how you ask for "0 rows" just
# to read the column list, and (b) how identifiers are quoted. Everything else
# is standard SQL. If your ERP turns out to be Firebird/Interbase, set
# SOURCE_ENGINE=firebird in .env and `pip install firebird-driver`.
DIALECTS = {
    "mssql": {
        "cols_query": lambda schema, table: f"SELECT TOP 0 * FROM [{schema}].[{table}]",
        "q": lambda name: f"[{name}]",
    },
    "firebird": {
        # Firebird has no schemas; `schema` is ignored. FIRST 0 == TOP 0.
        "cols_query": lambda schema, table: f'SELECT FIRST 0 * FROM "{table}"',
        "q": lambda name: f'"{name}"',
    },
}
if SOURCE_ENGINE not in DIALECTS:
    sys.exit(f"Unknown SOURCE_ENGINE={SOURCE_ENGINE!r}. Use 'mssql' or 'firebird'.")
D = DIALECTS[SOURCE_ENGINE]


# ── source connection (READ-ONLY) ─────────────────────────────────────────────
def src_conn():
    if SOURCE_ENGINE == "mssql":
        import pyodbc  # imported here so a Firebird-only setup doesn't need pyodbc
        # `Encrypt=no;TrustServerCertificate=yes` avoids TLS handshake failures
        # against older SQL Server versions. If the connection is refused, first
        # confirm the port/firewall with a GUI client (DBeaver / Azure Data Studio).
        conn = pyodbc.connect(
            f"DRIVER={{{os.environ.get('MSSQL_DRIVER', 'ODBC Driver 18 for SQL Server')}}};"
            f"SERVER={os.environ['MSSQL_HOST']},{os.environ.get('MSSQL_PORT', '1433')};"
            f"DATABASE={os.environ['MSSQL_DB']};"
            f"UID={os.environ['MSSQL_USER']};PWD={os.environ['MSSQL_PWD']};"
            f"Encrypt=no;TrustServerCertificate=yes;",
            timeout=30,
        )
        conn.autocommit = True          # read-only; no transactions needed on source
        try:
            conn.readonly = True        # belt-and-suspenders: driver-level read-only
        except Exception:
            pass
        return conn

    # firebird
    import firebird.driver as fb        # pip install firebird-driver
    return fb.connect(
        f"{os.environ['FB_HOST']}/{os.environ.get('FB_PORT', '3050')}:{os.environ['FB_DATABASE']}",
        user=os.environ["FB_USER"],
        password=os.environ["FB_PWD"],
    )


# ── target connection (Supabase Postgres) ─────────────────────────────────────
def dst_conn():
    # Use the DIRECT / session connection string (port 5432), not the API keys.
    return psycopg2.connect(os.environ["SUPABASE_DB_URL"])


# ── small helpers ─────────────────────────────────────────────────────────────
def qi(name):
    """Quote a Postgres identifier safely (lower-cased to keep the mirror tidy)."""
    return '"' + name.lower().replace('"', '""') + '"'


def get_source_columns(sconn, schema, table):
    cur = sconn.cursor()
    cur.execute(D["cols_query"](schema, table))
    cols = [d[0] for d in cur.description]
    cur.close()
    return cols


def read_batches(sconn, schema, table, cols, where_sql, params, batch_size):
    cur = sconn.cursor()
    collist = ", ".join(D["q"](c) for c in cols)
    src_table = D["q"](table) if SOURCE_ENGINE == "firebird" else f"{D['q'](schema)}.{D['q'](table)}"
    cur.execute(f"SELECT {collist} FROM {src_table} {where_sql}", params or [])
    while True:
        rows = cur.fetchmany(batch_size)
        if not rows:
            break
        yield rows
    cur.close()


def source_max(sconn, schema, table, col):
    cur = sconn.cursor()
    src_table = D["q"](table) if SOURCE_ENGINE == "firebird" else f"{D['q'](schema)}.{D['q'](table)}"
    cur.execute(f"SELECT MAX({D['q'](col)}) FROM {src_table}")
    val = cur.fetchone()[0]
    cur.close()
    return None if val is None else str(val)


# ── target schema / metadata ──────────────────────────────────────────────────
def ensure_meta(dconn):
    with dconn.cursor() as c:
        c.execute("CREATE SCHEMA IF NOT EXISTS meta;")
        c.execute("""
            CREATE TABLE IF NOT EXISTS meta.sync_state (
                table_name     text PRIMARY KEY,
                last_watermark text,
                last_run_at    timestamptz,
                row_count      bigint
            );
        """)
    dconn.commit()


def ensure_target_table(dconn, tcfg, cols):
    schema = tcfg["target_schema"]
    tbl = tcfg["target"]
    with dconn.cursor() as c:
        c.execute(f"CREATE SCHEMA IF NOT EXISTS {qi(schema)};")
        coldefs = ", ".join(f"{qi(col)} text" for col in cols)
        c.execute(f"CREATE TABLE IF NOT EXISTS {qi(schema)}.{qi(tbl)} ({coldefs});")
        # Reconcile: add any source columns that appeared since last run.
        c.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema=%s AND table_name=%s
        """, (schema, tbl.lower()))
        existing = {r[0] for r in c.fetchall()}
        for col in cols:
            if col.lower() not in existing:
                c.execute(f"ALTER TABLE {qi(schema)}.{qi(tbl)} ADD COLUMN {qi(col)} text;")
                log.info("  + added new column %s.%s.%s", schema, tbl, col.lower())
    dconn.commit()


def get_watermark(dconn, tcfg):
    with dconn.cursor() as c:
        c.execute("SELECT last_watermark FROM meta.sync_state WHERE table_name=%s", (tcfg["target"],))
        row = c.fetchone()
    return row[0] if row else None


def set_state(dconn, tcfg, watermark, row_count):
    with dconn.cursor() as c:
        c.execute("""
            INSERT INTO meta.sync_state (table_name, last_watermark, last_run_at, row_count)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (table_name) DO UPDATE
              SET last_watermark = EXCLUDED.last_watermark,
                  last_run_at    = EXCLUDED.last_run_at,
                  row_count      = EXCLUDED.row_count
        """, (tcfg["target"], watermark, dt.datetime.now(dt.timezone.utc), row_count))
    dconn.commit()


def target_count(dconn, tcfg):
    with dconn.cursor() as c:
        c.execute(f"SELECT COUNT(*) FROM {qi(tcfg['target_schema'])}.{qi(tcfg['target'])}")
        return c.fetchone()[0]


# ── row writers ───────────────────────────────────────────────────────────────
def as_text_rows(batch):
    """Everything lands as text in the raw mirror — bulletproof against source
    type/encoding surprises. Cast to real types later in your app.* views."""
    return [tuple(None if v is None else str(v) for v in row) for row in batch]


def insert_rows(dcur, tcfg, cols, rows):
    tgt = f"{qi(tcfg['target_schema'])}.{qi(tcfg['target'])}"
    collist = ", ".join(qi(c) for c in cols)
    execute_values(dcur, f"INSERT INTO {tgt} ({collist}) VALUES %s", rows, page_size=1000)


def upsert_rows(dcur, tcfg, cols, rows):
    tgt = f"{qi(tcfg['target_schema'])}.{qi(tcfg['target'])}"
    collist = ", ".join(qi(c) for c in cols)
    pk = ", ".join(qi(c) for c in tcfg["pk"])
    pk_lower = {c.lower() for c in tcfg["pk"]}
    updates = ", ".join(f"{qi(c)}=EXCLUDED.{qi(c)}" for c in cols if c.lower() not in pk_lower)
    if not updates:
        # table is all-key: nothing to update, just skip duplicates
        sql = f"INSERT INTO {tgt} ({collist}) VALUES %s ON CONFLICT ({pk}) DO NOTHING"
    else:
        sql = f"INSERT INTO {tgt} ({collist}) VALUES %s ON CONFLICT ({pk}) DO UPDATE SET {updates}"
    execute_values(dcur, sql, rows, page_size=1000)


# ── per-table sync ────────────────────────────────────────────────────────────
def sync_table(sconn, dconn, tcfg, dry_run):
    src_schema, src_table = tcfg["source_schema"], tcfg["source"]
    cols = get_source_columns(sconn, src_schema, src_table)

    mode = tcfg["mode"]
    if mode == "incremental" and not tcfg.get("pk"):
        raise ValueError(f"{src_table}: incremental mode requires a 'pk' in tables.yaml")

    # Decide the WHERE clause + the new watermark to store on success.
    where_sql, params, new_watermark = "", [], None
    wm_col = tcfg.get("watermark")
    if mode == "incremental" and wm_col:
        # Capture MAX now; pull rows strictly greater than what we stored last run.
        new_watermark = source_max(sconn, src_schema, src_table, wm_col)
        last = get_watermark(dconn, tcfg)
        if last is not None:
            # Both pyodbc and firebird-driver use "?" as the parameter marker.
            where_sql = f"WHERE {D['q'](wm_col)} > ?"
            params = [last]

    total = 0
    if not dry_run:
        ensure_target_table(dconn, tcfg, cols)

    dcur = dconn.cursor()
    try:
        if mode == "full" and not dry_run:
            # Atomic: readers see the old data until COMMIT.
            dcur.execute(f"TRUNCATE {qi(tcfg['target_schema'])}.{qi(tcfg['target'])}")

        for batch in read_batches(sconn, src_schema, src_table, cols, where_sql, params,
                                  tcfg["batch_size"]):
            rows = as_text_rows(batch)
            total += len(rows)
            if dry_run:
                continue
            if mode == "full":
                insert_rows(dcur, tcfg, cols, rows)
            else:
                upsert_rows(dcur, tcfg, cols, rows)

        if dry_run:
            log.info("[DRY] %-28s would sync %7d rows (%s)", src_table, total, mode)
            dconn.rollback()
            return total

        dconn.commit()
    except Exception:
        dconn.rollback()
        raise
    finally:
        dcur.close()

    # Record state only after a clean commit.
    set_state(dconn, tcfg, new_watermark if new_watermark is not None else get_watermark(dconn, tcfg),
              target_count(dconn, tcfg))
    log.info("%-28s synced %7d rows (%s)  target now %d",
             src_table, total, mode, target_count(dconn, tcfg))
    return total


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="ERP -> Supabase one-way sync")
    ap.add_argument("--dry-run", action="store_true", help="read source, write nothing")
    ap.add_argument("--table", help="sync only this source table (by source name)")
    ap.add_argument("--config", default="tables.yaml")
    args = ap.parse_args()

    cfg = yaml.safe_load(open(args.config, encoding="utf-8"))
    defaults = cfg.get("defaults", {})
    tables = []
    for t in cfg["tables"]:
        if t.get("skip"):
            log.info("skipping %-24s (%s)", t["source"], t.get("reason", "flagged skip"))
            continue
        if args.table and t["source"] != args.table:
            continue
        merged = {**defaults, **t}
        merged["target"] = t.get("target", t["source"].lower())
        tables.append(merged)

    if not tables:
        sys.exit("No tables to sync (check --table name or tables.yaml).")

    log.info("=== ERP sync start | engine=%s | %d table(s) | %s ===",
             SOURCE_ENGINE, len(tables), "DRY-RUN" if args.dry_run else "LIVE")

    failed = []
    with src_conn() as sconn, dst_conn() as dconn:
        if not args.dry_run:
            ensure_meta(dconn)
        for tcfg in tables:
            try:
                sync_table(sconn, dconn, tcfg, args.dry_run)
            except Exception:
                try:
                    dconn.rollback()
                except Exception:
                    pass
                log.exception("FAILED table %s — continuing with the rest", tcfg["source"])
                failed.append(tcfg["source"])

    if failed:
        log.error("=== Finished WITH FAILURES: %s ===", ", ".join(failed))
        sys.exit(1)
    log.info("=== Finished cleanly ===")


if __name__ == "__main__":
    main()
