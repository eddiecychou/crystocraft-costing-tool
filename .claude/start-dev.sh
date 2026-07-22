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

exec npx vite --port 5179
