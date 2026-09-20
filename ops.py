"""Operations CLI for the production environment: deploys and the daily backup.

Standard library only, so it never depends on the app's pinned packages.
Shell scripts only call into this module; the decisions live here.

    python3 ops.py snapshot --db PATH --dir DIR --commit SHA
    python3 ops.py preflight [--dev DIR] [--prod DIR] [--backup-root DIR] [--now ISO]
    python3 ops.py funnel-check [--host NAME] [--resolver IP[:PORT]]... [--timeout SECONDS]
    python3 ops.py backup --db PATH --uploads DIR [--backup-root DIR] [--now ISO]

deploy.sh and the backup LaunchAgent run it with the system python3 (3.9 on
macOS), so keep it 3.9-compatible.
"""

import argparse
import json
import os
import shutil
import socket
import sqlite3
import struct
import subprocess
import sys
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

PRE_DEPLOY_SNAPSHOTS_TO_KEEP = 5

DEFAULT_PROD_DIR = Path.home() / "services" / "receipt-system"
# Shared with the daily backup (#6): it writes BACKUP_STATUS_FILE here after
# every successful run as {"last_success": "<UTC ISO 8601>"}.
DEFAULT_BACKUP_ROOT = (Path.home() / "Library" / "Mobile Documents"
                       / "com~apple~CloudDocs" / "receipt-system-backup")
BACKUP_STATUS_FILE = "last-success.json"
BACKUP_MAX_AGE = timedelta(hours=48)
DAILY_SNAPSHOTS_TO_KEEP = 14
MONTHLY_SNAPSHOTS_TO_KEEP = 12

# Public resolvers, not the system one: on this Mac MagicDNS answers the Funnel
# hostname with the tailnet IP, so it looks fine even when the public record
# (the one phones on other networks use) is gone.
PUBLIC_RESOLVERS = ("1.1.1.1", "8.8.8.8")
DNS_TIMEOUT = 3.0
FUNNEL_REPAIR = "tailscale funnel reset && tailscale funnel --bg http://127.0.0.1:8000"


class SnapshotCheckFailed(Exception):
    pass


def _sqlite_backup(src_path, dst_path, check_integrity=False):
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
            if check_integrity:
                try:
                    problems = [row[0] for row in dst.execute("PRAGMA integrity_check")]
                except sqlite3.DatabaseError as e:
                    # Damaged badly enough that the check itself can't run.
                    problems = [str(e)]
                if problems != ["ok"]:
                    raise SnapshotCheckFailed("DB 快照沒有通過 integrity_check：" + "; ".join(problems[:5]))
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
    for old in existing[:-PRE_DEPLOY_SNAPSHOTS_TO_KEEP]:
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


def _dns_lookup(name, resolver, timeout):
    """Ask one resolver for the A record of `name`: "found", "missing" or "no reply".

    Plain UDP DNS, so this stays standard library only. "missing" means the
    resolver answered that the name has no address (NXDOMAIN or empty).
    """
    host, _, port = resolver.partition(":")
    query_id = os.urandom(2)
    # Header: recursion desired, one question, nothing else.
    header = query_id + struct.pack("!HHHHH", 0x0100, 1, 0, 0, 0)
    labels = name.rstrip(".").split(".")
    question = (b"".join(bytes([len(label)]) + label.encode("ascii") for label in labels)
                + b"\0" + struct.pack("!HH", 1, 1))  # type A, class IN
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(timeout)
            sock.sendto(header + question, (host, int(port) if port else 53))
            reply, _ = sock.recvfrom(512)
    except OSError:
        return "no reply"
    if len(reply) < 12 or reply[:2] != query_id:
        return "no reply"
    _, flags, _, answers, _, _ = struct.unpack("!HHHHHH", reply[:12])
    return "found" if (flags & 0xF) == 0 and answers > 0 else "missing"


def funnel_dns_status(host, resolvers, timeout):
    """Return "ok", "missing" or "unknown" for the Funnel hostname on public DNS.

    One resolver that can see the name is enough. "missing" needs at least one
    resolver to say so; if none replied at all we can't tell, and that must not
    be reported as an outage.
    """
    missing = False
    for resolver in resolvers:
        result = _dns_lookup(host, resolver, timeout)
        if result == "found":
            return "ok"
        missing = missing or result == "missing"
    return "missing" if missing else "unknown"


def _tailscale_dns_name():
    """Return this node's Funnel hostname from tailscale, or None."""
    try:
        result = subprocess.run(["tailscale", "status", "--json"],
                                capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            return None
        return json.loads(result.stdout)["Self"]["DNSName"].rstrip(".") or None
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError, AttributeError):
        return None


