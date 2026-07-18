"""Parse a PBIS 'POSTED JOURNAL LISTING' report (.RPT) and reconcile it.

PBIS is the separate accounting system (on Cindy's machine) where the books are
actually kept — JES's own GL was never used. Its journal lines carry BOTH the
JES invoice number and the app's UC number:

    SALES INVOICE SI250040 / UC4743/

which makes this report the join between all three systems: JES (SI), the app's
uc_registry (UC#), and the books (PBIS).

Read-only. Usage:

    .venv/bin/python parse_pbis.py ~/Desktop/INVOICE.RPT           # summary
    .venv/bin/python parse_pbis.py ~/Desktop/INVOICE.RPT --reconcile
"""
import argparse
import os
import re
import sys
from collections import defaultdict

# A voucher header line. PBIS emits two layouts: FORMAT : DETAIL has an
# ENT.DATE column, FORMAT : SIMPLE does not — so ENT.DATE is optional here.
# SJ25010001  14/04/2025  11/03/2026  202501   SJ   20/02/2026   SI250040  ...
# PU25010001  26/04/2025  11/03/2026  202501   PU     PU250001   ...
HEADER = re.compile(
    r"^(?P<voucher>[A-Z]{2}\d{8})\s+"
    r"(?P<txn>\d{2}/\d{2}/\d{4})\s+"
    r"(?P<pst>\d{2}/\d{2}/\d{4})\s+"
    r"(?P<period>\d{6})\s+"
    r"(?P<type>[A-Z]{2})\s+"
    r"(?:(?P<ent>\d{2}/\d{2}/\d{4})\s+)?"
    r"(?P<ref>\S+)\s*"
    r"(?P<desc>.*)$"
)

# A posting line, e.g.
#        1  51-1       Sales                     C13  SI250040   ...  484.00
POSTING = re.compile(
    r"^\s+(?P<seq>\d+)\s+(?P<account>[\d-]+)\s+(?P<acct_name>.{1,40}?)\s{2,}"
    r"(?P<rest>.*)$"
)

MONEY = re.compile(r"([\d,]+\.\d{2})")
UC = re.compile(r"\bUC\s?(\d{3,6})\b", re.I)
DOC = re.compile(r"\b(SI\d{6}|PU\d{6}|SO\d{6})\b", re.I)
CUR = re.compile(r"\b(HKD|USD|RMB|EUR|GBP|CNY|AUD|CAD)\b")


