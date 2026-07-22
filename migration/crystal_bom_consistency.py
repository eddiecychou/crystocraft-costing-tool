#!/usr/bin/env python3
"""Do per-unit crystal quantities agree between job orders for the same code?

The whole crystal-BOM plan rests on deriving requirements from joborderbom
rather than typing them. That only works if a code's per-unit stone counts are
stable across the jobs that built it. D0092 was stable across four jobs spanning
2023-2026; this checks every code the app's Range maps onto.

Per (joitemcode, crystal item code): compute jbqty / joqty for each job, then
report whether every job agrees.

Read-only.
"""
import json, os, collections, dotenv, psycopg2
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
dotenv.load_dotenv(os.path.join(ROOT, "erp-sync", ".env"))

products = json.load(open(os.path.join(HERE, "out", "range_products.json")))["products"]

# Every ERP finished-good code the app could plausibly map onto: the app knows
# design+format+brand+plating, so match on that prefix and let the ERP supply
# whatever colour codes it actually built.
# Keyed on brand+design and format only. Slicing the code by character count
# was wrong — the codes are not fixed width — and matching on the first two
# hyphen-separated fields is both exact and length-independent. Plating and
# colour are deliberately left off so the ERP supplies whatever it built.
bases = set()
for p in products:
    d, f = str(p.get("design_code") or ""), str(p.get("format_code") or "")
    for v in p.get("variants") or []:
        b = v.get("brand_code") or ""
        if b and d and f:
            bases.add(f"{b}{d}-{f}")

conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"])
cur = conn.cursor()

# joqty and jbqty are text in the mirror (every column is). Guard the cast and
# drop zero-quantity jobs, which would divide by zero rather than tell us
# anything.
cur.execute(
    """
    select h.joitemcode, h.jono, b.jbitemcode,
           sum(b.jbqty::numeric) / max(h.joqty::numeric) as per_unit
      from raw.joborderheader h
      join raw.joborderbom b on b.jbjono = h.jono
     where b.jbitemtype = 'ST'
       and h.joqty ~ '^[0-9]+(\\.[0-9]+)?$' and h.joqty::numeric > 0
       and b.jbqty ~ '^[0-9]+(\\.[0-9]+)?$'
       and split_part(h.joitemcode,'-',1) || '-' || split_part(h.joitemcode,'-',2) = any(%s)
     group by 1, 2, 3
    """,
    (sorted(bases),),
)

# code -> crystal item -> {per_unit -> [jobs]}
obs = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
for code, jono, item, per in cur.fetchall():
    obs[code][item][per.normalize()].append(jono)

single_job, agree, disagree = [], [], []
for code, items in obs.items():
    jobs = {j for i in items.values() for v in i.values() for j in v}
    if len(jobs) == 1:
        single_job.append(code)
    elif all(len(v) == 1 for v in items.values()):
        agree.append(code)
    else:
        disagree.append(code)

total = len(obs)
print(f"ERP codes matching an app product prefix: {total}")
print(f"  built once only  (nothing to compare) : {len(single_job)}")
print(f"  built 2+ times, every job agrees       : {len(agree)}")
print(f"  built 2+ times, jobs DISAGREE          : {len(disagree)}")
multi = len(agree) + len(disagree)
if multi:
    print(f"\n  agreement rate among comparable codes : {len(agree)}/{multi} = {100*len(agree)/multi:.1f}%")

print("\nsample disagreements:")
for code in sorted(disagree)[:8]:
    print(f"  {code}")
    for item, vals in sorted(obs[code].items()):
        if len(vals) > 1:
            spread = ", ".join(f"{v} x{len(j)}" for v, j in sorted(vals.items()))
            print(f"     {item:22s} {spread}")

json.dump(
    {"agree": sorted(agree), "disagree": sorted(disagree), "single_job": sorted(single_job)},
    open(os.path.join(HERE, "out", "crystal_bom_consistency.json"), "w"),
    indent=2,
)
print("\n-> migration/out/crystal_bom_consistency.json")
