"""Re-verify the SO/SI seeds in src/soNumber.js against the mirror.

Run this AFTER a sync. The app allocates document numbers into JES's own
series, starting from a hardcoded seed (JES's last number for the year). If
JES has issued more numbers since the seed was measured, the app's first
allocation silently reuses a number JES already gave out.

CuiLing raised invoices on 20–21 Jul that the mirror had not seen when the
seeds were set on 2026-07-20, so SI26 in particular is expected to have moved.

Usage (from erp-sync/):

    .venv/bin/python check_doc_seeds.py

Prints the mirror's current max against the seed in soNumber.js and says
plainly whether the file needs editing. Read-only — it changes nothing.
"""

import os
import re
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

SO_NUMBER_JS = Path(__file__).resolve().parent.parent / "src" / "soNumber.js"


def parse_seeds(text, const_name):
    """Pull the {'26': 27, ...} block out of an exported const in soNumber.js."""
    m = re.search(rf"export const {const_name}\s*=\s*\{{(.*?)\}}", text, re.S)
    if not m:
        raise SystemExit(f"could not find {const_name} in {SO_NUMBER_JS}")
    return {yy: int(n) for yy, n in re.findall(r"'(\d\d)'\s*:\s*(\d+)", m.group(1))}


def main():
    load_dotenv()
    js = SO_NUMBER_JS.read_text()
    seeds = {
        "SO": parse_seeds(js, "JES_SEED_BY_YEAR"),
        "SI": parse_seeds(js, "JES_SI_SEED_BY_YEAR"),
    }

    conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"])
    cur = conn.cursor()

    # The mirror is all text, so slice the sequence off the document number and
    # cast — max() on the raw string would be wrong the moment widths differ.
    queries = {
        "SO": "SELECT max(substr(sono, 5)::int), count(*) FROM raw.salesorder WHERE sono LIKE %s",
        "SI": "SELECT max(substr(sino, 5)::int), count(*) FROM raw.salesinvoice WHERE sino LIKE %s",
    }

    stale = []
    for kind, by_year in seeds.items():
        for yy, seed in sorted(by_year.items(), reverse=True):
            cur.execute(queries[kind], (f"{kind}{yy}%",))
            actual, count = cur.fetchone()
            actual = actual or 0
            flag = "OK" if actual == seed else ("STALE" if actual > seed else "AHEAD OF JES")
            print(f"{kind}{yy}  seed {seed:>4}   mirror max {actual:>4}   ({count} rows)   {flag}")
            if actual > seed:
                stale.append((kind, yy, seed, actual))

    print()
    if not stale:
        print("Seeds match the mirror. No edit needed.")
        print("Note: this only proves the seed matches what the SYNC saw. If JES has")
        print("issued a number since the sync finished, this still reads OK.")
        return

    print(f"Edit {SO_NUMBER_JS.relative_to(SO_NUMBER_JS.parents[1])}:")
    for kind, yy, seed, actual in stale:
        const = "JES_SEED_BY_YEAR" if kind == "SO" else "JES_SI_SEED_BY_YEAR"
        print(f"  {const}['{yy}']: {seed} -> {actual}")


if __name__ == "__main__":
    main()
