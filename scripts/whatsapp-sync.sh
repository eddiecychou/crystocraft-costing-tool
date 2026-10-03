#!/bin/bash
# WhatsApp archive auto-import, run by launchd (see
# com.crystocraft.whatsapp-auto-import.plist in ~/Library/LaunchAgents/ — not
# committed, OS-specific per Mac; recreate on the other Mac per
# docs/reference/LOCAL-TOOLS.md).
#
# Imports new/updated .zip files from ~/Whatsapp Archives/ (text-first) and
# then uploads their media. Known filenames (in scripts/whatsapp-import-
# manifest.json) are matched to their customer/contact/account; an unknown
# filename is printed as SKIP so it can be added to the manifest once.
# Idempotent — re-running updates in place and skips already-uploaded media.
set -e
cd "$(dirname "$0")/.."   # repo root

# launchd has a minimal PATH — use the absolute node path (same reason the
# email sync hardcodes its Python path).
NODE=/opt/homebrew/bin/node

LOG="scripts/whatsapp-sync_$(date +%Y%m%d_%H%M%S).log"

{
  echo "=== WhatsApp auto-import started $(date) ==="
  "$NODE" scripts/import-whatsapp-archives.mjs
  "$NODE" scripts/upload-whatsapp-media.mjs
  echo "=== WhatsApp auto-import finished $(date) ==="
} > "$LOG" 2>&1

# Keep the 48 most recent logs — this runs unattended for months.
ls -t scripts/whatsapp-sync_*.log 2>/dev/null | tail -n +49 | xargs -I{} rm -f {}
