#!/usr/bin/env python3
"""
Crystocraft Range — legacy migration parser (Phase 0 trial).

Reads the legacy master data and produces the target data model as JSON,
plus a human-readable validation CSV. Does NOT write to Firestore yet —
output is for review before we trust the transform.

Sources:
  - PriceMaster.xls            : current master (price + structure source of truth)
  - LocalWeb .../crystocraft_stk_db.csv / _nonstk_db.csv : variant matrix + stock flag
  - LocalWeb .../Datafiles/img : product images

Usage: python3 parse_range.py [SeriesFilterSubstring]   (default: Butterfly)
"""
import os, sys, json, csv, collections

import xlrd

ROOT = os.path.dirname(os.path.abspath(__file__))
PRICEMASTER = "/Users/eddie/Desktop/RTS Stocks/Pricing/PriceMaster.xls"
LOCALWEB = os.path.join(os.path.dirname(ROOT), "LocalWeb")
CAT_DB = os.path.join(LOCALWEB, "Datafiles", "catalogue_db")
IMG_DIR = os.path.join(LOCALWEB, "Datafiles", "img")
OUT = os.path.join(ROOT, "out")

FILTER = sys.argv[1] if len(sys.argv) > 1 else "Butterfly"

# ── Load PriceMaster tables ────────────────────────────────────────────────
wb = xlrd.open_workbook(PRICEMASTER)

def sheet_rows(name):
    s = wb.sheet_by_name(name)
    for r in range(s.nrows):
        yield [s.cell_value(r, c) for c in range(s.ncols)]

def s(v):
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip()

# body_db: code, name, collection, type
bodies = {}
for row in sheet_rows("body_db"):
    if not s(row[0]):
        continue
    bodies[s(row[0])] = {"name": s(row[1]), "collection": s(row[2]), "type": s(row[3])}

# acc_db: acccode, name, group, type  (format)
accs = {}
for row in sheet_rows("acc_db"):
    code = s(row[0])
    if code and code != "AccCode":
        accs[code] = {"name": s(row[1]), "group": s(row[2]), "type": s(row[3])}

# metal_db: code, name, pricegroup
metals = {}
for row in sheet_rows("metal_db"):
    code = s(row[0])
    if code and code != "MetalCode":
        metals[code] = {"name": s(row[1]), "group": s(row[2]).split(".")[0]}

# crystal_db: code, code2, name, grade
crystals = {}
for row in sheet_rows("crystal_db"):
    code = s(row[0])
    if code and code != "CL":  # skip header-ish; CL handled below explicitly
        crystals[code] = {"name": s(row[2]), "grade": s(row[3])}
# ensure CL present
crystals.setdefault("CL", {"name": "SPECTRA clear", "grade": "CL"})

# CC1958_db price: (Body,Acc,RunningNo) -> {grade_group: price}
# columns: BodyCode,AccCode,RunningNo, CL_1,CO_1,AX_1,GX_1, CL_2,CO_2,AX_2,GX_2
PRICE_COLS = ["CL_1", "CO_1", "AX_1", "GX_1", "CL_2", "CO_2", "AX_2", "GX_2"]
prices = {}
first = True
for row in sheet_rows("CC1958_db"):
    if first:
        first = False
        continue
    body, acc, rn = s(row[0]), s(row[1]), s(row[2])
    if not body:
        continue
    cells = {}
    for i, col in enumerate(PRICE_COLS):
        v = row[3 + i]
        if isinstance(v, float) and v:
            cells[col] = round(v, 3)
        elif isinstance(v, str) and v.strip():
            try:
                cells[col] = round(float(v), 3)
            except ValueError:
                pass
    prices[(body, acc, rn)] = cells

# packing_db: Body,Acc,RunningNo,Size,PackSize,WS_PPC,RT_PPC,PackBox,CBM,Wt/CTN,wt/pc
packing = {}
first = True
for row in sheet_rows("packing_db"):
    if first:
        first = False
        continue
    body, acc, rn = s(row[0]), s(row[1]), s(row[2])
    if not body:
        continue
    packing[(body, acc, rn)] = {
        "size": s(row[3]), "pack_size": s(row[4]),
        "pcs_carton": s(row[5]), "pack_box": s(row[7]),
        "cbm_carton": s(row[8]), "weight_carton": s(row[9]),
    }

# Exchange rates (from flat file)
rates = {"USD": 1.0}
ratef = os.path.join(CAT_DB, "ExchangeRate_db.csv")
if os.path.exists(ratef):
    for ln in open(ratef):
        p = ln.strip().split(",")
        if len(p) >= 4:
            try:
                rates[p[1]] = float(p[3])
            except ValueError:
                pass

# ── Load variant matrix from flat files (stock + non-stock) ────────────────
# cols: Body,Acc,Metal,CrystalColor,RunningNo,Mono_G,Mix_G,Mono_C,Mix_C,Mono_A,Mix_A,Remarks,CAT,TYPE,TIME
def load_matrix(path, in_stock):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, newline="") as f:
        rd = csv.reader(f)
        next(rd, None)
        for r in rd:
            if len(r) < 5 or not r[0]:
                continue
            rows.append({
                "body": r[0].strip(), "acc": r[1].strip(), "metal": r[2].strip(),
                "color": r[3].strip(), "rn": r[4].strip(),
                "remarks": r[11].strip() if len(r) > 11 else "",
                "in_stock": in_stock,
            })
    return rows

