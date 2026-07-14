"""Crystal colours and types.

Approx render RGB per crystal colour (0..1). Iridescence (AB/Moonlight facet
hue, stronger on dark grounds) is a Phase-2 tuning item — see spec §14.11.
"""

# crystal colour -> approximate body RGB
CRYSTAL_COLORS = {
    "Jet":             (0.05, 0.05, 0.065),
    "Hematite":        (0.18, 0.18, 0.20),
    "CrystalAB":       (0.95, 0.96, 1.00),   # transparent/clear; iridescent (P2)
    "Crystal":         (0.94, 0.95, 0.97),
    "Moonlight":       (0.90, 0.93, 1.00),   # slight bluish (P2)
    "CrystalBlueLight":(0.80, 0.85, 0.95),
    "MetallicSilver":  (0.75, 0.76, 0.80),
    "GoldenShadow":    (0.78, 0.68, 0.50),
    "CrystalCopper":   (0.72, 0.48, 0.36),
    "CrystalDorado":   (0.80, 0.62, 0.30),
}
DEFAULT_FG = "Jet"
DEFAULT_BG = "CrystalAB"

# crystal type -> stone diameter in mm
STONE_MM = {
    "fabric_1.0":    1.0,
    "fine_rock_1.5": 1.5,
    "rock_2.0":      2.0,
}
DEFAULT_TYPE = "fine_rock_1.5"


def color_rgb(name):
    return CRYSTAL_COLORS.get(name, CRYSTAL_COLORS["Jet"])

def stone_mm(crystal_type):
    return STONE_MM.get(crystal_type, STONE_MM[DEFAULT_TYPE])