def parse(path):
    """-> [{voucher, txn_date, period, type, ref, desc, uc, doc, currency,
            amount, accounts:[...]}]"""
    vouchers = []
    cur = None
    # PBIS writes Big5 (the same legacy code page as the ERP), not latin-1 —
    # reading it as latin-1 turns every Chinese vendor/customer name into
    # mojibake. errors="replace" so one bad byte can't abort the parse.
    with open(path, encoding="cp950", errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip("\n").rstrip("\r")
            if not line.strip() or line.startswith("-"):
                continue

            m = HEADER.match(line)
            if m:
                g = m.groupdict()
                cur = {
                    "voucher": g["voucher"], "txn_date": g["txn"], "pst_date": g["pst"],
                    "period": g["period"], "type": g["type"],
                    "ent_date": g.get("ent") or "",
                    "ref": g["ref"], "desc": g["desc"].strip(),
                    "uc": None, "doc": None, "currency": "HKD", "amount": None,
                    "accounts": [],
                }
                d = DOC.search(g["ref"] + " " + g["desc"])
                if d:
                    cur["doc"] = d.group(1).upper()
                vouchers.append(cur)
                continue

            if cur is None:
                continue

            p = POSTING.match(line)
            if p:
                cur["accounts"].append((p.group("account"), p.group("acct_name").strip()))

            # UC / currency / amount can appear on the posting or continuation
            # lines, so scan every line belonging to the voucher.
            u = UC.search(line)
            if u and not cur["uc"]:
                cur["uc"] = "UC" + u.group(1)
            c = CUR.search(line)
            if c:
                cur["currency"] = c.group(1)
            if cur["amount"] is None:
                amts = MONEY.findall(line)
                if amts:
                    cur["amount"] = float(amts[0].replace(",", ""))
            if not cur["doc"]:
                d = DOC.search(line)
                if d:
                    cur["doc"] = d.group(1).upper()

    return vouchers


def summarise(vs, path):
    print(f"\n{os.path.basename(path)} — {len(vs):,} vouchers")
    if not vs:
        print("  nothing parsed — the layout may differ again; check the header row.")
        return
    by_type = defaultdict(int)
    by_period = defaultdict(int)
    by_cur = defaultdict(float)
    for v in vs:
        by_type[v["type"]] += 1
        by_period[v["period"]] += 1
        by_cur[v["currency"]] += v["amount"] or 0

    print("  types:  ", dict(by_type))
    print("  periods:", f"{min(by_period)} … {max(by_period)}  ({len(by_period)} periods)")
    print("  totals by currency (first amount per voucher — indicative):")
    for c, t in sorted(by_cur.items(), key=lambda x: -x[1]):
        print(f"    {c}  {t:>14,.2f}")

    with_uc = [v for v in vs if v["uc"]]
    with_doc = [v for v in vs if v["doc"]]
    print(f"  carry a UC number:   {len(with_uc):,} / {len(vs):,}")
    print(f"  carry a doc number:  {len(with_doc):,} / {len(vs):,}")

    # Posting lag: books are kept well behind the transaction date.
    lags = []
    for v in vs:
        try:
            d = lambda s: tuple(int(x) for x in s.split("/")[::-1])
            t, p = d(v["txn_date"]), d(v["pst_date"])
            lags.append((p[0] - t[0]) * 365 + (p[1] - t[1]) * 30 + (p[2] - t[2]))
        except Exception:
            pass
    if lags:
        lags.sort()
        print(f"  posting lag (txn -> posted): median ~{lags[len(lags)//2]} days, "
              f"max ~{lags[-1]} days")

    accounts = defaultdict(int)
    for v in vs:
        for acc, name in v["accounts"]:
            accounts[(acc, name)] += 1
    print("  accounts used:")
    for (acc, name), n in sorted(accounts.items(), key=lambda x: -x[1])[:12]:
        print(f"    {acc:<10} {name[:34]:<36} {n:>6,}")


def reconcile(vs):
    """Cross-check the UC numbers in the books against public.uc_registry."""
    import psycopg2
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

    book = {}
    for v in vs:
        if v["uc"]:
            book[v["uc"]] = v

    with psycopg2.connect(os.environ["SUPABASE_DB_URL"]) as conn, conn.cursor() as cur:
        cur.execute("select upper(uc_no), jes_si, currency, total, status from public.uc_registry")
        reg = {r[0]: r[1:] for r in cur.fetchall()}

    in_both = set(book) & set(reg)
    only_books = set(book) - set(reg)
    only_reg = set(reg) - set(book)

    print(f"\nUC cross-check — books vs uc_registry")
    print(f"  UC numbers in this report : {len(book):,}")
    print(f"  in the registry too       : {len(in_both):,}")
    print(f"  in the BOOKS but not the registry : {len(only_books):,}")
    if only_books:
        print("    (a posted sale the registry never recorded — investigate)")
        for uc in sorted(only_books)[:15]:
            v = book[uc]
            print(f"      {uc:<9} {v['doc'] or '':<10} {v['txn_date']}  {v['currency']} {v['amount']}")

    # SI number agreement, where both sides have one.
    mismatch = []
    for uc in sorted(in_both):
        b_doc = book[uc]["doc"]
        r_si = (reg[uc][0] or "").strip().upper()
        if b_doc and r_si and b_doc != r_si:
            mismatch.append((uc, b_doc, r_si))
    print(f"  SI number disagrees       : {len(mismatch):,}")
    for uc, b, r in mismatch[:15]:
        print(f"      {uc:<9} books={b:<10} registry={r}")

    print(f"  in the registry but not in this report : {len(only_reg):,} "
          f"(expected — the report covers one journal type and period range)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--reconcile", action="store_true",
                    help="cross-check UC numbers against public.uc_registry")
    a = ap.parse_args()
    if not os.path.exists(a.path):
        sys.exit(f"Not found: {a.path}")
    vs = parse(a.path)
    summarise(vs, a.path)
    if a.reconcile:
        reconcile(vs)


if __name__ == "__main__":
    main()
