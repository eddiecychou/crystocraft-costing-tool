#!/usr/bin/env python3
"""Build a packing lookup from packing_db.csv keyed by design_no(4) + format.

Output: src/data/packingDb.json  ->  { "0061-231": { ...packing... }, ... }

CSV columns: BodyCode (brand+design), AccCode (-format-), RunningNo, Size,
PackSize (gift-box dims), WS_PackPPC (pcs/carton), RT_PackPPC, PackBox (ref),
CBM/CTN, Weight/CTN, Weight/PCS.
"""
import os, re, csv, json, collections

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(ROOT)
SRC = os.path.join(PROJ, "LocalWeb", "Datafiles", "catalogue_db", "packing_db.csv")
OUT = os.path.join(PROJ, "src", "data", "packingDb.json")
RANGE = os.path.join(PROJ, "src", "data", "rangeProducts.json")


def s(v):
    return (v or "").strip()


def design_no(bodycode):
    return re.sub(r"[^0-9]", "", bodycode).zfill(4)


def body_letter(bodycode):
    m = re.match(r"^[A-Za-z]([A-Za-z])", bodycode)  # 2nd letter of a 2-letter prefix
    return m.group(1).upper() if m else ""


def packing_from(r):
    return {
        "carton_dims": "",  # no outer-carton dims in source
        "pcs_per_carton": s(r["WS_PackPPC"]),
        "cbm_per_carton": s(r["CBM/CTN"]),
        "weight_per_carton_kg": s(r["Weight/CTN"]),
        "weight_per_pcs_kg": s(r["Weight/PCS"]),
        "pack_box_ref": s(r["PackBox"]),
        "_size": s(r["Size"]),
        "_pack_size": s(r["PackSize"]),
        "_body": body_letter(r["BodyCode"]),
    }


def filled(p):  # how many real packing fields are populated
    return sum(1 for k in ("pcs_per_carton", "cbm_per_carton", "weight_per_carton_kg",
                           "weight_per_pcs_kg", "pack_box_ref") if p[k])


# key "dn-fmt" -> best packing row (most populated wins; ties keep first)
best = {}
rows = list(csv.DictReader(open(SRC)))
for r in rows:
    fmt = s(r["AccCode"]).strip("-")
    if not fmt:
        continue
    key = f"{design_no(r['BodyCode'])}-{fmt}"
    p = packing_from(r)
    if key not in best or filled(p) > filled(best[key]):
        best[key] = p

json.dump(best, open(OUT, "w"), indent=2, ensure_ascii=False)

# Coverage report against the products actually in the app
prod = json.load(open(RANGE))["products"]
hit = miss = 0
miss_keys = []
for pr in prod:
    dn = (pr.get("design_no") or "").zfill(4)
    key = f"{dn}-{pr.get('format_code', '')}"
    if key in best:
        hit += 1
    else:
        miss += 1
        miss_keys.append((key, pr.get("design_name", "")[:30]))

print(f"packing keys built : {len(best)}")
print(f"products in app    : {len(prod)}")
print(f"  matched          : {hit}")
print(f"  unmatched        : {miss}")
for k, name in miss_keys[:40]:
    print("   MISS", k, name)
print(f"Output: {OUT}")
