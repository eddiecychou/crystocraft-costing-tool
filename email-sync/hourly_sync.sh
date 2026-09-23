#!/bin/bash
# Hourly incremental email sync, run by launchd (see
# com.crystocraft.email-hourly-sync.plist, ~/Library/LaunchAgents/ — not
# committed here, OS-specific per Mac; recreate on the other Mac with the
# commands in docs/reference/LOCAL-TOOLS.md).
#
# Plain `sync.py` (no --rescan) — a fast UID-incremental IMAP fetch of only
# what's new since state.json's last-seen UID. This is what keeps
# CustomerDetail.jsx's Email Summary "Refresh" button close to real-time;
# see LESSONS-LEARNED.md / PROJECT-PLAN.md 2026-09-23 for why this was
# added (weekly_rescan.sh's Sunday 3am full rescan was the only schedule
# that existed before this, so a Monday email wouldn't show up until the
# following Sunday).
#
# Deliberately does NOT touch archive_import.py (the PST archive) — that's
# a static, already-imported backfill that never changes, unlike the live
# mbox.uart.com.hk mailbox sync.py polls. archive_import.py stays on the
# weekly schedule only, to catch newly-added customers against already-
# scanned archive mail.
set -e
cd "$(dirname "$0")"

PYTHON=/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3
LOG="hourly_$(date +%Y%m%d_%H%M%S).log"

{
  echo "=== Hourly sync started $(date) ==="
  "$PYTHON" sync.py
  echo "=== Hourly sync finished $(date) ==="
} > "$LOG" 2>&1

# Keep the 48 most recent logs (~2 days at hourly) — this runs unattended
# for months at a time with nobody rotating logs by hand.
ls -t hourly_*.log 2>/dev/null | tail -n +49 | xargs -I{} rm -f {}
