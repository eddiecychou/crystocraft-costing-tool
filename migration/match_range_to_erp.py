#!/usr/bin/env python3
"""Match app range_products variants onto ERP finished-good codes.

The app composes a SKU as {brand_code}{design_code}-{format_code}-{plating_code}
and carries the colour/mix code separately in variant.crystal_colors. The ERP's
joborderheader.joitemcode appends the colour code to that same string:

    D0001 - 001 - G + MX  ->  D0001-001-GMX

This builds every candidate and reports how many the ERP has actually built,
which is what decides whether the crystal BOM can be derived rather than typed.

Read-only against both the JSON dump and the Supabase mirror.
"""
import json, os, collections, dotenv, psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
dotenv.load_dotenv(os.path.join(ROOT, "erp-sync", ".env"))

products = json.load(open(os.path.join(HERE, "out", "range_products.json")))["products"]

# candidate ERP code -> list of (design_code, format_code, sku, colour_code)
cands = collections.defaultdict(list)
no_variants = []
for p in products:
    design, fmt = str(p.get("design_code") or ""), str(p.get("format_code") or "")
    variants = p.get("variants") or []
    if not variants:
        no_variants.append(design)
        continue
    for v in variants:
        brand, plating = (v.get("brand_code") or ""), (v.get("plating_code") or "")
        if not (brand and design and fmt and plating):
            continue
        base = f"{brand}{design}-{fmt}-{plating}"
        colours = v.get("crystal_colors") or [""]
        for col in colours:
            cands[f"{base}{col}"].append((design, fmt, v.get("sku"), col))

print(f"products: {len(products)}  without variants: {len(no_variants)}")
print(f"candidate ERP codes: {len(cands)}")

conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"])
cur = conn.cursor()
codes = list(cands)

# Which of these has the ERP ever built, and does that job carry crystal lines?
cur.execute(
    """
    select h.joitemcode,
           count(distinct h.jono)                                        as jobs,
           max(h.joissuedate)                                            as last_job,
           count(*) filter (where b.jbitemtype = 'ST')                   as st_lines
      from raw.joborderheader h
      left join raw.joborderbom b on b.jbjono = h.jono
     where h.joitemcode = any(%s)
     group by 1
    """,
    (codes,),
)
found = {r[0]: r[1:] for r in cur.fetchall()}

with_st = {k for k, v in found.items() if v[2] > 0}
print(f"  built by ERP at some point : {len(found)}")
print(f"  ...and carrying crystal BOM: {len(with_st)}")
print(f"  never built                : {len(codes) - len(found)}")

# Coverage per product: can we derive a crystal BOM for at least one variant?
per_design = collections.defaultdict(set)
for code in with_st:
    for design, fmt, sku, col in cands[code]:
        per_design[design].add(code)
covered = {p["design_code"] for p in products if p["design_code"] in per_design}
print(f"\ndesigns with at least one derivable variant: {len(covered)} / "
      f"{len({p['design_code'] for p in products})}")

# Split the misses: is it the mix code that fails, or the whole base?
miss_by_colour = collections.Counter()
for code in codes:
    if code in with_st:
        continue
    for design, fmt, sku, col in cands[code]:
        miss_by_colour[col] += 1
print("\ntop unmatched colour/mix codes:")
for col, n in miss_by_colour.most_common(15):
    print(f"  {col or '(none)':8s} {n}")

json.dump(
    {
        "matched": sorted(with_st),
        "unmatched": sorted(set(codes) - with_st),
        "designs_covered": sorted(covered),
    },
    open(os.path.join(HERE, "out", "range_erp_match.json"), "w"),
    indent=2,
)
print("\n-> migration/out/range_erp_match.json")
