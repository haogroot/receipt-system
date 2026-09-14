"""Operations CLI for the production deployment.

Standard library only, so it never depends on the app's pinned packages.
Shell scripts only call into this module; the decisions live here.

    python3 ops.py snapshot --db PATH --dir DIR --commit SHA
    python3 ops.py preflight [--dev DIR] [--prod DIR] [--backup-root DIR] [--now ISO]

deploy.sh runs it with the system python3 (3.9 on macOS), so keep it 3.9-compatible.
"""

import argparse
import json
import os
import sqlite3
import subprocess
import sys
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

SNAPSHOTS_TO_KEEP = 5

DEFAULT_PROD_DIR = Path.home() / "services" / "receipt-system"
# Shared with the daily backup (#6): it writes BACKUP_STATUS_FILE here after
# every successful run as {"last_success": "<UTC ISO 8601>"}.
DEFAULT_BACKUP_ROOT = (Path.home() / "Library" / "Mobile Documents"
                       / "com~apple~CloudDocs" / "receipt-system-backup")
BACKUP_STATUS_FILE = "last-success.json"
BACKUP_MAX_AGE = timedelta(hours=48)


def _sqlite_backup(src_path, dst_path):
    # The backup API gives a consistent copy even while gunicorn is writing;
    # copying the file directly could capture a half-written page.
    src_uri = src_path.resolve().as_uri() + "?mode=ro"
    # Write under a name the pruning glob ignores, so a failed backup never
    # counts as one of the snapshots we keep.
    partial = dst_path.with_name(dst_path.name + ".partial")
    try:
        with closing(sqlite3.connect(src_uri, uri=True)) as src, \
                closing(sqlite3.connect(partial)) as dst:
            src.backup(dst)
        partial.replace(dst_path)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


def snapshot(db, snapshot_dir, commit):
    """Take a pre-deploy snapshot, prune old ones, and return its path.

    Returns None when the DB doesn't exist yet (first install): nothing to lose.
    """
    if not db.exists():
        return None
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    # Fixed-width timestamp first, so sorting by name is sorting by age.
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    path = snapshot_dir / f"pre-deploy-{stamp}-{commit}.db"
    _sqlite_backup(db, path)

    existing = sorted(snapshot_dir.glob("pre-deploy-*.db"))
    for old in existing[:-SNAPSHOTS_TO_KEEP]:
        old.unlink()
    return path


def _cmd_snapshot(args):
    path = snapshot(Path(args.db), Path(args.dir), args.commit)
    # install.sh treats empty stdout as "nothing to snapshot".
    if path:
        print(path)
    else:
        print("DB 還不存在（首次安裝），略過部署前快照", file=sys.stderr)
    return 0


def _git(repo, *args):
    """Run git in `repo`; return stdout, or None if git failed."""
    result = subprocess.run(["git", "-C", str(repo), *args],
                            capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def _parse_utc(text):
    # Python 3.9's fromisoformat doesn't accept a trailing "Z".
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    moment = datetime.fromisoformat(text)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


def _last_backup_success(backup_root):
    """Return when the daily backup last succeeded, or None if unknown."""
    try:
        status = json.loads((backup_root / BACKUP_STATUS_FILE).read_text())
        return _parse_utc(status["last_success"])
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        # A missing or unreadable record means we can't vouch for any backup.
        return None


def preflight(dev, prod, backup_root, now):
    """Return (blockers, warnings) for deploying from `dev` to `prod`."""
    blockers, warnings = [], []

    # Compare against GitHub as it is now, not as of the last fetch: the
    # production clone pulls from GitHub, not from this repo.
    if _git(dev, "fetch", "--quiet", "origin", "main") is None:
        blockers.append("無法從 origin 取得最新的 main")
    else:
        local = _git(dev, "rev-parse", "--verify", "--quiet", "main")
        if local is None or local != _git(dev, "rev-parse", "origin/main"):
            blockers.append("開發環境的 main 和 origin/main 不一致（還沒 push，或落後 GitHub）")

    branch = _git(dev, "symbolic-ref", "--quiet", "--short", "HEAD")
    if branch != "main":
        blockers.append(f"目前不在 main（在 {branch or 'detached HEAD'}）")

    # New files count too. What the running service leaves behind (DB, WAL,
    # snapshots, venv) is in .gitignore, so it never shows up here.
    prod_changes = _git(prod, "status", "--porcelain")
    if prod_changes is None:
        blockers.append(f"{prod} 不是 git repo，找不到正式環境")
    elif prod_changes:
        blockers.append(f"正式環境 {prod} 有未 commit 的修改，請先確認是誰改的")

    # Only a warning: deploying ships what's on GitHub, never this working tree.
    if _git(dev, "status", "--porcelain"):
        warnings.append("開發環境有未 commit 的修改，這些修改不會被部署")

    last_success = _last_backup_success(backup_root)
    if last_success is None:
        warnings.append(f"找不到任何成功備份的紀錄（{backup_root / BACKUP_STATUS_FILE}）")
    elif now - last_success > BACKUP_MAX_AGE:
        hours = int((now - last_success).total_seconds() // 3600)
        max_hours = int(BACKUP_MAX_AGE.total_seconds() // 3600)
        warnings.append(f"每日備份已超過 {max_hours} 小時沒有成功（上次成功是 {hours} 小時前）")

    return blockers, warnings


def _cmd_preflight(args):
    now = _parse_utc(args.now) if args.now else datetime.now(timezone.utc)
    blockers, warnings = preflight(Path(args.dev), Path(args.prod),
                                   Path(args.backup_root), now)
    for message in blockers:
        print(f"❌ 擋下：{message}", file=sys.stderr)
    for message in warnings:
        print(f"⚠️  警告：{message}", file=sys.stderr)
    if blockers:
        return 1
    # deploy.sh reads the production dir from stdout, so its default and the
    # RECEIPT_PROD_DIR override are decided only here.
    print(args.prod)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="ops.py")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("snapshot", help="pre-deploy snapshot of the production DB")
    p.add_argument("--db", required=True)
    p.add_argument("--dir", required=True)
    p.add_argument("--commit", required=True,
                   help="commit the DB belongs to before this deploy's migrations")
    p.set_defaults(func=_cmd_snapshot)

    p = sub.add_parser("preflight", help="checks deploy.sh runs before deploying")
    p.add_argument("--dev", default=str(Path(__file__).resolve().parent),
                   help="development repo (default: the repo holding ops.py)")
    p.add_argument("--prod",
                   default=os.environ.get("RECEIPT_PROD_DIR", str(DEFAULT_PROD_DIR)),
                   help="production clone (env: RECEIPT_PROD_DIR)")
    p.add_argument("--backup-root",
                   default=os.environ.get("RECEIPT_BACKUP_ROOT", str(DEFAULT_BACKUP_ROOT)),
                   help="daily backup root (env: RECEIPT_BACKUP_ROOT)")
    p.add_argument("--now", help="ISO 8601 time to treat as now (for tests)")
    p.set_defaults(func=_cmd_preflight)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
