"""Seam 2: run `ops.py backup` as a separate process against temp directories."""

import json
import sqlite3
import subprocess
import sys
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path

OPS = Path(__file__).resolve().parent.parent / "ops.py"
NOW = "2026-09-15T03:00:00+08:00"


def make_db(path, rows):
    with closing(sqlite3.connect(path)) as conn:
        conn.execute("CREATE TABLE trips (id INTEGER PRIMARY KEY, name TEXT)")
        conn.executemany("INSERT INTO trips (name) VALUES (?)", [(r,) for r in rows])
        conn.commit()


def add_trip(path, name):
    with closing(sqlite3.connect(path)) as conn:
        conn.execute("INSERT INTO trips (name) VALUES (?)", (name,))
        conn.commit()


def read_trips(path):
    with closing(sqlite3.connect(path)) as conn:
        return [name for (name,) in conn.execute("SELECT name FROM trips ORDER BY id")]


class Production:
    def __init__(self, tmp_path):
        self.db = tmp_path / "receipt_system.db"
        self.uploads = tmp_path / "uploads"
        self.uploads.mkdir()
        self.backup_root = tmp_path / "backup"
        make_db(self.db, ["名古屋"])

    def backup(self, now=NOW):
        return subprocess.run(
            [sys.executable, str(OPS), "backup", "--db", str(self.db),
             "--uploads", str(self.uploads), "--backup-root", str(self.backup_root),
             "--now", now],
            capture_output=True, text=True,
        )

    def daily(self):
        return sorted((self.backup_root / "db" / "daily").glob("*.db"))

    def monthly(self):
        return sorted((self.backup_root / "db" / "monthly").glob("*.db"))

    def backup_on(self, day):
        """Record a trip named after `day`, then run that day's 03:00 backup."""
        add_trip(self.db, day.isoformat())
        result = self.backup(now=f"{day.isoformat()}T03:00:00+08:00")
        assert result.returncode == 0, result.stderr


def test_db_snapshot_opens_and_passes_integrity_check(tmp_path):
    prod = Production(tmp_path)

    result = prod.backup()

    assert result.returncode == 0, result.stderr
    [snapshot] = prod.daily()
    assert snapshot.name == "receipt_system-2026-09-15.db"
    assert read_trips(snapshot) == ["名古屋"]
    with closing(sqlite3.connect(snapshot)) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def test_success_records_when_it_happened_in_utc(tmp_path):
    prod = Production(tmp_path)

    result = prod.backup(now="2026-09-15T03:00:00+08:00")

    assert result.returncode == 0, result.stderr
    status = json.loads((prod.backup_root / "last-success.json").read_text())
    assert status == {"last_success": "2026-09-14T19:00:00+00:00"}


def test_forty_days_across_month_ends_keep_14_daily_and_one_per_month(tmp_path):
    prod = Production(tmp_path)

    for offset in range(40):  # 2026-01-25 .. 2026-03-05
        prod.backup_on(date(2026, 1, 25) + timedelta(days=offset))

    assert [p.name for p in prod.daily()] == [
        f"receipt_system-{date(2026, 2, 20) + timedelta(days=i)}.db" for i in range(14)]
    assert [p.name for p in prod.monthly()] == [
        "receipt_system-2026-01.db", "receipt_system-2026-02.db", "receipt_system-2026-03.db"]
    # Each month keeps its earliest backup.
    january, february, march = prod.monthly()
    assert read_trips(january)[-1] == "2026-01-25"
    assert read_trips(february)[-1] == "2026-02-01"
    assert read_trips(march)[-1] == "2026-03-01"


def test_monthly_snapshots_older_than_12_months_are_deleted(tmp_path):
    prod = Production(tmp_path)

    for month in range(1, 15):  # 2026-01 .. 2027-02
        prod.backup_on(date(2026 + (month - 1) // 12, (month - 1) % 12 + 1, 15))

    assert [p.name for p in prod.monthly()] == [
        f"receipt_system-{y}-{m:02d}.db"
        for y, m in [(2026, 3), (2026, 4), (2026, 5), (2026, 6), (2026, 7), (2026, 8),
                     (2026, 9), (2026, 10), (2026, 11), (2026, 12), (2027, 1), (2027, 2)]]


def test_photo_deleted_from_uploads_stays_in_the_backup(tmp_path):
    prod = Production(tmp_path)
    (prod.uploads / "a1b2.jpg").write_bytes(b"receipt photo")
    assert prod.backup(now="2026-09-14T03:00:00+08:00").returncode == 0

    (prod.uploads / "a1b2.jpg").unlink()
    result = prod.backup(now="2026-09-15T03:00:00+08:00")

    assert result.returncode == 0, result.stderr
    assert (prod.backup_root / "uploads" / "a1b2.jpg").read_bytes() == b"receipt photo"


def test_rerun_copies_only_new_photos(tmp_path):
    prod = Production(tmp_path)
    (prod.uploads / "old.jpg").write_bytes(b"old photo")
    assert prod.backup(now="2026-09-14T03:00:00+08:00").returncode == 0
    backed_up = prod.backup_root / "uploads" / "old.jpg"
    first_copy = backed_up.stat()

    (prod.uploads / "new.jpg").write_bytes(b"new photo")
    result = prod.backup(now="2026-09-15T03:00:00+08:00")

    assert result.returncode == 0, result.stderr
    assert backed_up.stat().st_ino == first_copy.st_ino
    assert backed_up.stat().st_mtime_ns == first_copy.st_mtime_ns
    assert (prod.backup_root / "uploads" / "new.jpg").read_bytes() == b"new photo"


def corrupt_db(path):
    """Scribble over an interior page: the file still opens, but isn't sound."""
    with closing(sqlite3.connect(path)) as conn:
        conn.executemany("INSERT INTO trips (name) VALUES (?)",
                         [("旅程" * 50,) for _ in range(500)])
        conn.commit()
        page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    with open(path, "r+b") as f:
        f.seek(page_size * 3)
        f.write(b"\xff" * page_size)


def test_corrupt_db_fails_without_touching_existing_backups(tmp_path):
    prod = Production(tmp_path)
    assert prod.backup(now="2026-09-14T03:00:00+08:00").returncode == 0
    status = (prod.backup_root / "last-success.json").read_text()
    before = {p: p.read_bytes() for p in prod.backup_root.rglob("*") if p.is_file()}

    corrupt_db(prod.db)
    result = prod.backup(now="2026-09-15T03:00:00+08:00")

    assert result.returncode != 0
    assert "每日備份失敗" in result.stderr
    assert "Traceback" not in result.stderr
    assert (prod.backup_root / "last-success.json").read_text() == status
    after = {p: p.read_bytes() for p in prod.backup_root.rglob("*") if p.is_file()}
    assert after == before


def test_missing_uploads_dir_fails_instead_of_backing_up_nothing(tmp_path):
    prod = Production(tmp_path)
    prod.uploads.rmdir()

    result = prod.backup()

    assert result.returncode != 0
    assert "每日備份失敗" in result.stderr
    assert not (prod.backup_root / "last-success.json").exists()