matrix = (load_matrix(os.path.join(CAT_DB, "crystocraft_stk_db.csv"), True) +
          load_matrix(os.path.join(CAT_DB, "crystocraft_nonstk_db.csv"), False))

# ── Helpers ────────────────────────────────────────────────────────────────
def find_price_row(body, acc, rn):
    for key in [(body, acc, rn), (body, acc, "")]:
        if key in prices and prices[key]:
            return prices[key]
    # any runningno for this body+acc
    for (b, a, _), v in prices.items():
        if b == body and a == acc and v:
            return v
    return {}

def find_packing(body, acc, rn):
    for key in [(body, acc, rn), (body, acc, "")]:
        if key in packing:
            return packing[key]
    for (b, a, _), v in packing.items():
        if b == body and a == acc:
            return v
    return {}

def ws_price(price_row, grade, metal_group):
    col = f"{grade}_{metal_group}"
    return price_row.get(col)

def image_for(body, acc, metal, color):
    fn = f"{body}{acc}{metal}{color}.gif"
    full = os.path.join(IMG_DIR, body, fn)
    return fn if os.path.exists(full) else None

# ── Build target model for the filtered series ─────────────────────────────
sel_bodies = {code: b for code, b in bodies.items()
              if FILTER.lower() in b["name"].lower()}

products = []        # one per (body, acc, metal) — a catalogue card
validation = []      # flat rows for human review
grp = collections.defaultdict(list)
for m in matrix:
    if m["body"] in sel_bodies:
        grp[(m["body"], m["acc"], m["metal"])].append(m)

for (body, acc, metal), rows in sorted(grp.items()):
    b = sel_bodies[body]
    acc_info = accs.get(acc, {"name": acc, "group": ""})
    metal_info = metals.get(metal, {"name": metal, "group": "1"})
    price_row = find_price_row(body, acc, rows[0]["rn"])
    pack = find_packing(body, acc, rows[0]["rn"])
    in_stock = any(r["in_stock"] for r in rows)

    # crystal colour SKUs in this product
    colors = []
    seen = set()
    for r in rows:
        c = r["color"]
        if not c or c in seen:
            continue
        seen.add(c)
        cinfo = crystals.get(c, {"name": c, "grade": "CO"})
        usd = ws_price(price_row, cinfo["grade"], metal_info["group"])
        colors.append({
            "sku": f"{body}{acc}{metal}{c}",
            "color_code": c, "color_name": cinfo["name"], "grade": cinfo["grade"],
            "ws_usd": usd,
            "image": image_for(body, acc, metal, c),
        })

    card_price = next((c["ws_usd"] for c in colors if c["ws_usd"] is not None), None)
    product = {
        "design_code": body, "design_name": b["name"],
        "collection": b["collection"], "type": b["type"],
        "format_code": acc, "format_name": acc_info["name"], "format_group": acc_info["group"],
        "finish_code": metal, "finish_name": metal_info["name"],
        "metal_price_group": metal_info["group"],
        "in_stock": in_stock,
        "ws_price_usd": card_price,
        "ws_price_by_currency": {cur: (round(card_price * rt, 2) if card_price else None)
                                  for cur, rt in rates.items()},
        "size": pack.get("size"), "pack_size": pack.get("pack_size"),
        "pcs_carton": pack.get("pcs_carton"), "cbm_carton": pack.get("cbm_carton"),
        "weight_carton": pack.get("weight_carton"), "pack_box": pack.get("pack_box"),
        "crystal_skus": colors,
    }
    products.append(product)
    for c in colors:
        validation.append({
            "design": body, "design_name": b["name"], "format": acc_info["name"],
            "finish": metal_info["name"], "sku": c["sku"], "color": c["color_name"],
            "grade": c["grade"], "ws_usd": c["ws_usd"],
            "has_image": "Y" if c["image"] else "-",
            "in_stock": "Y" if in_stock else "-",
        })

# ── Write outputs ──────────────────────────────────────────────────────────
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, f"range_{FILTER}.json"), "w") as f:
    json.dump({"products": products}, f, indent=2, ensure_ascii=False)

with open(os.path.join(OUT, f"range_{FILTER}_validation.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["design", "design_name", "format", "finish",
                                       "sku", "color", "grade", "ws_usd", "has_image", "in_stock"])
    w.writeheader()
    w.writerows(validation)

# ── Summary ────────────────────────────────────────────────────────────────
n_sku = len(validation)
n_img = sum(1 for v in validation if v["has_image"] == "Y")
n_price = sum(1 for v in validation if v["ws_usd"] is not None)
print(f"Series filter        : {FILTER!r}")
print(f"Designs matched      : {len(sel_bodies)}")
print(f"Products (cards)      : {len(products)}")
print(f"Crystal-colour SKUs  : {n_sku}")
print(f"  with WS price       : {n_price}  ({n_price*100//max(n_sku,1)}%)")
print(f"  with image on disk  : {n_img}  ({n_img*100//max(n_sku,1)}%)")
print(f"Currencies           : {', '.join(rates)}")
print(f"Output               : out/range_{FILTER}.json  +  _validation.csv")
