#!/usr/bin/env python3
"""Propose an app colour code for each (family, size, suffix) in the ERP.

Two sources, and they are not equally trustworthy:

  exact     The Bohemia descriptions embed the app's own code —
            "Bohemia glass 8232/14(PI) double hole Rosaline". That parenthetical
            is the answer, whatever the words around it say.
  name      Everything else has to be matched on the colour word. The app and
            the ERP do not always use the same word for the same code (app GO
            is "Light Topaz"; the Bohemia description for GO says "Amber"), so
            this is a proposal for the eye-check, not a conclusion.

Anything that does not match confidently is left blank rather than guessed.
Filling it in wrongly is worse than leaving it for a human: a wrong colour maps
a requirement onto the wrong bin.

  in:  migration/out/crystal_colour_table.csv   (from derive_crystal_bom.py)
  out: migration/out/crystal_colour_map.csv     (a separate file on purpose)

Writing the proposals back over the input made the script non-idempotent: a
second run read its own guesses and re-counted them as exact matches, taking
"exact" from 16 to 73 without anything having been verified.
"""
import json, os, re, csv, collections

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, "out")

app = json.load(open(os.path.join(OUTDIR, "crystal_colors_app.json")))["colors"]
# The mix configs live in the same list as real colours. They are not colours
# and must never be proposed as one.
MIX_RE = re.compile(r"^(mix|mix \()", re.I)
app_colours = {c["code"]: c.get("name", "") for c in app
               if c.get("name") and not MIX_RE.match(c["name"])}

rows = list(csv.DictReader(open(os.path.join(OUTDIR, "crystal_colour_table.csv"),
                                encoding="utf-8-sig")))


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


# app name -> code, plus the aliases the two systems genuinely disagree on.
# Every alias here is a judgement that a human should confirm; they are marked
# as proposals in the output, not as facts.
by_name = {norm(v): k for k, v in app_colours.items()}
# Only the pairings the two systems spell differently and that no Bohemia row
# can teach. Everything else is learned below from the ERP's own data.
ALIASES = {
    "crystal": "C1",
    "clear": "C1",
    "rose": "PI",
    "abbl": "AB",
    "crystalblab": "AB",
}


def colour_words(name):
    """Strip the pattern/shape prose and keep the trailing colour words."""
    s = name
    s = re.sub(r"\([^)]*\)", " ", s)                      # (PI), (14.4x14)
    # "heart crystal" is the product noun, not a colour. Left in, it made
    # "Bohemia heart crystal #3130 Rosaline" match C1 (Clear) instead of PI.
    s = re.sub(r"(?i)\bheart\s+crystal\b", " ", s)
    s = re.sub(r"(?i)\b(swarovski|bohemia|asfour|glass|strass|spectra|starss)\b", " ", s)
    s = re.sub(r"(?i)\b(double|single|one|dbl)\s*hole\b", " ", s)
    s = re.sub(r"[#][^\s]*", " ", s)                      # #1028/18
    s = re.sub(r"\b[A-Za-z]{1,2}\d[\w/]*\b", " ", s)      # PP1028/18, SS29
    s = re.sub(r"\b\d[\w/.]*\b", " ", s)                  # bare sizes
    # Stripping "#1028/18" leaves the bare size prefix behind ("PP", "SS"),
    # which then blocked every Swarovski chaton from matching.
    s = re.sub(r"(?i)\b(pp|ss)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# Learn the rest from the ERP itself: the Bohemia rows pair an app code with
# the ERP's own colour word ("(PU) double hole BlueViolet"), which is a better
# authority than anything hardcoded here.
for r in rows:
    if r.get("app_code"):
        learned = norm(colour_words(r["erp_name"]))
        if learned and learned not in ALIASES and learned not in by_name:
            ALIASES[learned] = r["app_code"]


out, stats = [], collections.Counter()
for r in rows:
    code, src = r.get("app_code", ""), ""
    if code:
        src = "exact (code in ERP name)"
    else:
        words = colour_words(r["erp_name"])
        n = norm(words)
        if words.upper() in app_colours:
            # A few ERP names carry the app's code as the colour word outright:
            # "Swarovski SS#1088/SS29  TO".
            code, src = words.upper(), "app code used as the name"
        elif n in by_name:
            code, src = by_name[n], "name match"
        elif n in ALIASES:
            code, src = ALIASES[n], "name match (alias)"
        else:
            # Last resort, and only as a suffix: "Light Rose" ends with "Rose".
            # An `alias in n` test matched substrings anywhere in the string and
            # produced three confidently wrong answers, so it is gone.
            for alias, c in sorted(list(ALIASES.items()) + list(by_name.items()),
                                   key=lambda x: -len(x[0])):
                if n.endswith(alias) and n != alias:
                    code, src = c, "suffix match — CHECK"
                    break
    stats[src or "unmatched — needs a human"] += 1
    out.append({**r, "app_code": code, "match_source": src,
                "colour_words": colour_words(r["erp_name"])})

with open(os.path.join(OUTDIR, "crystal_colour_map.csv"), "w", newline="",
          encoding="utf-8-sig") as fh:
    w = csv.DictWriter(fh, fieldnames=["family", "size", "suffix", "app_code",
                                       "match_source", "colour_words", "erp_name",
                                       "ambiguous"])
    w.writeheader()
    for r in out:
        w.writerow({k: r.get(k, "") for k in w.fieldnames})

print(f"{len(out)} ERP colour entries")
for k, v in stats.most_common():
    print(f"  {v:4d}  {k}")
print("\nstill needing a human:")
for r in out:
    if not r["app_code"]:
        print(f"  {r['family']:10s} {r['size']:6s} {r['suffix']:4s} "
              f"{r['colour_words']:18s} | {r['erp_name'][:44]}")
print("\n-> migration/out/crystal_colour_map.csv")
