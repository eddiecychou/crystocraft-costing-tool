#!/bin/sh
# Graphify's graph.html loads vis-network from unpkg.com, which is blocked in
# every viewer that isn't a plain browser (Claude's file viewer, some CI
# artifact hosts). This vendors the library into graphify-out/vendor/ and
# rewrites the <script> tag to a relative path so the committed graph.html
# works everywhere and offline.
#
# Re-run after every `graphify extract` / `graphify update` / `graphify cluster-only`,
# since those regenerate graph.html and re-point it at the CDN.
set -e
cd "$(dirname "$0")/.."
OUT=graphify-out
VIS_VER=9.1.6
mkdir -p "$OUT/vendor"
if [ ! -s "$OUT/vendor/vis-network.min.js" ]; then
  curl -sSL -o "$OUT/vendor/vis-network.min.js" \
    "https://cdn.jsdelivr.net/npm/vis-network@${VIS_VER}/standalone/umd/vis-network.min.js"
fi
python3 - "$OUT/graph.html" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s2 = re.sub(r'<script src="https://unpkg\.com/vis-network@[^>]*?></script>',
            '<script src="vendor/vis-network.min.js"></script>', s, flags=re.S)
open(p, 'w', encoding='utf-8').write(s2)
print("graph.html: localised" if s2 != s else "graph.html: already local (no CDN ref found)")
PY
