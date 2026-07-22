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
    # Abbreviations and one typo in the ERP item master. "Emerlad" is Emerald;
    # it is spelled that way on C01-8115-14-008 and nowhere else.
    "blab": "AB",
    "dksapph": "DB",
    "emerlad": "EM",
    "dropcrystalcl": "CL",
    # An app colour code is a SLOT, not an exact physical colour: each supplier's
    # nearest equivalent shares it. Bohemia GR is Aquamarine, Swarovski GR is
    # Antique Green — no Bohemia stone is exactly Antique Green, and it is still
    # called GR. Same for Bordeaux, which is the Swarovski 8016/8116 stone in the
    # RE slot that Bohemia fills with Ruby. Both confirmed by the owner
    # 2026-07-22; neither needs a new library entry.
    "bordeaux": "RE",
    "antiquegreen": "GR",
    # Bohemia writes "(BL) … Medium Sapph", so the parenthetical already proved
    # this; confirmed by the owner 2026-07-22.
    "mediumsapphire": "BL",
    "mediumsapph": "BL",
}

# Accent colours: Swarovski chatons used to complement a main colour, never sold
# as a colourway of their own. The app's library has no code for them and should
# not — a colour that cannot be ordered on its own has no slot to fill, and
# adding one would let it be offered by mistake.
#
# Blank here is a decision, not an unanswered question, and the review file says
# so. Owner, 2026-07-22: "mostly chatons colours for accent and they are never
# major".
#
# Peach is a special case: PE exists in the library but is never used on
# figurines — only on the new crystal fabric flowers — so Light Peach on a
# chaton is an accent, not PE.
ACCENT_NO_SLOT = {
    "lightpeach", "lightcoloradotopaz", "smokedtopaz", "lightrose", "vintagerose",
    "amethyst", "lightamethyst", "blackdiamond", "bluezircon", "capriblue",
    "chrysolite", "garnet", "goldenshadow", "jet", "jonquil", "peridot",
    "siam", "whiteopal",
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


# C1 and CL are both "Clear" — the difference is grade, not colour, and no item
# name states it. C1 is the dazzle cut; CL was Swarovski Spectra, retired, and
# is now filled by Asfour and Chinese octagons. Name matching cannot see this:
# every one of these is called "Crystal" or "Clear" and was assigned C1.
#
# Settled against the ERP by looking at which colourways actually consume each
# stone. Asfour 1032/14 is deliberately absent — it runs in C1 colourways
# (5 against 2), so it is not part of the CL family despite being Asfour.
CODE_OVERRIDES = {
    "C01-1080-14-002": ("CL", "CL 57 colourways against 4 others"),
    "C01-1080-18-002": ("CL", "CLA only"),
    "C01-801 114-002": ("CL", "Spectra 8290/14 — CL 211 against C1 7"),
    "C01-801 220-002": ("CL", "Spectra 8290/20 — CL 9, rest are clear stones in coloured designs"),
    # C07-1080-14-002 Tian Hua #1050/14 is deliberately NOT here. It is the only
    # C07 code in the ERP, used by zero job orders and zero item-master BOMs, so
    # nothing can be inferred from consumption. The owner's read is that it is
    # probably C1 — more facets, like Asfour 1032 — rather than CL like Asfour
    # 1080 and Spectra 8290, but "probably" is not enough to write: a wrong
    # grade makes the app substitute a cheap stone for a dazzle-cut one. Left
    # blank so it reads as a question, and settable in Components -> Crystal
    # Stock once someone has the stone in hand.
}

out, stats = [], collections.Counter()
for r in rows:
    code, src = r.get("app_code", ""), ""
    if code:
        src = "exact (code in ERP name)"
    else:
        words = colour_words(r["erp_name"])
        n = norm(words)
        if n in ACCENT_NO_SLOT:
            # Before any matching. These end with a colour word that would
            # otherwise pull them into a slot they do not belong in: "Light Rose"
            # into PI, "Smoked Topaz" into TO.
            code, src = "", "accent — no library slot (decided)"
        elif words.upper() in app_colours:
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


# --- assignments for the app's own crystal stock items ------------------------
# The colour table only covers codes the derived BOM references (81 of them).
# The crystals collection holds 180, every one with an empty `colour`, so the
# same rules are applied to each item's own name.
def resolve(name):
    words = colour_words(name)
    n = norm(words)
    # Checked before any matching: several accents end with a colour word that
    # would otherwise pull them into a slot they do not belong in — "Light Rose"
    # into PI, "Smoked Topaz" into TO.
    if n in ACCENT_NO_SLOT:
        return "", "accent — no library slot (decided)"
    if words.upper() in app_colours:
        return words.upper(), "app code used as the name"
    if n in by_name:
        return by_name[n], "name match"
    if n in ALIASES:
        return ALIASES[n], "name match (alias)"
    for alias, c in sorted(list(ALIASES.items()) + list(by_name.items()),
                           key=lambda x: -len(x[0])):
        if n.endswith(alias) and n != alias:
            return c, "suffix match — CHECK"
    return "", ""


# (family, size, suffix) -> code, from the table above: a code the BOM uses is
# already resolved and should not be re-derived from a possibly different name.
from_table = {(r["family"], r["size"], r["suffix"]): (r["app_code"], r["match_source"])
              for r in out if r["app_code"]}

crystals_path = os.path.join(OUTDIR, "crystals_app.json")
if os.path.exists(crystals_path):
    items = json.load(open(crystals_path))["items"]
    assigns, astats = [], collections.Counter()
    for it in items:
        code = str(it.get("code") or "").strip()
        if code in CODE_OVERRIDES:
            app_code, why = CODE_OVERRIDES[code]
            src = f"grade override — {why}"
        else:
            parts = code.split("-")
            key = ("-".join(parts[:2]), parts[2], parts[3]) if len(parts) >= 4 else None
            app_code, src = from_table.get(key, ("", ""))
            if not app_code:
                app_code, src = resolve(str(it.get("name") or ""))
        astats[src or "unresolved"] += 1
        assigns.append({"id": it.get("id"), "code": code, "name": it.get("name", ""),
                        "current_colour": it.get("colour", ""),
                        "proposed_colour": app_code, "source": src,
                        "colour_words": colour_words(str(it.get("name") or ""))})
    with open(os.path.join(OUTDIR, "crystal_colour_assignments.csv"), "w",
              newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(assigns[0]))
        w.writeheader()
        w.writerows(assigns)
    print(f"\n{len(assigns)} app crystals")
    for k, v in astats.most_common():
        print(f"  {v:4d}  {k}")
    print("-> migration/out/crystal_colour_assignments.csv\n")

print(f"{len(out)} ERP colour entries")
for k, v in stats.most_common():
    print(f"  {v:4d}  {k}")
print("\nstill needing a human:")
for r in out:
    if not r["app_code"]:
        print(f"  {r['family']:10s} {r['size']:6s} {r['suffix']:4s} "
              f"{r['colour_words']:18s} | {r['erp_name'][:44]}")
print("\n-> migration/out/crystal_colour_map.csv")
