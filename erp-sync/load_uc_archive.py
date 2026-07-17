#!/usr/bin/env python3
"""
One-time (re-runnable) loader for the legacy "Invoice Check List" spreadsheet
into Supabase as a read-only, searchable archive (public.erp_uc_archive).

This is the FULL UC# history (the master invoice registry that predates the
app). The live/editable UC registry lives in Firestore; this table is only the
historical archive, queried by the app via /api/erp (entity: uc_archive).

Usage:  python3 load_uc_archive.py "/path/to/Invoice_Check_lists.xls"
Needs:  pip install xlrd   (and the .env SUPABASE_DB_URL)
"""
import sys, re
import xlrd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import dotenv_values

XLS = sys.argv[1] if len(sys.argv) > 1 else "Invoice_Check_lists.xls"
SHEET, HDR = "INVOICE UC#", 3   # header on row 3 (0-based), data below

wb = xlrd.open_workbook(XLS); dm = wb.datemode
s = wb.sheet_by_name(SHEET)

def num(v):
    if v in (None, ""): return None
    if isinstance(v, (int, float)): return float(v)
    t = re.sub(r"[^0-9.\-]", "", str(v).replace(",", ""))
    try: return float(t) if t not in ("", "-", ".", "-.") else None
    except Exception: return None

def dtxt(r, c):
    if s.cell_type(r, c) == 3:  # Excel date serial
        try: return xlrd.xldate.xldate_as_datetime(s.cell_value(r, c), dm).date().isoformat()
        except Exception: return None
    return str(s.cell_value(r, c)).strip() or None

def txt(r, c):
    return str(s.cell_value(r, c)).strip() or None

rows = []
for r in range(HDR + 1, s.nrows):
    uc = (str(s.cell_value(r, 1)).strip())
    if not uc:
        continue
    rows.append((
        uc, txt(r, 2), txt(r, 0), txt(r, 3), txt(r, 4), txt(r, 5), txt(r, 6), txt(r, 7),
        num(s.cell_value(r, 8)), txt(r, 8), num(s.cell_value(r, 9)), num(s.cell_value(r, 10)),
        dtxt(r, 11), txt(r, 12), txt(r, 13), txt(r, 14), num(s.cell_value(r, 15)),
        txt(r, 16), dtxt(r, 17), r,
    ))

conn = psycopg2.connect(dotenv_values(".env")["SUPABASE_DB_URL"]); conn.autocommit = True
c = conn.cursor()
c.execute("""
drop table if exists public.erp_uc_archive cascade;
create table public.erp_uc_archive (
  uc_no text, year text, pic text, jes_si text, month text, order_no text, customer text,
  currency text, total numeric, total_raw text, deposit numeric, os_balance numeric,
  bal_pay_date text, shipment text, remarks text, confirmed text, shipping_cost numeric,
  customs text, delivery_date text, src_row int);
""")
execute_values(c, """insert into public.erp_uc_archive
 (uc_no,year,pic,jes_si,month,order_no,customer,currency,total,total_raw,deposit,os_balance,
  bal_pay_date,shipment,remarks,confirmed,shipping_cost,customs,delivery_date,src_row) values %s""",
  rows, page_size=1000)
c.execute("create extension if not exists pg_trgm")
c.execute("create index on public.erp_uc_archive using gin (uc_no gin_trgm_ops)")
c.execute("create index on public.erp_uc_archive using gin (customer gin_trgm_ops)")
c.execute("create index on public.erp_uc_archive (jes_si)")
c.execute("revoke all on public.erp_uc_archive from anon, authenticated")
c.execute("grant select on public.erp_uc_archive to service_role")
c.execute("notify pgrst, 'reload schema'")
c.execute("select count(*), max(uc_no) from public.erp_uc_archive")
print("loaded rows / max uc_no:", c.fetchone())
conn.close()
