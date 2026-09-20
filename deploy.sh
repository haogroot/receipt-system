#!/bin/bash
# ═══════════════════════════════════════════════
#  Receipt System - deploy GitHub main to production (see ADR-0004)
#  Usage:  ./deploy.sh        (run from the development repo)
#  RECEIPT_PROD_DIR overrides the production clone (default ~/services/receipt-system);
#  RECEIPT_BACKUP_ROOT overrides where the daily backup status lives.
#  RECEIPT_FUNNEL_HOST overrides the Funnel hostname (default: from `tailscale status`).
# ═══════════════════════════════════════════════
set -euo pipefail

DEV_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. Preflight: the checks live in ops.py. It prints the production dir when
#    it passes; a non-zero exit stops here.
echo "➤ Preflight..."
PROD_DIR="$(python3 "$DEV_DIR/ops.py" preflight --dev "$DEV_DIR")"

# 2. Remember where production was, for the rollback hint, then update it.
#    --ff-only: never create a merge commit in production.
PREV_COMMIT="$(git -C "$PROD_DIR" rev-parse --short HEAD)"
echo "➤ git pull in $PROD_DIR (from $PREV_COMMIT)..."
if ! git -C "$PROD_DIR" pull --ff-only; then
    echo "❌ 正式環境無法 fast-forward 到 origin/main，尚未安裝，服務維持原狀。"
    exit 1
fi

# 3. Install. Asks for the password every time; no NOPASSWD rule on purpose.
echo "➤ sudo install.sh..."
sudo bash "$PROD_DIR/deploy/macos/install.sh" "$PREV_COMMIT"

# 4. install.sh's /healthz check only reaches 127.0.0.1, so also check that the
#    Funnel hostname is on public DNS. It only warns: the deploy has succeeded.
echo "➤ Funnel 對外 DNS..."
python3 "$DEV_DIR/ops.py" funnel-check || true
