#!/usr/bin/env python3
"""Build a self-contained merged-graph.html with a per-repo toggle.

graphify's own `export html` collapses anything >5000 nodes to a community
blob, so this renders the real node-level merged graph (5292 nodes) with:
  - a Repository filter (show/hide each repo's nodes+edges independently)
  - nodes coloured by repo
  - leaf-node hide toggle, search, click-to-inspect
vis-network is loaded from the sibling vendor/ copy (offline-safe).
"""
import json, html
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "graphify-out"
g = json.loads((OUT / "merged-graph.json").read_text(encoding="utf-8"))

REPO_COLOR = {
    "costing-tool":     {"bg": "#4E79A7", "bd": "#2E5A85"},   # blue  — Operation Center
    "Expense Tool V1":  {"bg": "#E1575A", "bd": "#B23B3E"},   # red   — Expense Tool
}
REPO_LABEL = {
    "costing-tool": "Operation Center (costing-tool)",
    "Expense Tool V1": "Expense Tool V1",
}

deg = {}
for e in g["links"]:
    deg[e["source"]] = deg.get(e["source"], 0) + 1
    deg[e["target"]] = deg.get(e["target"], 0) + 1

nodes = []
for n in g["nodes"]:
    rid = n["repo"]
    c = REPO_COLOR.get(rid, {"bg": "#9c9c9c", "bd": "#6f6f6f"})
    nodes.append({
        "id": n["id"],
        "label": n.get("label") or n.get("local_id") or n["id"],
        "repo": rid,
        "group": rid,
        "community": n.get("community_name") or "",
        "file": n.get("source_file") or "",
        "loc": n.get("source_location") or "",
        "ftype": n.get("file_type") or "",
        "deg": deg.get(n["id"], 0),
        "color": {"background": c["bg"], "border": c["bd"],
                  "highlight": {"background": c["bg"], "border": "#111"}},
        "value": 1 + deg.get(n["id"], 0),
    })

edges = [{"from": e["source"], "to": e["target"],
         "rel": e.get("relation") or "", "repo": g_repo}
         for e in g["links"]
         for g_repo in (next((x["repo"] for x in g["nodes"] if x["id"] == e["source"]), ""),)]

data_json = json.dumps({"nodes": nodes, "edges": edges}, ensure_ascii=False, separators=(",", ":"))

counts = {}
for n in g["nodes"]:
    counts[n["repo"]] = counts.get(n["repo"], 0) + 1

repo_boxes = "\n".join(
    f'<label class="repo"><input type="checkbox" data-repo="{html.escape(r)}" checked> '
    f'<span class="sw" style="background:{REPO_COLOR.get(r,{}).get("bg","#999")}"></span>'
    f'{html.escape(REPO_LABEL.get(r, r))} <b>{counts[r]}</b></label>'
    for r in counts
)

