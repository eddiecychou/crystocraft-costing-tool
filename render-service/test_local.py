"""Quick sanity check of the engine without the HTTP server.
Renders the sample butterfly in both modes. Run: python test_local.py
"""
import os
from PIL import Image
import engine

HERE = os.path.dirname(os.path.abspath(__file__))
# Icon-only crop (wordmark removed 2026-07-30 — fine text like this doesn't
# survive at crystal-stone resolution; the owner confirmed it's not worth
# testing against). See customizer-poc/swatches/butterfly.png for the source.
LOGO = os.path.join(HERE, "..", "customizer-poc", "swatches", "butterfly_icon.png")

if __name__ == "__main__":
    logo = Image.open(LOGO).convert("RGBA")

    engine.render(logo, mode="zone_map", crystal_type="fine_rock_1.5",
                  fg_color="Jet", bg_color="White").save("test_zone_map.png")
    print("wrote test_zone_map.png")

    engine.render(logo, mode="printed", crystal_type="fine_rock_1.5",
                  bg_color="White").save("test_printed.png")
    print("wrote test_printed.png")
