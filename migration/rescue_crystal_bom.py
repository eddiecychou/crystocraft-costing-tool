#!/usr/bin/env python3
"""Propose crystal BOMs for the products the direct derivation could not reach.

107 of 288 products have no crystal BOM. None are genuinely crystal-free: 98
have crystal lines in the ERP under *some* route letter or format, and the rest
are new designs. So the stones exist — they are just recorded against a code
the app no longer sells.

Two rescues, in order of confidence:

  other route   The app sells D0018-001; the ERP only ever built U0018-001.
                Same design, different supplier for the stones. The skeleton
                (how many stones of each shape and size) should carry over;
                the families filling those positions will not.
  other format  The app sells 0023-236 (music box); the ERP only has 0023-001
                (freestand). Same figurine on a different base, so the crystal
                content should be identical — but that is an assumption about
                how the product is built, not something the data states.

Both are inferences. This writes a review table, never Firestore. The evidence
column carries the ERP code each proposal came from so it can be checked.

  out: migration/out/crystal_bom_rescue.csv
       migration/out/crystal_bom_rescue.json
"""
import json, os, csv, collections, dotenv, psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUTDIR = os.path.join(HERE, "out")
dotenv.load_dotenv(os.path.join(ROOT, "erp-sync", ".env"))

# Reuse the shape/position rules rather than restating them — two copies of this
# logic already drifted once this cycle and broke every plain colourway.
import importlib.util
spec = importlib.util.spec_from_file_location(
    "derive", os.path.join(HERE, "derive_crystal_bom.py"))

# derive_crystal_bom.py runs its whole pipeline on import, so the helpers are
# lifted out by re-reading the file rather than executing it.
src = open(os.path.join(HERE, "derive_crystal_bom.py")).read()
ns = {}
start = src.index("SHAPE = {")
end = src.index("# Every colourway the app offers")
exec("import re, collections\n" + src[start:end], ns)
position, split_crystal = ns["position"], ns["split_crystal"]

products = json.load(open(os.path.join(OUTDIR, "range_products.json")))["products"]
uncovered = [p for p in products if not (
    p.get("crystal_components") and (
        p["crystal_components"].get("positions") or p["crystal_components"].get("mixes")))]

conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"])
cur = conn.cursor()

# Every ERP finished-good code with crystal lines, keyed by design and format.
cur.execute(
    """
    with ranked as (
      select iditemcode, idsubitemcode, idqty,
             dense_rank() over (partition by iditemcode
                                order by idrevision::int desc) as rk
        from raw.itemdetail
       where iditemtype = 'ST'
         and iditemcode ~ '^[A-Z][0-9A-Z]{3,4}-'
         and idqty ~ '^[0-9]+(\\.[0-9]+)?$'
         and idrevision ~ '^[0-9]+$'
    )
    select iditemcode, idsubitemcode, sum(idqty::numeric)
      from ranked where rk = 1 group by 1, 2
    """
)
erp = collections.defaultdict(dict)
for code, item, qty in cur.fetchall():
    erp[code][item] = qty

crystal_codes = sorted({i for lines in erp.values() for i in lines})
cur.execute(
    """
    with n as (select itcode, itshortdesc1,
                      row_number() over (partition by itcode
                                         order by itrevision::int desc) rn
                 from raw.item where itcode = any(%s) and itrevision ~ '^[0-9]+$')
    select itcode, itshortdesc1 from n where rn = 1
    """,
    (crystal_codes,),
)
names = dict(cur.fetchall())

# When was each finished-good code last built? Used to pick the most recent
# route as the predecessor rather than pooling every route that ever existed.
cur.execute(
    """
    select joitemcode, max(joissuedate)::text
      from raw.joborderheader
     where joitemcode ~ '^[A-Z][0-9A-Z]{3,4}-'
     group by 1
    """
)
last_built = dict(cur.fetchall())

# index: design -> format -> route -> [erp codes]
by_design = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
for code in erp:
    head = code.split("-")
    if len(head) < 3:
        continue
    route, design, fmt = head[0][0], head[0][1:], head[1]
    by_design[design][fmt][route].append(code)


