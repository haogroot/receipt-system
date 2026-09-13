#!/bin/bash
# ═══════════════════════════════════════════════
#  Receipt System - macOS (Mac mini) service install
#  Usage:  sudo bash deploy/macos/install.sh
#  Safe to re-run: it also acts as "deploy the current working tree".
# ═══════════════════════════════════════════════
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "❌ 需要 sudo：sudo bash $0"
    exit 1
fi

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RUN_USER="${SUDO_USER:-$(stat -f %Su "$APP_DIR")}"
APP_PORT="${APP_PORT:-8000}"
LABEL="com.receipt-system.gunicorn"
PLIST_DST="/Library/LaunchDaemons/$LABEL.plist"
LOG_DIR="/Users/$RUN_USER/Library/Logs/receipt-system"

as_user() { sudo -u "$RUN_USER" "$@"; }

echo "══════════════════════════════════════"
echo "  📦 Receipt System (macOS)"
echo "  dir : $APP_DIR"
echo "  user: $RUN_USER"
echo "  port: 127.0.0.1:$APP_PORT"
echo "══════════════════════════════════════"

# 1. .env sanity checks — this file is production config now
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ 找不到 $ENV_FILE（可參考 .env.example）"
    exit 1
fi
env_get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"; }
if [ -z "$(env_get AUTH_PASSWORD)" ] && [ -z "$(env_get AUTH_PASSWORD_HASH)" ]; then
    echo "❌ .env 沒有設定 AUTH_PASSWORD，服務會拒絕啟動"
    exit 1
fi
case "$(env_get COOKIE_SECURE | tr '[:upper:]' '[:lower:]')" in
    false|0|no|off)
        echo "❌ .env 的 COOKIE_SECURE 是 false。正式環境走 HTTPS，請改成 true 或刪除該行。"
        exit 1 ;;
esac
chmod 600 "$ENV_FILE"

# 2. Python environment
echo "➤ Python venv & dependencies..."
if [ ! -x "$APP_DIR/venv/bin/python" ]; then
    as_user python3 -m venv "$APP_DIR/venv"
fi
as_user "$APP_DIR/venv/bin/pip" install --quiet --upgrade pip
as_user "$APP_DIR/venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

# 3. Database migrations
echo "➤ Initializing / migrating database..."
(cd "$APP_DIR" && as_user "$APP_DIR/venv/bin/python" -c "from database import init_db; init_db()")
as_user mkdir -p "$APP_DIR/uploads" "$LOG_DIR"

# 4. launchd
echo "➤ Installing LaunchDaemon..."
sed -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__RUN_USER__|$RUN_USER|g" \
    -e "s|__APP_PORT__|$APP_PORT|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    "$APP_DIR/deploy/macos/$LABEL.plist.template" > "$PLIST_DST"
chown root:wheel "$PLIST_DST"
chmod 644 "$PLIST_DST"
plutil -lint "$PLIST_DST" >/dev/null

launchctl bootout "system/$LABEL" 2>/dev/null || true
launchctl bootstrap system "$PLIST_DST"

# 5. Health check
echo "➤ Waiting for the app..."
for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:$APP_PORT/healthz" >/dev/null 2>&1; then
        echo "✅ App is up on 127.0.0.1:$APP_PORT"
        break
    fi
    sleep 1
done
if ! curl -fsS "http://127.0.0.1:$APP_PORT/healthz" >/dev/null 2>&1; then
    echo "❌ App did not come up. Last log lines:"
    tail -n 20 "$LOG_DIR/gunicorn.err.log" 2>/dev/null || true
    exit 1
fi

cat <<MSG

  Logs     : tail -f $LOG_DIR/gunicorn.err.log
  Restart  : sudo launchctl kickstart -k system/$LABEL
  Stop     : sudo launchctl bootout system/$LABEL

  Cloudflare Tunnel 的 Public Hostname 請指向：
      HTTP  →  127.0.0.1:$APP_PORT     （不要用 localhost，macOS 可能解析成 ::1）
MSG
