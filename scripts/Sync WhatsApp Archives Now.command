#!/bin/bash
# Double-click on macOS to run the same safe folder-based WhatsApp sync used
# by the daily launchd job. Archives are never uploaded through the OC UI.
set -e
ROOT="/Users/eddie/Developer/costing-tool"
cd "$ROOT"
exec /bin/bash "$ROOT/scripts/whatsapp-sync.sh"
