#!/bin/bash
cd "/Users/eddie/Developer/costing-tool"

# This Mac has no permanent Node (see CLAUDE.md) — one is fetched into a
# per-session scratch directory instead. Find it rather than failing with
# "npx: not found", which is what happened when the launch config was first
# pointed at this script.
if ! command -v npx >/dev/null 2>&1; then
  for d in "$HOME"/.local/node*/bin \
           /private/tmp/claude-*/*/*/scratchpad/node-*/bin \
           /tmp/claude-*/*/*/scratchpad/node-*/bin; do
    if [ -x "$d/npx" ]; then PATH="$d:$PATH"; break; fi
  done
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "No Node found. Fetch one first:" >&2
  echo "  curl -sL https://nodejs.org/dist/v24.18.0/node-v24.18.0-darwin-arm64.tar.gz | tar xz -C \"\$SCRATCH\"" >&2
  exit 1
fi

# netlify-cli wraps Vite AND serves the real netlify/edge-functions/*.js at
# /api/* — plain `vite` has no route for them at all, so every edge function
# call 404'd here (discovered 2026-08-26 chasing a "WooCommerce sync failed
# (404)" that turned out to be this, not a real bug). --offline skips the
# Netlify-account env-var pull, which fails without a CLI login (see
# LOCAL-TOOLS.md) — .env.local's vars are injected either way.
exec npx netlify-cli dev --offline --port "${PORT:-5179}"