def skeleton_of(codes):
    """Positions from a set of ERP codes, and whether they agree."""
    shapes = {}
    for code in codes:
        by_pos = collections.Counter()
        for item, qty in erp[code].items():
            fam, size, _ = split_crystal(item)
            if fam:
                by_pos[position(fam, size, names.get(item, ""))] += qty
        if by_pos:
            shapes[code] = dict(by_pos)
    if not shapes:
        return None, 0, False
    counts = collections.Counter(tuple(sorted(v.items())) for v in shapes.values())
    top, n = counts.most_common(1)[0]
    return dict(top), len(shapes), len(counts) == 1


rows, proposals = [], {}
tally = collections.Counter()
for p in uncovered:
    d, f = str(p.get("design_code") or ""), str(p.get("format_code") or "")
    routes = {v.get("brand_code") for v in p.get("variants") or [] if v.get("brand_code")}
    fmts = by_design.get(d, {})

    # Pick ONE source group, not every candidate pooled together. Different
    # routes and different formats legitimately carry different stones, so
    # pooling them manufactured disagreement: 80 of 107 looked inconsistent
    # when the real question is "which single group should this copy from".
    source, codes = None, []
    if f in fmts:
        others = {r: cs for r, cs in fmts[f].items() if r not in routes}
        if others:
            # The most recently built route is the immediate predecessor — the
            # one this product actually succeeded.
            best = max(others, key=lambda r: max(last_built.get(c, "") for c in others[r]))
            source, codes = f"other route ({best})", others[best]
    if not codes:
        siblings = {ff: [c for cs in rs.values() for c in cs]
                    for ff, rs in fmts.items() if ff != f}
        if siblings:
            # Prefer the plain freestand (001) as the base figurine; otherwise
            # whichever format was built most recently.
            best = "001" if "001" in siblings else max(
                siblings, key=lambda ff: max(last_built.get(c, "") for c in siblings[ff]))
            source, codes = f"other format ({best})", siblings[best]

    if not codes:
        tally["no ERP crystal history at all"] += 1
        rows.append({"design": d, "format": f, "name": p.get("design_name", ""),
                     "status": p.get("status", ""), "app_routes": "".join(sorted(routes)),
                     "source": "none", "agree": "", "stones": "", "positions": "",
                     "from_codes": ""})
        continue

    pos, seen, agree = skeleton_of(codes)
    if not pos:
        tally["candidates carry no crystal lines"] += 1
        continue

    tally[f"{source}{'' if agree else ' (codes disagree)'}"] += 1
    rows.append({
        "design": d, "format": f, "name": p.get("design_name", ""),
        "status": p.get("status", ""), "app_routes": "".join(sorted(routes)),
        "source": source, "agree": "yes" if agree else "NO",
        "stones": sum(pos.values()),
        "positions": " + ".join(f"{q:g}x {s} {z}" for (s, z), q in sorted(pos.items())),
        "from_codes": " ".join(sorted(codes)[:4]) + (" …" if len(codes) > 4 else ""),
    })
    proposals[f"{d}|{f}"] = {
        "source": source, "agree": agree,
        "positions": [{"shape": s, "size": z, "qty": float(q)} for (s, z), q in sorted(pos.items())],
        "from_codes": sorted(codes),
    }

print(f"{len(uncovered)} products with no crystal BOM")
for k, v in tally.most_common():
    print(f"  {v:4d}  {k}")

os.makedirs(OUTDIR, exist_ok=True)
with open(os.path.join(OUTDIR, "crystal_bom_rescue.csv"), "w", newline="", encoding="utf-8-sig") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(sorted(rows, key=lambda r: (r["source"], r["design"], r["format"])))
json.dump(proposals, open(os.path.join(OUTDIR, "crystal_bom_rescue.json"), "w"), indent=2)

print("\n-> migration/out/crystal_bom_rescue.csv")
print("-> migration/out/crystal_bom_rescue.json")
