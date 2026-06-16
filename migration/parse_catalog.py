#!/usr/bin/env python3
"""
Crystocraft Range — 2026 catalogue importer.

Source: Catalog-WSPrice-20260602.xlsx (active + stock sheets).
Output: src/data/rangeProducts.json  (new model: products grouped by
        design_no + format, with per-variant crystal brand / plating /
        crystal colour, lifecycle status, and packing).

Item code anatomy: {brand}{design_no}-{format}-{plating}{crystal}
  brand   = leading letter(s): D=Bohemia U=Swarovski A=Asfour/Chinese M=Mixed
            (also seen: B, H, UA — kept verbatim, flagged for review)
  design_no = the numeric design (same number across brands = same product)
  format  = product type code (001 figurine, 232 mobile freestand, 163 bookmark…)
  suffix  = plating letter + optional crystal-colour code (GAB = Gold + AB)

The full original item code is stored as each variant's `sku` (source of truth);
brand/plating/crystal fields are best-effort splits so in-app editing works.
"""
import os, re, json, collections
import pandas as pd

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(ROOT)
SRC = "/Users/eddie/Desktop/RTS Stocks/WS Catalog/Catalog-WSPrice-20260602.xlsx"
OUT = os.path.join(PROJ, "src", "data", "rangeProducts.json")

BRAND_NAME = {"D": "Bohemia", "U": "Swarovski", "A": "Asfour / Chinese", "M": "Mixed"}
# Second prefix letter = design body / type ("" = normal metal body)
BODY_NAME = {"": "Metal", "A": "Crystal body", "C": "Glassware", "D": "Display unit"}
PLATING_NAME = {"G": "Gold", "C": "Chrome", "R": "Rose Gold", "A": "Gun Metal", "M": "Mixed"}
PT_MAP = {"001": "Figurine", "033": "Music Box", "231": "Mobile / Freestand",
          "232": "Mobile / Freestand", "163": "Bookmark", "175": "Bookmark"}
# Design category fallback for sheets without a CATEGORY column
SHEET_CAT = {"Stock-Zodiac Signs": "Zodiac", "Stock-Sentiment Hearts": "Sentiment Heart",
             "Stock-Bookmarks": "Bookmark"}

CODE_RE = re.compile(r"^([A-Za-z]+)(\d{3,4})-(\w+)-(\w+)$")


def num(v):
    try:
        f = float(v)
        return None if pd.isna(f) else round(f, 3)
    except (TypeError, ValueError):
        return None


def intnum(v):
    n = num(v)
    return None if n is None else int(round(n))


def col(df, *keys):
    """Find a column whose stripped/upper name contains all keys."""
    for c in df.columns:
        name = str(c).upper().replace("\n", " ")
        if all(k.upper() in name for k in keys):
            return c
    return None


def clean_name(desc):
    s = re.sub(r"\s*-\s*(Free ?Stand|Mobile Freestand).*$", "", desc, flags=re.I)
    s = re.sub(r"\b(Gold|Chrome|Rose Gold|Gun ?Metal)\s*Plated\b", "", s, flags=re.I)
    return s.strip(" -") or desc


def split_suffix(suf):
    """plating = first char; crystal colour = remainder (best-effort)."""
    if not suf:
        return "", ""
    return suf[0], suf[1:]


xl = pd.ExcelFile(SRC)

# product key (design_no, format) -> aggregated dict
products = collections.OrderedDict()
active_keys = set()
warnings = []


def get_product(design_no, body, fmt, meta):
    key = (design_no, body, fmt)
    if key not in products:
        products[key] = {
            "design_no": design_no,
            "design_code": body + design_no,
            "body_code": body,
            "body_name": BODY_NAME.get(body, body),
            "design_name": meta["name"],
            "description": meta["name"],
            "category": meta["cat"],
            "design_type": meta["cat"],
            "product_type": PT_MAP.get(fmt, "Other"),
            "format_code": fmt,
            "size": meta["size"],
            "crystal_type": "Bohemia",
            "status": meta["status"],
            "packing": meta["packing"],
            "gallery": [],
            "variants": [],
            "_names": set(),
        }
    p = products[key]
    p["_names"].add(meta["name"])
    if meta["status"] == "active":
        p["status"] = "active"
    if not p["packing"].get("pcs_per_carton") and meta["packing"].get("pcs_per_carton"):
        p["packing"] = meta["packing"]
    return p


def add_variant(p, brand, plating, crystal, sku, price, stock):
    p["variants"].append({
        "brand_code": brand,
        "brand_name": BRAND_NAME.get(brand, ""),
        "plating_code": plating,
        "plating_name": PLATING_NAME.get(plating, ""),
        "crystal_code": crystal,
        "crystal_name": "",
        "running_no": "",
        "description": ", ".join(x for x in [BRAND_NAME.get(brand, brand),
                                             PLATING_NAME.get(plating, plating), crystal] if x),
        "sku": sku,
        "ws_price_usd": price,
        "stock_finished": stock,
        "packaging": "",
        "engraving": "",
        "image": "",
    })


