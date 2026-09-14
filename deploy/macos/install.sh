#!/bin/bash
# ═══════════════════════════════════════════════
#  Receipt System - macOS (Mac mini) production install
#  Usage:  sudo bash deploy/macos/install.sh [PREVIOUS_COMMIT]
#  Run it in the production clone only (see ADR-0004). Safe to re-run: first
#  install and every later deploy go through this same script.
#  PREVIOUS_COMMIT is what the rollback hint points at; deploy.sh passes the
#  commit from before its `git pull`. Defaults to the current HEAD.
# ═══════════════════════════════════════════════
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# 0. Only ever install from the production clone. Checked before anything
#    else so a mistaken run in the development repo touches nothing.
if [ ! -f "$APP_DIR/.production" ]; then
    echo "❌ $APP_DIR 沒有 .production 標記檔，這裡不是正式環境，拒絕安裝。"
    echo "   正式環境請 clone 到 ~/services/receipt-system，並在該目錄建立 .production。"
    exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
    echo "❌ 需要 sudo：sudo bash $0"
    exit 1
fi

RUN_USER="${SUDO_USER:-$(stat -f %Su "$APP_DIR")}"
APP_PORT="${APP_PORT:-8000}"
LABEL="com.receipt-system.gunicorn"
PLIST_DST="/Library/LaunchDaemons/$LABEL.plist"
LOG_DIR="/Users/$RUN_USER/Library/Logs/receipt-system"
DB_PATH="$APP_DIR/receipt_system.db"
SNAPSHOT_DIR="$APP_DIR/pre-deploy-snapshots"
# sudo's PATH has no /opt/homebrew/bin, and /usr/bin/python3 is too old for
# the pinned dependencies.
PYTHON="/opt/homebrew/bin/python3.14"
SNAPSHOT_PATH=""

as_user() { sudo -u "$RUN_USER" "$@"; }

# git refuses to work in a repo owned by someone else, so ask as the owner.
CURRENT_COMMIT="$(as_user git -C "$APP_DIR" rev-parse --short HEAD)"
PREV_COMMIT="${1:-$CURRENT_COMMIT}"

# Never roll back automatically: restoring the snapshot could overwrite data
# written before the failure (ADR-0004). Print the way back instead.
rollback_hint() {
    cat <<MSG

  ── 回退指引（不會自動執行）──
  上一個 commit : $PREV_COMMIT
  部署前快照    : ${SNAPSHOT_PATH:-（無，首次安裝）}
MSG
    if [ "$PREV_COMMIT" = "$CURRENT_COMMIT" ]; then
        echo "  ⚠️  沒有傳入上一個 commit，上面就是目前的 HEAD；請用 git log 找出要回退到哪個 commit。"
    fi
    cat <<MSG

  只回退程式碼：
      cd $APP_DIR
      git checkout $PREV_COMMIT
      sudo bash deploy/macos/install.sh $PREV_COMMIT
MSG
    if [ -n "$SNAPSHOT_PATH" ]; then
        cat <<MSG

  若 migration 弄壞了 DB，改用快照還原（快照之後寫入的資料會遺失）：
      cp "$SNAPSHOT_PATH" ~/receipt-system-restore.db   # 先複製出來：每次重跑安裝都會淘汰舊快照
      sudo launchctl bootout system/$LABEL
      cd $APP_DIR
      git checkout $PREV_COMMIT
      rm -f receipt_system.db-wal receipt_system.db-shm
      cp ~/receipt-system-restore.db receipt_system.db
      sudo bash deploy/macos/install.sh $PREV_COMMIT
MSG
    fi
    cat <<MSG

  回退後正式環境停在 detached HEAD，部署時的 git pull 會失敗；
  修好並 push 到 main 之後，先在 $APP_DIR 執行 git checkout main 再部署。
MSG
}

echo "══════════════════════════════════════"
echo "  📦 Receipt System (macOS)"
echo "  dir   : $APP_DIR"
echo "  user  : $RUN_USER"
echo "  port  : 127.0.0.1:$APP_PORT"
echo "  commit: $CURRENT_COMMIT (previous: $PREV_COMMIT)"
echo "══════════════════════════════════════"

# 1. .env sanity checks — this file is production config
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
    if [ ! -x "$PYTHON" ]; then
        echo "❌ 找不到 $PYTHON（brew install python@3.14）"
        exit 1
    fi
    as_user "$PYTHON" -m venv "$APP_DIR/venv"
fi
as_user "$APP_DIR/venv/bin/pip" install --quiet --upgrade pip
as_user "$APP_DIR/venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

# 3. Pre-deploy snapshot, then database migrations
echo "➤ Pre-deploy snapshot..."
# Name it after the commit the DB still belongs to (pre-migration), which is
# the commit the rollback hint pairs it with.
if ! SNAPSHOT_PATH="$(cd "$APP_DIR" && as_user "$APP_DIR/venv/bin/python" ops.py snapshot \
        --db "$DB_PATH" --dir "$SNAPSHOT_DIR" --commit "$PREV_COMMIT")"; then
    echo "❌ 部署前快照失敗，尚未執行 migration，服務維持原狀。"
    exit 1
fi
if [ -n "$SNAPSHOT_PATH" ]; then
    echo "   $SNAPSHOT_PATH"
fi

echo "➤ Initializing / migrating database..."
if ! (cd "$APP_DIR" && as_user "$APP_DIR/venv/bin/python" -c "from database import init_db; init_db()"); then
    echo "❌ Migration 失敗。"
    rollback_hint
    exit 1
fi
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
# bootout returns while gunicorn is still shutting down; bootstrapping before
# launchd has dropped the job fails with "5: Input/output error".
for _ in $(seq 1 30); do
    launchctl print "system/$LABEL" >/dev/null 2>&1 || break
    sleep 1
done
bootstrapped=false
for _ in $(seq 1 5); do
    if launchctl bootstrap system "$PLIST_DST"; then
        bootstrapped=true
        break
    fi
    sleep 2
done
if [ "$bootstrapped" != true ]; then
    echo "❌ launchd 無法載入 $PLIST_DST，服務目前沒有在執行。"
    rollback_hint
    exit 1
fi

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
    rollback_hint
    exit 1
fi

cat <<MSG

  Logs     : tail -f $LOG_DIR/gunicorn.err.log
  Restart  : sudo launchctl kickstart -k system/$LABEL
  Stop     : sudo launchctl bootout system/$LABEL

  Tailscale Funnel（只需設定一次，會保留）：
      tailscale funnel --bg http://127.0.0.1:$APP_PORT   （不要用 localhost，macOS 可能解析成 ::1）
      tailscale funnel status
MSG