def _cmd_funnel_check(args):
    host = args.host or _tailscale_dns_name()
    if not host:
        print("⚠️  警告：找不到 Funnel 網址（tailscale status 失敗），略過對外連線檢查；"
              "可用 RECEIPT_FUNNEL_HOST 指定", file=sys.stderr)
        return 0
    resolvers = (args.resolver
                 or [r for r in os.environ.get("RECEIPT_FUNNEL_RESOLVERS", "").split(",") if r]
                 or list(PUBLIC_RESOLVERS))
    status = funnel_dns_status(host, resolvers, args.timeout)
    if status == "ok":
        print(f"✅ Funnel 對外 DNS 正常：{host}")
    elif status == "missing":
        # /healthz only proves the app runs on loopback. If the public record is
        # gone, phones on other networks can't even resolve the hostname.
        print(f"⚠️  警告：公網 DNS 查不到 {host}，外部網路（如手機行動網路）目前連不進來。\n"
              f"   可以先執行：{FUNNEL_REPAIR}\n"
              "   （剛重設過的話，公網 DNS 可能要幾分鐘才會更新）", file=sys.stderr)
    else:
        print(f"⚠️  警告：無法確認 Funnel 對外 DNS（連不到公網 DNS：{', '.join(resolvers)}）",
              file=sys.stderr)
    # Advisory only: the deploy itself already succeeded.
    return 0


def _copy_new_uploads(src_dir, dst_dir):
    """Copy photos the backup doesn't have yet. Never overwrites or deletes.

    Upload names are random UUIDs, so a name already in the backup is the
    same photo; keeping it also protects it from a deletion in the app.
    """
    for src in sorted(src_dir.rglob("*")):
        if not src.is_file():
            continue
        dst = dst_dir / src.relative_to(src_dir)
        if dst.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        # Copy under a temp name so an interrupted copy never looks backed up.
        partial = dst.with_name(dst.name + ".partial")
        try:
            shutil.copy2(src, partial)
            partial.replace(dst)
        except BaseException:
            partial.unlink(missing_ok=True)
            raise


def backup(db, uploads, backup_root, now):
    """Take the daily backup of the production DB and uploads into `backup_root`."""
    # A wrong path would otherwise back up no photos and still report success.
    if not uploads.is_dir():
        raise FileNotFoundError(f"找不到 uploads 目錄：{uploads}")

    daily_dir = backup_root / "db" / "daily"
    monthly_dir = backup_root / "db" / "monthly"
    daily_dir.mkdir(parents=True, exist_ok=True)
    monthly_dir.mkdir(parents=True, exist_ok=True)
    daily = daily_dir / f"receipt_system-{now.date().isoformat()}.db"
    _sqlite_backup(db, daily, check_integrity=True)

    # The first backup of a month becomes that month's snapshot. The daily one
    # is not in use and already checked, so copying it is safe.
    monthly = monthly_dir / f"receipt_system-{now.strftime('%Y-%m')}.db"
    if not monthly.exists():
        _sqlite_backup(daily, monthly)

    _copy_new_uploads(uploads, backup_root / "uploads")

    # Prune only after everything succeeded, so a failed run never costs us
    # an older backup. ISO dates sort by name.
    for directory, keep in ((daily_dir, DAILY_SNAPSHOTS_TO_KEEP),
                            (monthly_dir, MONTHLY_SNAPSHOTS_TO_KEEP)):
        for old in sorted(directory.glob("receipt_system-*.db"))[:-keep]:
            old.unlink()

    # Written last and atomically: preflight trusts this file to mean every
    # step above succeeded.
    status = backup_root / BACKUP_STATUS_FILE
    partial = status.with_name(status.name + ".partial")
    last_success = now.astimezone(timezone.utc).isoformat()
    partial.write_text(json.dumps({"last_success": last_success}) + "\n")
    partial.replace(status)


def _cmd_backup(args):
    # Name snapshots by the local date the run belongs to, not the UTC one.
    now = _parse_utc(args.now) if args.now else datetime.now().astimezone()
    try:
        backup(Path(args.db), Path(args.uploads), Path(args.backup_root), now)
    except (SnapshotCheckFailed, sqlite3.Error, OSError) as e:
        # launchd only keeps the log, so say what failed in one line.
        print(f"❌ {now.isoformat()} 每日備份失敗，既有備份沒有更動：{e}", file=sys.stderr)
        return 1
    print(f"✅ {now.isoformat()} 每日備份完成：{args.backup_root}")
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

    p = sub.add_parser("funnel-check",
                       help="after a deploy, warn if the Funnel hostname is missing from public DNS")
    p.add_argument("--host", default=os.environ.get("RECEIPT_FUNNEL_HOST"),
                   help="Funnel hostname (env: RECEIPT_FUNNEL_HOST; default: this node's name "
                        "from `tailscale status`)")
    p.add_argument("--resolver", action="append",
                   help="public DNS server as IP[:PORT], repeatable "
                        "(env: RECEIPT_FUNNEL_RESOLVERS, comma-separated; default: 1.1.1.1, 8.8.8.8)")
    p.add_argument("--timeout", type=float, default=DNS_TIMEOUT,
                   help="seconds to wait for each resolver")
    p.set_defaults(func=_cmd_funnel_check)

    p = sub.add_parser("backup", help="daily backup of production data (ADR-0005)")
    p.add_argument("--db", required=True)
    p.add_argument("--uploads", required=True)
    p.add_argument("--backup-root",
                   default=os.environ.get("RECEIPT_BACKUP_ROOT", str(DEFAULT_BACKUP_ROOT)),
                   help="daily backup root (env: RECEIPT_BACKUP_ROOT)")
    p.add_argument("--now", help="ISO 8601 time to treat as now (for tests)")
    p.set_defaults(func=_cmd_backup)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
