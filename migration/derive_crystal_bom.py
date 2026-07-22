#!/usr/bin/env python3
"""Derive a crystal BOM for the app's Range from the ERP.

The app offers 4,664 colourways across 288 products. The ERP has a defined BOM
for about 528 of them, because the rest were never quoted or built. So this
cannot be a per-colourway lookup. It derives three things instead:

  skeleton    per product+plating: how many stones of each (family, size),
              independent of colour. Invariant across colourways — that is
              checked, not assumed.
  allocation  per mix code (MX, M1, AX, ...): how the skeleton's stones are
              split across colours. Only mixes need this; a mono colourway is
              the whole skeleton in one colour, which is a rule, not data.
  colours     (family, suffix) -> colour name. The suffix is family-scoped:
              -005 is Rosaline in BDC-8232 and Rose in C01-1028.

Sources, in order of preference:
  raw.itemdetail   the item-master BOM, latest revision. Per-unit quantities
                   directly, and it covers codes that were never built.
  raw.joborderbom  what was actually produced, divided by job quantity. Used
                   where the master has nothing.

Both were cross-checked on D0092-001-GMX and agree (22 stones, 13 octagon +
9 chaton). Read-only.
"""
import json, os, re, csv, collections, dotenv, psycopg2
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUTDIR = os.path.join(HERE, "out")
dotenv.load_dotenv(os.path.join(ROOT, "erp-sync", ".env"))

MIX_CODES = {"MX", "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8",
             "AX", "A1", "A2", "A3", "A4", "A5", "GX", "G1", "G2", "G3", "G4"}

products = json.load(open(os.path.join(OUTDIR, "range_products.json")))["products"]


# Pattern number -> physical shape. The 10 disagreeing skeletons all turned out
# to agree on how many stones and differ only on which family fills a slot, so
# a position needs shape and size, not brand.
SHAPE = {
    "1028": "chaton", "1088": "chaton", "1032": "chaton",
    "8015": "octagon", "8016": "octagon", "8115": "octagon", "8116": "octagon",
    "8232": "octagon", "8249": "octagon", "1080": "octagon", "8102": "octagon",
    "8641": "octagon", "8290": "octagon", "864": "octagon", "801": "octagon",
    "3130": "heart",
}


def position(family, size):
    """('BDC-8232', '0014') -> ('octagon', '14').

    Bohemia 8232/14, Swarovski 8016/14 and Asfour 1080/14 all collapse to the
    same position, which is the interchangeability the route letters encode.
    """
    pat = (family or "").split("-")[-1].strip()
    shape = SHAPE.get(pat, pat or "?")
    s = (size or "").strip().upper()
    s = s.lstrip("0") or s          # '0014' -> '14'
    return (shape, s)


def split_crystal(code):
    """BDC-8232-0014-002 -> ('BDC-8232', '0014', '002').

    A few codes carry a space inside the pattern ('C01-864 120-002'), so this
    splits on hyphens and takes positions rather than pattern-matching.
    """
    parts = code.split("-")
    if len(parts) >= 4:
        return "-".join(parts[:2]), parts[2], parts[3]
    if len(parts) == 3:
        return parts[0], parts[1], parts[2]
    return None, None, None


# Every colourway the app offers, keyed back to the product that offers it.
cands = collections.defaultdict(list)
for p in products:
    d, f = str(p.get("design_code") or ""), str(p.get("format_code") or "")
    for v in p.get("variants") or []:
        b, pl = v.get("brand_code") or "", v.get("plating_code") or ""
        if not (b and d and f and pl):
            continue
        for col in v.get("crystal_colors") or [""]:
            cands[f"{b}{d}-{f}-{pl}{col}"].append((d, f, b, pl, col))

conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"])
cur = conn.cursor()
codes = sorted(cands)

# --- source 1: item master, latest revision only -----------------------------
# Six revisions of D0092-001-GMX all carried 22 stones, but taking them all
# would multiply every quantity by six. Rank and keep the newest.
cur.execute(
    """
    with ranked as (
      select iditemcode, idsubitemcode, idqty, idrevision,
             dense_rank() over (partition by iditemcode
                                order by idrevision::int desc) as rk
        from raw.itemdetail
       where iditemtype = 'ST'
         and iditemcode = any(%s)
         and idqty ~ '^[0-9]+(\\.[0-9]+)?$'
         and idrevision ~ '^[0-9]+$'
    )
    select iditemcode, idsubitemcode, sum(idqty::numeric)
      from ranked where rk = 1 group by 1, 2
    """,
    (codes,),
)
bom = collections.defaultdict(dict)
for code, item, qty in cur.fetchall():
    bom[code][item] = qty
from_master = set(bom)

