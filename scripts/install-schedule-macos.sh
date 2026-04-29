#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$APP_ROOT/output"
LOG_FILE="$LOG_DIR/scheduler.log"
PLIST_LABEL="com.dex.zara-montenegro-monitor"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"

NODE_PATH="$(command -v node || true)"
if [ -z "$NODE_PATH" ]; then
  echo "Node.js not found. Install Node.js first."
  exit 1
fi

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$APP_ROOT" &amp;&amp; "$NODE_PATH" src/scheduler.cjs --scheduled &gt;&gt; "$LOG_FILE" 2&gt;&amp;1</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>WorkingDirectory</key>
  <string>$APP_ROOT</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "Installed launchd schedule: $PLIST_LABEL"
echo "Runs every 5 minutes; real execution happens only Mon/Thu 10:00 GMT+1."
echo "Logs: $LOG_FILE"
