#!/bin/bash
# V8.1 email ingestion — weekly full re-scan, run by launchd (see
# com.crystocraft.email-rescan.plist). Catches customers added to Firestore
# since their email history was first ingested — normal incremental runs
# only ever look at NEW mail/unscanned folders, so a newly-added customer's
# older, already-scanned messages would otherwise never get matched.
#
# Safe to re-run / interrupt: match_and_upsert's Message-ID dedup means a
# re-scan just re-confirms already-correct data for everyone except newly
# matched customers.
set -e
cd "$(dirname "$0")"

PYTHON=/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3
LOG="rescan_$(date +%Y%m%d_%H%M%S).log"

{
  echo "=== Weekly rescan started $(date) ==="
  "$PYTHON" sync.py --rescan
  echo "--- sync.py done, starting archive_import.py ---"
  "$PYTHON" archive_import.py --rescan --all
  echo "=== Weekly rescan finished $(date) ==="
} > "$LOG" 2>&1

# Keep the 8 most recent logs, prune older ones — this runs unattended for
# months at a time with nobody rotating logs by hand.
ls -t rescan_*.log 2>/dev/null | tail -n +9 | xargs -I{} rm -f {}