# --- source 2: job orders, for codes the master does not define --------------
missing = [c for c in codes if c not in bom]
if missing:
    cur.execute(
        """
        with per as (
          select h.joitemcode code, h.jono, b.jbitemcode item,
                 sum(b.jbqty::numeric) / max(h.joqty::numeric) as pu,
                 max(h.joissuedate) as issued
            from raw.joborderheader h
            join raw.joborderbom b on b.jbjono = h.jono
           where b.jbitemtype = 'ST'
             and h.joitemcode = any(%s)
             and h.joqty ~ '^[0-9]+(\\.[0-9]+)?$' and h.joqty::numeric > 0
             and b.jbqty ~ '^[0-9]+(\\.[0-9]+)?$'
           group by 1, 2, 3
        ),
        latest as (
          select code, item, pu,
                 row_number() over (partition by code, item order by issued desc) rn
            from per
        )
        select code, item, pu from latest where rn = 1
        """,
        (missing,),
    )
    for code, item, pu in cur.fetchall():
        bom[code][item] = pu
from_jobs = set(bom) - from_master

# --- colour names, from the item master --------------------------------------
crystal_codes = sorted({i for lines in bom.values() for i in lines})
# Take the newest revision's description, not max(itshortdesc1). A string max
# over ~29 revisions returns whichever description sorts last, which put a
# stale "Swarovski Strass #8016/14" name on four Bohemia 8232 codes. Same trap
# as taking a string max over a numeric sequence.
cur.execute(
    """
    with ranked as (
      select itcode, itshortdesc1,
             row_number() over (partition by itcode
                                order by itrevision::int desc) as rn
        from raw.item
       where itcode = any(%s) and itrevision ~ '^[0-9]+$'
    )
    select itcode, itshortdesc1 from ranked where rn = 1
    """,
    (crystal_codes,),
)
names = dict(cur.fetchall())

print(f"colourways offered by the app : {len(codes)}")
print(f"  BOM from item master        : {len(from_master)}")
print(f"  BOM from job orders only    : {len(from_jobs)}")
print(f"  no BOM anywhere             : {len(codes) - len(bom)}")

# --- skeleton per product+plating, and invariance check ----------------------
# key: (design, format, brand, plating) -> colour code -> {(family,size): qty}
shape = collections.defaultdict(dict)
for code, lines in bom.items():
    for (d, f, b, pl, col) in cands[code]:
        by_pos = collections.Counter()
        for item, qty in lines.items():
            fam, size, _suf = split_crystal(item)
            if fam:
                by_pos[(fam, size)] += qty
        shape[(d, f, b, pl)][col] = dict(by_pos)

skeletons, inconsistent = {}, []
for key, colourways in shape.items():
    distinct = {tuple(sorted(v.items())) for v in colourways.values()}
    if len(distinct) == 1:
        skeletons[key] = dict(next(iter(distinct)))
    else:
        # Real disagreement: colourways of the same product needing different
        # stone counts. Keep the most common rather than guessing.
        counts = collections.Counter(tuple(sorted(v.items())) for v in colourways.values())
        skeletons[key] = dict(counts.most_common(1)[0][0])
        inconsistent.append((key, len(distinct), len(colourways)))

print(f"\nproduct+plating combinations with a skeleton: {len(skeletons)}")
print(f"  keyed on (family, size) — agree           : {len(skeletons) - len(inconsistent)}")
print(f"  keyed on (family, size) — DISAGREE        : {len(inconsistent)}")

# The same test with family removed: does the product need the same number of
# stones in each shape+size, whoever supplies them?
pos_shape = collections.defaultdict(dict)
for code, lines in bom.items():
    for (d, f, b, pl, col) in cands[code]:
        by_pos = collections.Counter()
        for item, qty in lines.items():
            fam, size, _suf = split_crystal(item)
            if fam:
                by_pos[position(fam, size)] += qty
        pos_shape[(d, f, b, pl)][col] = dict(by_pos)

pos_skeletons, pos_bad = {}, []
for key, colourways in pos_shape.items():
    distinct = {tuple(sorted(v.items())) for v in colourways.values()}
    counts = collections.Counter(tuple(sorted(v.items())) for v in colourways.values())
    pos_skeletons[key] = dict(counts.most_common(1)[0][0])
    if len(distinct) > 1:
        pos_bad.append(key)

print(f"  keyed on (shape, size)  — agree           : {len(pos_skeletons) - len(pos_bad)}")
print(f"  keyed on (shape, size)  — DISAGREE        : {len(pos_bad)}")
if pos_bad:
    print("    still disagreeing:", ", ".join("|".join(k) for k in sorted(pos_bad)))