HTML = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Crystocraft — merged graph (Operation Center + Expense Tool)</title>
<script src="vendor/vis-network.min.js"></script>
<style>
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ background:#0f0f1a; color:#e6e6e6; font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; height:100vh; display:flex; flex-direction:column; overflow:hidden; }}
  #bar {{ display:flex; gap:18px; align-items:center; flex-wrap:wrap; padding:10px 14px; background:#171728; border-bottom:1px solid #2a2a44; }}
  #bar h1 {{ font-size:13px; font-weight:600; color:#cfd3ff; }}
  .repo {{ display:inline-flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }}
  .repo .sw {{ width:11px; height:11px; border-radius:3px; display:inline-block; }}
  .repo b {{ color:#8a8ab5; font-weight:600; }}
  #bar label.opt {{ display:inline-flex; align-items:center; gap:5px; color:#a9a9c8; cursor:pointer; }}
  #search {{ background:#0f0f1a; border:1px solid #3a3a5e; color:#e6e6e6; padding:6px 9px; border-radius:6px; width:220px; outline:none; }}
  #search:focus {{ border-color:#4E79A7; }}
  #wrap {{ flex:1; display:flex; min-height:0; }}
  #graph {{ flex:1; }}
  #side {{ width:300px; background:#141426; border-left:1px solid #2a2a44; padding:14px; overflow:auto; }}
  #side h2 {{ font-size:12px; color:#8a8ab5; text-transform:uppercase; letter-spacing:.08em; margin-bottom:8px; }}
  #side .k {{ color:#8a8ab5; }} #side .v {{ color:#e6e6e6; word-break:break-word; }}
  #side .row {{ margin-bottom:7px; font-size:12px; }}
  #hint {{ color:#6a6a8a; font-size:12px; }}
  #stats {{ margin-left:auto; color:#6a6a8a; font-size:12px; }}
</style></head><body>
<div id="bar">
  <h1>Crystocraft merged graph</h1>
  {repo_boxes}
  <label class="opt"><input type="checkbox" id="hideLeaf"> hide leaf nodes (degree ≤ 1)</label>
  <input id="search" placeholder="search nodes…" autocomplete="off">
  <span id="stats"></span>
</div>
<div id="wrap">
  <div id="graph"></div>
  <div id="side"><h2>Node</h2><div id="hint">Click a node to inspect. The two repos share no edges — toggle either off to see one codebase alone.</div><div id="detail"></div></div>
</div>
<script type="application/json" id="data">{data_json}</script>
<script>
const RAW = JSON.parse(document.getElementById('data').textContent);
const allNodes = RAW.nodes, allEdges = RAW.edges;
const nodeById = Object.fromEntries(allNodes.map(n => [n.id, n]));
let nodes = new vis.DataSet(), edges = new vis.DataSet();
const container = document.getElementById('graph');
const network = new vis.Network(container, {{nodes, edges}}, {{
  nodes: {{ shape:'dot', scaling:{{min:4,max:26}}, font:{{color:'#c9c9e0',size:11,face:'monospace'}} }},
  edges: {{ color:{{color:'#33334d',highlight:'#6a6a9a'}}, width:0.5, smooth:false }},
  physics: {{ solver:'barnesHut', barnesHut:{{gravitationalConstant:-2600,springLength:95,springConstant:0.02,damping:0.55,avoidOverlap:0.1}}, stabilization:{{iterations:260,updateInterval:40}} }},
  interaction: {{ hover:true, tooltipDelay:120, hideEdgesOnDrag:true, navigationButtons:false }},
}});
// Physics runs the barnesHut solver every animation frame while enabled — on
// ~5,000 nodes that pegs a CPU core for as long as this tab stays open
// (foreground or background), which graphify's own graph.html avoids by
// switching physics off once stabilizationIterationsDone fires. This viewer
// rebuilds the DataSet on every repo/leaf toggle though (a fresh subset needs
// a fresh layout), so `on` (not `once`) re-arms it each time, and rebuild()
// re-enables physics only for that one re-layout pass.
network.on('stabilizationIterationsDone', () => network.setOptions({{physics:{{enabled:false}}}}));

function activeRepos() {{
  return [...document.querySelectorAll('input[data-repo]')].filter(c=>c.checked).map(c=>c.dataset.repo);
}}
function rebuild() {{
  const repos = new Set(activeRepos());
  const hideLeaf = document.getElementById('hideLeaf').checked;
  const nsub = allNodes.filter(n => repos.has(n.repo) && (!hideLeaf || n.deg > 1));
  const keep = new Set(nsub.map(n=>n.id));
  const esub = allEdges.filter(e => keep.has(e.from) && keep.has(e.to));
  nodes.clear(); edges.clear();
  nodes.add(nsub.map(n => ({{id:n.id,label:n.label,value:n.value,color:n.color,group:n.group}})));
  edges.add(esub.map((e,i) => ({{id:'e'+i,from:e.from,to:e.to}})));
  network.setOptions({{physics:{{enabled:true}}}});
  network.stabilize(260);
  document.getElementById('stats').textContent = nsub.length + ' nodes · ' + esub.length + ' edges shown';
}}
document.querySelectorAll('input[data-repo],#hideLeaf').forEach(c => c.addEventListener('change', rebuild));

network.on('click', p => {{
  const d = document.getElementById('detail');
  if (!p.nodes.length) {{ d.innerHTML=''; return; }}
  const n = nodeById[p.nodes[0]];
  d.innerHTML = [
    ['label', n.label], ['repo', n.repo], ['community', n.community],
    ['file', n.file + (n.loc ? ' · '+n.loc : '')], ['type', n.ftype], ['degree', n.deg],
  ].map(([k,v]) => `<div class="row"><span class="k">${{k}}:</span> <span class="v">${{v||'—'}}</span></div>`).join('');
}});
const search = document.getElementById('search');
search.addEventListener('keydown', e => {{
  if (e.key !== 'Enter') return;
  const q = search.value.trim().toLowerCase(); if (!q) return;
  const hit = nodes.get().find(n => (n.label||'').toLowerCase().includes(q));
  if (hit) {{ network.selectNodes([hit.id]); network.focus(hit.id, {{scale:1.1,animation:true}}); }}
}});
rebuild();
</script></body></html>
"""

(OUT / "merged-graph.html").write_text(HTML, encoding="utf-8")
print("wrote merged-graph.html", (OUT / "merged-graph.html").stat().st_size, "bytes")
print("nodes:", len(nodes), "edges:", len(edges), "repos:", counts)
