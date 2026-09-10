#!/bin/sh
# Rebuild the cross-repo merged graph: Operation Center (this repo) + the
# Crystocraft Expense Tool. `graphify merge-graphs` unions the two namespaced
# by `repo`; scripts/build-merged-html.py then renders merged-graph.html with a
# per-repo toggle (graphify's own `export html` collapses >5000 nodes to a
# community blob, so we render node-level ourselves).
#
# Run after refreshing either repo's own graphify-out/graph.json.
set -e
cd "$(dirname "$0")/.."
# Absolute paths: `graphify merge-graphs` derives each repo's tag from the
# graph.json's grandparent dir name, so a relative path tags this repo "" (→ "repo").
CT="$(pwd)/graphify-out/graph.json"
EX="${EXPENSE_TOOL:-$HOME/Documents/Coding/Crystocraft/Accounting/Expense Tool V1}/graphify-out/graph.json"

[ -f "$CT" ] || { echo "missing $CT — run: graphify update ." >&2; exit 1; }
[ -f "$EX" ] || { echo "missing $EX — build it: (cd \"\$EXPENSE_TOOL\" && graphify extract . --backend deepseek)" >&2; exit 1; }

graphify merge-graphs "$CT" "$EX" --out graphify-out/merged-graph.json
python3 scripts/build-merged-html.py
echo "merged-graph.json + merged-graph.html rebuilt."