for sn in xl.sheet_names:
    df = xl.parse(sn, header=1)
    code_c = df.columns[0]
    df = df[df[code_c].notna()]
    is_active = sn.lower().startswith("active")
    c_desc = col(df, "DESCRIPTION") or col(df, "DESCRIPTION".lower())
    c_cat = col(df, "CATEGORY")
    c_size = col(df, "PRODUCT", "SIZE") or col(df, "SIZE")
    c_price = col(df, "WS", "BOHEMIA") or col(df, "WS", "PRICE") or col(df, "WS PRICE")
    c_price2 = col(df, "WS", "CHINESE")
    c_stock = col(df, "STOCK")
    c_pcs = col(df, "PCS", "CARTON") or col(df, "PCS / CARTON")
    c_wt = col(df, "WEIGHT", "CARTON")
    c_cbm = col(df, "CBM", "CARTON")
    c_packsize = col(df, "PACKAGING", "SIZE")

    for _, r in df.iterrows():
        code = str(r[code_c]).strip()
        m = CODE_RE.match(code)
        if not m:
            warnings.append(f"UNPARSED {sn}: {code}")
            continue
        prefix, design_no, fmt, suf = m.groups()
        brand = prefix[0]          # crystal brand (U/D/A/M/B/H…)
        body = prefix[1:]          # body/type letter ("" = metal)
        plating, crystal = split_suffix(suf)
        desc = str(r[c_desc]).strip() if c_desc else code
        cat = (str(r[c_cat]).strip() if c_cat and pd.notna(r[c_cat]) else SHEET_CAT.get(sn, ""))
        size = str(r[c_size]).strip() if c_size and pd.notna(r[c_size]) else ""
        stock = intnum(r[c_stock]) if c_stock else None
        packing = {
            "carton_dims": "", "pack_box_ref": str(r[c_packsize]).strip() if c_packsize and pd.notna(r[c_packsize]) else "",
            "pcs_per_carton": str(intnum(r[c_pcs])) if c_pcs and intnum(r[c_pcs]) is not None else "",
            "cbm_per_carton": str(num(r[c_cbm])) if c_cbm and num(r[c_cbm]) is not None else "",
            "weight_per_carton_kg": str(num(r[c_wt])) if c_wt and num(r[c_wt]) is not None else "",
            "weight_per_pcs_kg": "",
        }
        meta = {"name": clean_name(desc), "cat": cat, "size": size,
                "status": "active" if is_active else "stock", "packing": packing}
        p = get_product(design_no, body, fmt, meta)
        if is_active:
            active_keys.add((design_no, body, fmt))

        price1 = num(r[c_price]) if c_price else None
        # Bohemia/colour-crystal variant uses the code's own brand letter
        add_variant(p, brand, plating, crystal, code, price1, stock)
        # Active sheet's second price = Chinese clear crystals = Asfour brand variant
        if is_active and c_price2:
            price2 = num(r[c_price2])
            if price2 is not None:
                a_sku = f"A{body}{design_no}-{fmt}-{suf}"
                add_variant(p, "A", plating, crystal, a_sku, price2, None)


# Finalise
out = []
multi_name = 0
for (dno, body, fmt), p in products.items():
    names = p.pop("_names")
    if len({n.lower() for n in names}) > 1:
        multi_name += 1
        warnings.append(f"MERGE-CHECK {body}{dno}-{fmt}: {sorted(names)}")
    out.append(p)

with open(OUT, "w") as f:
    json.dump({"products": out}, f, indent=2, ensure_ascii=False)

# Summary
n_var = sum(len(p["variants"]) for p in out)
status = collections.Counter(p["status"] for p in out)
brands = collections.Counter(v["brand_code"] for p in out for v in p["variants"])
ptypes = collections.Counter(p["product_type"] for p in out)
priced = sum(1 for p in out for v in p["variants"] if v["ws_price_usd"] is not None)
print(f"Source        : {os.path.basename(SRC)}")
print(f"Products      : {len(out)} (by design_no + format)")
print(f"Variants/SKUs : {n_var}  (priced {priced})")
print(f"Status        : {dict(status)}")
print(f"Brands        : {dict(brands)}")
print(f"Product types : {dict(ptypes)}")
print(f"Merge-name flags: {multi_name}  | Unparsed: {sum(1 for w in warnings if w.startswith('UNPARSED'))}")
print(f"Output        : {OUT}")
if warnings:
    print("\n--- review (first 25) ---")
    for w in warnings[:25]:
        print(" ", w)