# --- allocations for mix codes ----------------------------------------------
allocations = collections.defaultdict(dict)
for code, lines in bom.items():
    for (d, f, b, pl, col) in cands[code]:
        if col not in MIX_CODES:
            continue
        alloc = []
        for item, qty in sorted(lines.items()):
            fam, size, suf = split_crystal(item)
            alloc.append({"item": item, "family": fam, "size": size, "suffix": suf,
                          "qty": float(qty), "name": names.get(item, "")})
        allocations[f"{b}{d}-{f}-{pl}"][col] = alloc

mixes_offered = {(f"{b}{d}-{f}-{pl}", col)
                 for code, refs in cands.items() for (d, f, b, pl, col) in refs
                 if col in MIX_CODES}
mixes_have = {(base, col) for base, m in allocations.items() for col in m}
print(f"\nmix colourways offered : {len(mixes_offered)}")
print(f"  with an allocation   : {len(mixes_have)}")
print(f"  without              : {len(mixes_offered - mixes_have)}")

# --- (family, suffix) -> colour name -----------------------------------------
# Keyed on size as well as family: BDC-8232-0014 and BDC-8232-0018 are
# different stones, and merging them made every shared suffix look ambiguous.
colour_table = collections.defaultdict(set)
for item, nm in names.items():
    fam, size, suf = split_crystal(item)
    if fam and suf:
        colour_table[(fam, size, suf)].add(nm)

os.makedirs(OUTDIR, exist_ok=True)
json.dump(
    {
        "skeletons": {"|".join(k): {f"{shp}|{size}": float(q) for (shp, size), q in v.items()}
                      for k, v in pos_skeletons.items()},
        "skeletons_by_family": {"|".join(k): {f"{fam}|{size}": float(q) for (fam, size), q in v.items()}
                                for k, v in skeletons.items()},
        "allocations": {b: m for b, m in allocations.items()},
        "inconsistent": ["|".join(k) for k in sorted(pos_bad)],
        "inconsistent_by_family": ["|".join(k) + f" ({n} shapes over {c} colourways)"
                                   for k, n, c in inconsistent],
        "no_bom": sorted(set(codes) - set(bom)),
    },
    open(os.path.join(OUTDIR, "crystal_bom_derived.json"), "w"), indent=2,
)

# Review CSVs. UTF-8 BOM so Excel does not mangle them, per project convention.
# The skeleton is written keyed on shape+size, with family left to the
# allocation. Keying it on family made seven products look like they needed
# different stone counts when they only differed in who supplied the stone.
with open(os.path.join(OUTDIR, "crystal_skeletons.csv"), "w", newline="", encoding="utf-8-sig") as fh:
    w = csv.writer(fh)
    w.writerow(["design", "format", "brand", "plating", "shape", "size",
                "stones_per_unit", "colourways_seen", "agree",
                "families_seen"])
    for key, pos in sorted(pos_skeletons.items()):
        d, f, b, pl = key
        bad = key in pos_bad
        # Which families have actually filled this position, for the eye-check.
        fams = collections.defaultdict(set)
        for col, shp in shape.get(key, {}).items():
            for (fam, size), _q in shp.items():
                fams[position(fam, size)].add(fam)
        for (shp, size), q in sorted(pos.items()):
            w.writerow([d, f, b, pl, shp, size, float(q), len(pos_shape[key]),
                        "NO" if bad else "yes",
                        " | ".join(sorted(fams.get((shp, size), [])))])

with open(os.path.join(OUTDIR, "crystal_colour_table.csv"), "w", newline="", encoding="utf-8-sig") as fh:
    w = csv.writer(fh)
    w.writerow(["family", "size", "suffix", "app_code", "erp_name", "ambiguous"])
    for (fam, size, suf), nms in sorted(colour_table.items()):
        nm = " | ".join(sorted(n for n in nms if n))
        # The Bohemia descriptions embed the app's own colour code: "Bohemia
        # glass 8232/14(PI) double hole Rosaline". The Swarovski ones do not,
        # so those columns stay blank for the eye-check to fill.
        m = re.search(r"\(([A-Z][A-Z0-9])\)", nm)
        w.writerow([fam, size, suf, m.group(1) if m else "", nm,
                    "YES" if len(nms) > 1 else ""])

with open(os.path.join(OUTDIR, "crystal_allocations.csv"), "w", newline="", encoding="utf-8-sig") as fh:
    w = csv.writer(fh)
    w.writerow(["base_code", "mix_code", "crystal_item", "family", "size", "suffix", "qty_per_unit", "erp_name"])
    for base, m in sorted(allocations.items()):
        for col, alloc in sorted(m.items()):
            for a in alloc:
                w.writerow([base, col, a["item"], a["family"], a["size"], a["suffix"], a["qty"], a["name"]])

print("\n-> migration/out/crystal_bom_derived.json")
print("-> migration/out/crystal_skeletons.csv")
print("-> migration/out/crystal_colour_table.csv")
print("-> migration/out/crystal_allocations.csv")
