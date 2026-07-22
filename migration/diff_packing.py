#!/usr/bin/env python3
"""Diff XiangXia's packing spreadsheet against the app's live packing data.

286 of 288 products already carry packing, so this is an overwrite, not a fill.
Rather than bulk-importing, this classifies every product so the value changes
can be confirmed before anything is written.

Classifications:
  identical          the app already holds what the sheet says
  reference upgrade  same numbers, but the sheet has the full JES pack-box code
                     where the app has a short one ("pb001" -> "P-PB001ROS-02-01")
  VALUE CHANGE       the numbers differ — needs a human
  app blank          nothing in the app to overwrite
  multi-option       the sheet offers more than one packing for this product,
                     which the app's single packing object cannot represent
  not in sheet       the sheet has no row for this product

Usage: diff_packing.py [path-to-xls]
Read-only. Writes a review CSV, touches nothing in Firestore.
"""
import xlrd, collections, json, re, csv, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, "out")
XLS = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Desktop/pack_db估算.xls")

if not os.path.exists(XLS):
    print(f"No spreadsheet at {XLS}"); sys.exit(1)

book = xlrd.open_workbook(XLS)
sh = book.sheet_by_name("packing_db")
hdr = [str(sh.cell_value(0, c)).strip() for c in range(sh.ncols)]
sheet_rows = [{hdr[c]: str(sh.cell_value(r, c)).strip() for c in range(sh.ncols)}
              for r in range(1, sh.nrows)]


def stem(body):
    """U0243 / D0243 -> 0243. The sheet is keyed on the retired U codes."""
    m = re.match(r"^[A-Z]+(\d{4})$", body or "")
    return m.group(1) if m else None


def fmt(acc):
    m = re.search(r"(\d{3})", acc or "")
    return m.group(1) if m else (acc or "").strip("-")


def num(v):
    """Excel hands back '96.0' for what is really 96."""
    v = (str(v) or "").strip()
    try:
        return f"{float(v):g}"
    except ValueError:
        return re.sub(r"\s+", " ", v).strip().lower()


def boxkey(ref):
    """'pb001' and 'P-PB001ROS-02-01' are the same box, written two ways.

    Reduce both to the family token so a richer reference does not read as a
    different box.
    """
    s = (str(ref) or "").upper()
    m = re.search(r"([GP]B)\s*0*(\d{1,3})", s)
    return f"{m.group(1)}{int(m.group(2)):03d}" if m else s.strip()


by_key = collections.defaultdict(list)
for r in sheet_rows:
    st = stem(r["BodyCode"])
    if st:
        by_key[(st, fmt(r["AccCode"]))].append(r)

products = json.load(open(os.path.join(OUTDIR, "range_products.json")))["products"]

out, stats = [], collections.Counter()
for p in sorted(products, key=lambda x: (str(x.get("design_code")), str(x.get("format_code")))):
    d, f = str(p.get("design_code") or ""), str(p.get("format_code") or "")
    pk = p.get("packing") or {}
    app = (num(pk.get("pcs_per_carton")), num(pk.get("cbm_per_carton")), boxkey(pk.get("pack_box_ref")))
    rows = by_key.get((d, f), [])

    if not rows:
        cls = "not in sheet"
        opts = []
    else:
        opts = sorted({(num(r["WS_PackPPC"]), num(r["CBM/CTN"]), boxkey(r["PackBox"]),
                        r["PackBox"], num(r["Weight/CTN"]), r.get("箱尺寸", "")) for r in rows})
        match = [o for o in opts if (o[0], o[1], o[2]) == app]
        if not any(app):
            cls = "app blank"
        elif match:
            # Same numbers and same box family: is the sheet's reference fuller?
            cls = ("reference upgrade"
                   if match[0][3] and match[0][3].strip().lower() != str(pk.get("pack_box_ref") or "").strip().lower()
                   else "identical")
        else:
            cls = "VALUE CHANGE"
        if len(opts) > 1:
            cls += " + multi-option"

    stats[cls] += 1
    out.append({
        "design": d, "format": f, "name": p.get("design_name", ""),
        "status": p.get("status", ""), "classification": cls,
        "app_pcs": app[0], "app_cbm": app[1], "app_box": pk.get("pack_box_ref", ""),
        "sheet_options": len(opts),
        "sheet_pcs": " | ".join(o[0] for o in opts),
        "sheet_cbm": " | ".join(o[1] for o in opts),
        "sheet_box": " | ".join(o[3] for o in opts),
        "sheet_weight_ctn": " | ".join(o[4] for o in opts),
        "sheet_carton_dims": " | ".join(o[5] for o in opts),
    })

os.makedirs(OUTDIR, exist_ok=True)
path = os.path.join(OUTDIR, "packing_diff.csv")
with open(path, "w", newline="", encoding="utf-8-sig") as fh:
    w = csv.DictWriter(fh, fieldnames=list(out[0]))
    w.writeheader()
    w.writerows(out)

print(f"{len(products)} app products")
for k, v in stats.most_common():
    print(f"  {v:4d}  {k}")
print(f"\n-> migration/out/packing_diff.csv")
