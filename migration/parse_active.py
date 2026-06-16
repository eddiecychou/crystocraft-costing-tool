#!/usr/bin/env python3
"""
Crystocraft Range — active-catalogue migration parser (Phase 0).

Source of truth = the ACTIVE working sheet (current Bohemia range only),
NOT the legacy 2000-SKU PHP dump (mostly retired Swarovski models).

Inputs:
  - Stock-WSPrice-20250527.xlsx   : active catalogue (Gold + Chrome figurines)
        cols: ITEM CODE, DESCRIPTION, CATEGORY, SIZE, WS PRICE USD, STOCK
  - LocalWeb/Datafiles/img/U####/ : product images (U-coded; D maps to U by number)

Output (for review, no Firestore writes yet):
  - out/active_range.json
  - out/active_range_validation.csv

SKU anatomy: D0018-001-G = Body(D0018) + Format(001) + Finish(G=Gold / C=Chrome)
  Prefix letter = crystal type: D=Bohemia, U=Swarovski(retired), M=mix, A=Asfour.
  The active sheet is all-D (Bohemia). Images only exist U-coded, so we map
  D####->U#### to find a representative photo of the same body shape.

WS PRICE USD is the canonical wholesale price. Customer-type display pricing
(confirmed from legacy product_detail.php getPrice()):
  WS/UW : base * (100+markup)/100
  RT/UR : base * 1.350 * (100+markup)/100
  FB/UF : base * 0.700 * (100+markup)/100
  (markup is per-client; negative markup = distributor discount up to -30/-35%)
"""
import os, re, json, csv, collections
import pandas as pd

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(ROOT)
ACTIVE = os.path.join(PROJ, "Stock-WSPrice-20250527.xlsx")
IMG_DIR = os.path.join(PROJ, "LocalWeb", "Datafiles", "img")
OUT = os.path.join(ROOT, "out")

FINISH_NAME = {"G": "Gold", "C": "Chrome", "A": "Gunmetal", "T": "Two-tone", "W": "White"}


def num_of(code):
    m = re.match(r"^[A-Za-z](\d+)$", code)
    return m.group(1) if m else None


def find_image(body, fmt, finish):
    """Map D#### -> U#### folder, return first matching gif filename or None."""
    n = num_of(body)
    if not n:
        return None
    for prefix in (body, "U" + n, "M" + n, "A" + n):
        folder = os.path.join(IMG_DIR, prefix)
        if not os.path.isdir(folder):
            continue
        want = f"{prefix}-{fmt}-{finish}"          # e.g. U0002-001-C
        cands = [f for f in os.listdir(folder)
                 if f.lower().startswith(want.lower()) and f.lower().endswith(".gif")]
        if cands:
            return f"{prefix}/{sorted(cands)[0]}"
        # fall back to any image for this body+format (any finish)
        want2 = f"{prefix}-{fmt}-"
        cands = [f for f in os.listdir(folder)
                 if f.lower().startswith(want2.lower()) and f.lower().endswith(".gif")]
        if cands:
            return f"{prefix}/{sorted(cands)[0]}"
    return None


def num(v):
    try:
        return round(float(v), 3)
    except (TypeError, ValueError):
        return None


# ── Load active sheet ──────────────────────────────────────────────────────
xl = pd.ExcelFile(ACTIVE)
rows = []
for sn in xl.sheet_names:
    df = xl.parse(sn, header=1)
    df = df[df["ITEM CODE"].notna()]
    for _, r in df.iterrows():
        code = str(r["ITEM CODE"]).strip()
        m = re.match(r"^([A-Za-z]\d+)-(\w+)-([A-Za-z]+)$", code)
        if not m:
            continue
        body, fmt, finish = m.group(1), m.group(2), m.group(3)
        rows.append({
            "sheet": sn, "code": code, "body": body, "fmt": fmt, "finish": finish,
            "desc": str(r.get("DESCRIPTION", "")).strip(),
            "category": str(r.get("CATEGORY", "")).strip(),
            "size": str(r.get("SIZE", "")).strip(),
            "ws_usd": num(r.get("WS PRICE USD")),
            "stock": num(r.get("STOCK")),
        })

# ── Build product cards (group by body+format) ─────────────────────────────
grp = collections.defaultdict(list)
for r in rows:
    grp[(r["body"], r["fmt"])].append(r)

products, validation = [], []
for (body, fmt), variants in sorted(grp.items()):
    base = variants[0]
    finishes = []
    for v in variants:
        img = find_image(body, fmt, v["finish"])
        finishes.append({
            "sku": v["code"],
            "finish_code": v["finish"],
            "finish_name": FINISH_NAME.get(v["finish"], v["finish"]),
            "ws_price_usd": v["ws_usd"],
            "stock_finished": v["stock"],
            "image": img,
        })
        validation.append({
            "code": v["code"], "design": body, "format": fmt,
            "finish": FINISH_NAME.get(v["finish"], v["finish"]),
            "description": v["desc"], "category": v["category"], "size": v["size"],
            "ws_usd": v["ws_usd"], "stock": v["stock"],
            "has_image": "Y" if img else "-",
        })
    products.append({
        "design_code": body,
        "design_name": re.sub(r"\s*-\s*(Free Stand|Freestand).*$", "", base["desc"]).strip() or base["desc"],
        "description": base["desc"],
        "category": base["category"],
        "format_code": fmt,
        "size": base["size"],
        "crystal_type": "Bohemia",
        "finishes": finishes,
    })

# ── Write outputs ──────────────────────────────────────────────────────────
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "active_range.json"), "w") as f:
    json.dump({"products": products}, f, indent=2, ensure_ascii=False)

with open(os.path.join(OUT, "active_range_validation.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["code", "design", "format", "finish", "description",
                                      "category", "size", "ws_usd", "stock", "has_image"])
    w.writeheader()
    w.writerows(validation)

# ── Summary ────────────────────────────────────────────────────────────────
n = len(validation)
n_img = sum(1 for v in validation if v["has_image"] == "Y")
n_price = sum(1 for v in validation if v["ws_usd"] is not None)
n_stock = sum(1 for v in validation if v["stock"] is not None)
cats = collections.Counter(v["category"] for v in validation)
print(f"Source            : {os.path.basename(ACTIVE)}")
print(f"Product cards     : {len(products)}  (by design+format)")
print(f"SKU rows          : {n}")
print(f"  with WS price   : {n_price} ({n_price*100//max(n,1)}%)")
print(f"  with stock qty  : {n_stock} ({n_stock*100//max(n,1)}%)")
print(f"  with image      : {n_img} ({n_img*100//max(n,1)}%)")
print(f"Categories        : {dict(cats)}")
print(f"Output            : out/active_range.json + _validation.csv")
