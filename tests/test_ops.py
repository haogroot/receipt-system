"""Seam 2: run the ops CLI as a separate process against temp directories."""

import sqlite3
import subprocess
import sys
from pathlib import Path

OPS = Path(__file__).resolve().parent.parent / "ops.py"


def run_ops(*args):
    return subprocess.run(
        [sys.executable, str(OPS), *map(str, args)],
        capture_output=True, text=True,
    )


def make_db(path, rows):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE trips (id INTEGER PRIMARY KEY, name TEXT)")
    conn.executemany("INSERT INTO trips (name) VALUES (?)", [(r,) for r in rows])
    conn.commit()
    conn.close()


def read_trips(path):
    conn = sqlite3.connect(path)
    try:
        return conn.execute("SELECT id, name FROM trips ORDER BY id").fetchall()
    finally:
        conn.close()


def snapshot(db, snapshot_dir, commit="abc1234"):
    return run_ops("snapshot", "--db", db, "--dir", snapshot_dir, "--commit", commit)


def test_snapshot_is_a_readable_copy_of_the_db(tmp_path):
    db = tmp_path / "receipt_system.db"
    make_db(db, ["名古屋", "大阪"])

    result = snapshot(db, tmp_path / "snapshots")

    assert result.returncode == 0, result.stderr
    snapshot_path = Path(result.stdout.strip())
    assert snapshot_path.parent == tmp_path / "snapshots"
    assert snapshot_path.name.startswith("pre-deploy-")
    assert "abc1234" in snapshot_path.name
    assert read_trips(snapshot_path) == [(1, "名古屋"), (2, "大阪")]


def test_sixth_snapshot_deletes_the_oldest(tmp_path):
    db = tmp_path / "receipt_system.db"
    make_db(db, ["名古屋"])
    snapshot_dir = tmp_path / "snapshots"
    snapshot_dir.mkdir()
    unrelated = snapshot_dir / "keep-me.db"
    unrelated.write_text("not a snapshot")

    paths = []
    for i in range(6):
        result = snapshot(db, snapshot_dir, commit=f"commit{i}")
        assert result.returncode == 0, result.stderr
        paths.append(Path(result.stdout.strip()))

    assert not paths[0].exists()
    assert all(p.exists() for p in paths[1:])
    assert sorted(snapshot_dir.glob("pre-deploy-*")) == sorted(paths[1:])
    assert unrelated.exists()


def test_snapshot_is_skipped_when_db_does_not_exist_yet(tmp_path):
    snapshot_dir = tmp_path / "snapshots"

    result = snapshot(tmp_path / "receipt_system.db", snapshot_dir)

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == ""
    assert not (tmp_path / "receipt_system.db").exists()
    assert not snapshot_dir.exists() or not any(snapshot_dir.iterdir())
