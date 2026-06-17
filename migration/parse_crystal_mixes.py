#!/usr/bin/env python3
"""Decode crystal mixture recipes from the legacy catalogue CSV.

Source: LocalWeb/Datafiles/catalogue_db/crystocraft_stk_db.csv
Columns: BodyCode,AccCode,MetalCode,CrystalColorCode,RunningNo,
         MonoCrystal_G,MixCrystal_G,MonoCrystal_C,MixCrystal_C,
         MonoCrystal_A,MixCrystal_A,Remarks,CAT,TYPE,TIME

Mix encoding (per cell): mixcode{c1 c2 c3::mixcode2{c4 c5::...
  '::' separates mixcodes, '{' separates mixcode from a space-separated
  list of crystal short-codes. Empty list (e.g. 'M3{') means undefined.

Mono encoding (per cell): space- or '::'-separated single crystal codes.

Output: migration/out/crystal_mixes_review.json  (per BodyCode recipes)
        + prints the distinct crystal-code set and distinct mixcode set.

Does NOT write Firestore.
"""
import csv, json, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "LocalWeb", "Datafiles", "catalogue_db", "crystocraft_stk_db.csv")
OUTDIR = os.path.join(HERE, "out")
OUT = os.path.join(OUTDIR, "crystal_mixes_review.json")


def parse_mix(cell):
    """'MX{RE GO::M1{RE PU' -> {'MX':['RE','GO'], 'M1':['RE','PU']}"""
    out = {}
    cell = (cell or "").strip()
    if not cell:
        return out
    for part in cell.split("::"):
        part = part.strip()
        if not part or "{" not in part:
            continue
        code, _, rest = part.partition("{")
        code = code.strip().upper()
        crystals = [c.strip().upper() for c in rest.split() if c.strip()]
        if code:
            out[code] = crystals
    return out


def parse_mono(cell):
    cell = (cell or "").strip()
    if not cell:
        return []
    raw = cell.replace("::", " ")
    return [c.strip().upper() for c in raw.split() if c.strip()]


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    # body -> {mixcode -> set(crystals)}, body -> set(mono codes)
    body_mixes = collections.defaultdict(dict)
    body_mono = collections.defaultdict(set)
    all_crystals = set()
    all_mixcodes = collections.Counter()
    # track per-plating divergence
    divergence = collections.defaultdict(set)  # body -> set of mixcodes that differ across G/C/A

    with open(SRC, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        for row in r:
            body = (row["BodyCode"] or "").strip().upper()
            if not body:
                continue
            per_plating = {}
            for suf in ("G", "C", "A"):
                mixes = parse_mix(row.get("MixCrystal_" + suf, ""))
                mono = parse_mono(row.get("MonoCrystal_" + suf, ""))
                per_plating[suf] = mixes
                for code, crystals in mixes.items():
                    all_mixcodes[code] += 1
                    all_crystals.update(crystals)
                    # shared-across-platings: union the crystals seen
                    existing = set(body_mixes[body].get(code, []))
                    existing.update(crystals)
                    body_mixes[body][code] = sorted(existing)
                for m in mono:
                    body_mono[body].add(m)
                    all_crystals.add(m)
            # detect divergence: same mixcode, different crystal list across platings
            codes = set()
            for suf in per_plating:
                codes.update(per_plating[suf].keys())
            for code in codes:
                lists = {tuple(per_plating[s].get(code, [])) for s in per_plating
                         if code in per_plating[s]}
                if len({l for l in lists if l}) > 1:
                    divergence[body].add(code)

    review = {
        body: {
            "mixes": body_mixes[body],
            "mono": sorted(body_mono.get(body, [])),
            "plating_divergence": sorted(divergence.get(body, [])),
        }
        for body in sorted(body_mixes)
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(review, f, indent=2, ensure_ascii=False)

    print(f"Bodies with mixes: {len(review)}")
    print(f"Distinct mixcodes: {sorted(all_mixcodes)}")
    print(f"Mixcode frequency: {dict(all_mixcodes.most_common())}")
    print(f"Distinct crystal codes ({len(all_crystals)}): {sorted(all_crystals)}")
    div_bodies = [b for b in divergence if divergence[b]]
    print(f"Bodies where a mixcode differs across platings: {len(div_bodies)}")
    if div_bodies:
        print("  e.g.", div_bodies[:10])
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
