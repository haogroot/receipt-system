"""Operations CLI for the production deployment.

Standard library only, so it never depends on the app's pinned packages.
Shell scripts only call into this module; the decisions live here.

    python3 ops.py snapshot --db PATH --dir DIR --commit SHA
"""

import argparse
import sqlite3
import sys
from contextlib import closing
from datetime import datetime
from pathlib import Path

SNAPSHOTS_TO_KEEP = 5


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


def main(argv=None):
    parser = argparse.ArgumentParser(prog="ops.py")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("snapshot", help="pre-deploy snapshot of the production DB")
    p.add_argument("--db", required=True)
    p.add_argument("--dir", required=True)
    p.add_argument("--commit", required=True)
    p.set_defaults(func=_cmd_snapshot)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
