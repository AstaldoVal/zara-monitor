#!/usr/bin/env bash
set -euo pipefail

PLIST_LABEL="com.dex.zara-montenegro-monitor"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

if [ -f "$PLIST_PATH" ]; then
  echo "Plist exists: $PLIST_PATH"
else
  echo "Plist not found: $PLIST_PATH"
fi

if launchctl list | grep "$PLIST_LABEL" >/dev/null 2>&1; then
  echo "launchd job is loaded: $PLIST_LABEL"
else
  echo "launchd job is NOT loaded: $PLIST_LABEL"
fi
