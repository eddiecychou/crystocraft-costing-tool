# Graphify knowledge graph

Machine-readable + human-readable map of the whole repo (code + docs), for AI
agents and teammates. Built with [`graphifyy`](https://pypi.org/project/graphifyy/).

## Files

| file | what |
|---|---|
| `graph.json` | the graph — 4,401 nodes, 10,094 edges, 298 communities. Consumed by every `graphify` query command and the MCP server. |
| `graph.html` | interactive force-directed view (vis-network). |
| `GRAPH_REPORT.md` | readable digest: community hubs, god nodes, surprising connections, hyperedges. |
| `.graphify_analysis.json`, `.graphify_labels.json` | community analysis + names — needed by `query` / `explain` / `path`. |
| `manifest.json` | per-file extraction manifest; lets `graphify update` do incremental re-extraction. |
| `vendor/vis-network.min.js` | vendored so `graph.html` works offline / in restricted viewers (see below). |
| `merged-graph.json` | this repo + the Crystocraft Expense Tool, unioned. Each node carries `repo: "costing-tool" \| "Expense Tool V1"`; ids are namespaced `<repo>::`. **No cross-repo edges** — the two apps talk over HTTP (`sync-operation-center.js` → `/api/finance-po-sync`), not by shared symbols. |
| `merged-graph.html` | node-level viewer for `merged-graph.json` with a **Repository toggle** — uncheck either repo to see the other codebase alone. graphify's own `export html` collapses >5000 nodes to a community blob, so this is a hand-rolled viewer (`scripts/build-merged-html.py`). |
| `cache/`, `YYYY-MM-DD/` | transient build cache + backups — gitignored. |

## Rebuilding the merged graph

```sh
graphify update .                                    # refresh this repo's graph.json
(cd "$EXPENSE_TOOL" && graphify update .)            # refresh the Expense Tool's
scripts/graphify-merge.sh                            # union + regenerate merged-graph.{json,html}
```
`EXPENSE_TOOL` defaults to `~/Documents/Coding/Crystocraft/Accounting/Expense Tool V1`.

## Viewing `graph.html`

Open it directly in a browser, or serve the folder:

```sh
cd graphify-out && python3 -m http.server 8899
# then open http://127.0.0.1:8899/graph.html
```

It references `vendor/vis-network.min.js` by a **relative path** (Graphify's
default is `unpkg.com`, which is blocked in non-browser viewers). If you re-run
extraction and the CDN reference comes back, run `scripts/graphify-localize.sh`.

## Refreshing the graph

```sh
graphify update .          # AST only, no API cost — after code changes
# full re-extract with doc<->code semantics:
export DEEPSEEK_API_KEY=$(grep '^DEEPSEEK_API_KEY=' ../.env.local | head -1 | cut -d= -f2-)
graphify extract . --backend deepseek && graphify cluster-only . --backend deepseek
scripts/graphify-localize.sh
```

## Querying

```sh
graphify query "how does a shipment reserve component stock?" --budget 2000
graphify explain "reserveForOrder()"
graphify affected "normLine()"
graphify path "Login()" "stampLogin()" --undirected
graphify god-nodes --top 20
```

## MCP

`graphify-mcp --graph graphify-out/graph.json` (stdio) exposes the same
traversals as tools for an agent. HTTP: add `--transport http --port 8080
--api-key <key>`.
