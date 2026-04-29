#!/usr/bin/env bash
set -euo pipefail

PLIST_LABEL="com.dex.zara-montenegro-monitor"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

launchctl unload "$PLIST_PATH" 2>/dev/null || true
rm -f "$PLIST_PATH"

echo "Removed launchd schedule: $PLIST_LABEL"
