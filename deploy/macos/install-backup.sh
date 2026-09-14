#!/bin/bash
# ═══════════════════════════════════════════════
#  Receipt System - daily backup LaunchAgent (ADR-0005)
#  Usage:  bash deploy/macos/install-backup.sh      (no sudo)
#  Run it in the production clone only (see ADR-0004). Safe to re-run.
# ═══════════════════════════════════════════════
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# Backing up the development repo would put throwaway data where the real
# backups live, so only ever install from the production clone.
if [ ! -f "$APP_DIR/.production" ]; then
    echo "❌ $APP_DIR 沒有 .production 標記檔，這裡不是正式環境，拒絕安裝。"
    exit 1
fi

# A LaunchAgent belongs to the user's GUI session; iCloud Drive syncs only there.
if [ "$(id -u)" -eq 0 ]; then
    echo "❌ 不要用 sudo：每日備份以目前使用者的 LaunchAgent 執行。"
    exit 1
fi

LABEL="com.receipt-system.backup"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/receipt-system"
DOMAIN="gui/$(id -u)"

echo "➤ Installing LaunchAgent $LABEL..."
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
sed -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    "$APP_DIR/deploy/macos/$LABEL.plist.template" > "$PLIST_DST"
plutil -lint "$PLIST_DST" >/dev/null

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
for _ in $(seq 1 30); do
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
    sleep 1
done
launchctl bootstrap "$DOMAIN" "$PLIST_DST"

cat <<MSG
✅ 每天 03:00 備份到 iCloud Drive 的 receipt-system-backup/

  立刻執行一次 : launchctl kickstart $DOMAIN/$LABEL
  Logs         : tail -f $LOG_DIR/backup.log $LOG_DIR/backup.err.log
  移除         : launchctl bootout $DOMAIN/$LABEL && rm $PLIST_DST

  第一次執行若跳出存取 iCloud Drive 的權限要求，請按允許；
  沒有跳出卻在 backup.err.log 看到 "Operation not permitted"，請到
  系統設定 → 隱私權與安全性 → 完整磁碟取用權限，加入 /usr/bin/python3。
MSG
