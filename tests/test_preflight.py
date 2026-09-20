"""Seam 2: run `ops.py preflight` and `deploy.sh` as separate processes.

Each test builds a temp bare repo as origin, plus a development clone and a
production clone of it.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
NOW = "2026-09-14T12:00:00+00:00"

# Keep the user's git config (signing, hooks, default branch) out of the tests.
GIT_ENV = {
    **os.environ,
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@example.com",
}


def git(cwd, *args):
    result = subprocess.run(["git", "-C", str(cwd), *args], env=GIT_ENV,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def commit_file(repo, name, content):
    (repo / name).write_text(content)
    git(repo, "add", name)
    git(repo, "commit", "-q", "-m", f"update {name}")


class Repos:
    """origin (bare) + development clone + production clone, all in sync."""

    def __init__(self, tmp_path):
        self.origin = tmp_path / "origin.git"
        self.dev = tmp_path / "dev"
        self.prod = tmp_path / "prod"
        self.backup_root = tmp_path / "backup"
        self.backup_root.mkdir()

        git(tmp_path, "init", "-q", "--bare", "-b", "main", str(self.origin))
        git(tmp_path, "clone", "-q", str(self.origin), str(self.dev))
        git(self.dev, "checkout", "-q", "-b", "main")
        # Ship the real files, as they are in production.
        for name in ("ops.py", "deploy.sh", ".gitignore"):
            shutil.copy2(REPO / name, self.dev / name)
        git(self.dev, "add", "ops.py", "deploy.sh", ".gitignore")
        git(self.dev, "commit", "-q", "-m", "initial")
        git(self.dev, "push", "-q", "-u", "origin", "main")
        git(tmp_path, "clone", "-q", str(self.origin), str(self.prod))

        # Tests start from a healthy daily backup; the backup tests override it.
        self.record_backup("2026-09-14T03:00:00+00:00")

    def record_backup(self, when):
        (self.backup_root / "last-success.json").write_text(
            json.dumps({"last_success": when}))

    def preflight(self, env=None):
        env = env or {}
        # An explicit --backup-root would hide the environment variable.
        args = [] if "RECEIPT_BACKUP_ROOT" in env else ["--backup-root", str(self.backup_root)]
        return subprocess.run(
            [sys.executable, str(self.dev / "ops.py"), "preflight",
             "--dev", str(self.dev), "--prod", str(self.prod), "--now", NOW, *args],
            env={**GIT_ENV, **env}, capture_output=True, text=True,
        )


@pytest.fixture
def repos(tmp_path):
    return Repos(tmp_path)


def test_passes_without_warnings_when_everything_is_in_order(repos):
    result = repos.preflight()

    assert result.returncode == 0, result.stderr
    assert "擋下" not in result.stderr
    assert "警告" not in result.stderr


def test_blocks_when_main_has_unpushed_commits(repos):
    commit_file(repos.dev, "app.txt", "not pushed yet")

    result = repos.preflight()

    assert result.returncode != 0
    assert "擋下" in result.stderr
    assert "origin/main" in result.stderr


def test_blocks_when_not_on_main(repos):
    git(repos.dev, "checkout", "-q", "-b", "feature")

    result = repos.preflight()

    assert result.returncode != 0
    assert "目前不在 main" in result.stderr


def test_blocks_when_production_has_uncommitted_changes(repos):
    (repos.prod / "ops.py").write_text("# hotfixed by hand\n")

    result = repos.preflight()

    assert result.returncode != 0
    assert "正式環境" in result.stderr
    assert "未 commit" in result.stderr


def test_blocks_when_production_has_new_files(repos):
    (repos.prod / "hotfix.py").write_text("# added by hand\n")

    result = repos.preflight()

    assert result.returncode != 0
    assert "正式環境" in result.stderr


def test_files_left_by_the_running_service_are_not_changes(repos):
    for name in ("receipt_system.db", "receipt_system.db-wal", "receipt_system.db-shm"):
        (repos.prod / name).write_bytes(b"")

    result = repos.preflight()

    assert result.returncode == 0, result.stderr


def test_lists_every_blocker_at_once(repos):
    git(repos.dev, "checkout", "-q", "-b", "feature")
    commit_file(repos.dev, "app.txt", "not pushed yet")
    git(repos.dev, "branch", "-q", "-f", "main", "feature")
    (repos.prod / "ops.py").write_text("# hotfixed by hand\n")

    result = repos.preflight()

    assert result.returncode != 0
    assert result.stderr.count("擋下") == 3
    assert "origin/main" in result.stderr
    assert "目前不在 main" in result.stderr
    assert "正式環境" in result.stderr


def test_only_warns_when_development_has_uncommitted_changes(repos):
    (repos.dev / "deploy.sh").write_text("# work in progress\n")

    result = repos.preflight()

    assert result.returncode == 0, result.stderr
    assert "擋下" not in result.stderr
    assert "警告" in result.stderr
    assert "開發環境" in result.stderr


def test_only_warns_when_last_backup_is_older_than_48_hours(repos):
    repos.record_backup("2026-09-12T11:00:00+00:00")  # 49 hours before NOW

    result = repos.preflight()

    assert result.returncode == 0, result.stderr
    assert "擋下" not in result.stderr
    assert "警告" in result.stderr
    assert "48 小時" in result.stderr


def test_backup_within_48_hours_is_not_a_warning(repos):
    repos.record_backup("2026-09-12T13:00:00Z")  # 47 hours before NOW

    result = repos.preflight()

    assert result.returncode == 0, result.stderr
    assert "警告" not in result.stderr


def test_only_warns_when_there_is_no_backup_record(repos):
    (repos.backup_root / "last-success.json").unlink()

    result = repos.preflight()

    assert result.returncode == 0, result.stderr
    assert "擋下" not in result.stderr
    assert "警告" in result.stderr
    assert "找不到" in result.stderr


def test_backup_root_can_come_from_the_environment(repos, tmp_path):
    empty_root = tmp_path / "other-backup"

    result = repos.preflight(env={"RECEIPT_BACKUP_ROOT": str(empty_root)})

    assert result.returncode == 0, result.stderr
    assert "找不到" in result.stderr
    assert str(empty_root) in result.stderr


@pytest.fixture
def fake_sudo(tmp_path):
    """Put a `sudo` on PATH that records its arguments instead of running them."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "sudo.log"
    sudo = bin_dir / "sudo"
    sudo.write_text(f'#!/bin/bash\necho "$@" >> "{log}"\n')
    sudo.chmod(0o755)
    return bin_dir, log


def funnel_env_for(dns):
    """Point deploy.sh's Funnel check at a local fake DNS server."""
    return {"RECEIPT_FUNNEL_HOST": "receipt.example.ts.net",
            "RECEIPT_FUNNEL_RESOLVERS": dns.address}


@pytest.fixture
def funnel_env(dns_server):
    """By default the Funnel hostname is on public DNS, so deploys stay hermetic."""
    return funnel_env_for(dns_server("answer"))


def run_deploy(repos, fake_sudo, funnel_env):
    bin_dir, _ = fake_sudo
    return subprocess.run(
        ["bash", str(repos.dev / "deploy.sh")], cwd=repos.dev,
        env={**GIT_ENV, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
             "RECEIPT_PROD_DIR": str(repos.prod),
             "RECEIPT_BACKUP_ROOT": str(repos.backup_root),
             **funnel_env},
        capture_output=True, text=True,
    )


def test_deploy_pulls_and_installs_with_the_previous_commit(repos, fake_sudo, funnel_env):
    _, sudo_log = fake_sudo
    previous = git(repos.prod, "rev-parse", "--short", "HEAD")
    commit_file(repos.dev, "app.txt", "new feature")
    git(repos.dev, "push", "-q", "origin", "main")

    result = run_deploy(repos, fake_sudo, funnel_env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert git(repos.prod, "rev-parse", "HEAD") == git(repos.dev, "rev-parse", "HEAD")
    assert sudo_log.read_text().split() == [
        "bash", str(repos.prod / "deploy" / "macos" / "install.sh"), previous]
    assert "Funnel 對外 DNS 正常" in result.stdout
    assert "公網 DNS" not in result.stderr


def test_deploy_stops_before_pull_when_preflight_blocks(repos, fake_sudo, funnel_env):
    _, sudo_log = fake_sudo
    before = git(repos.prod, "rev-parse", "HEAD")
    commit_file(repos.dev, "app.txt", "new feature")
    git(repos.dev, "push", "-q", "origin", "main")
    (repos.prod / "ops.py").write_text("# hotfixed by hand\n")

    result = run_deploy(repos, fake_sudo, funnel_env)

    assert result.returncode != 0
    assert "擋下" in result.stderr
    assert git(repos.prod, "rev-parse", "HEAD") == before
    assert not sudo_log.exists()


def test_deploy_only_fast_forwards_production(repos, fake_sudo, funnel_env):
    _, sudo_log = fake_sudo
    commit_file(repos.dev, "app.txt", "new feature")
    git(repos.dev, "push", "-q", "origin", "main")
    # A committed local change in production: the tree is clean, but main
    # has diverged from GitHub, so only a merge could bring it up to date.
    commit_file(repos.prod, "hotfix.txt", "committed by hand")
    diverged = git(repos.prod, "rev-parse", "HEAD")

    result = run_deploy(repos, fake_sudo, funnel_env)

    assert result.returncode != 0
    assert "尚未安裝" in result.stdout + result.stderr
    assert git(repos.prod, "rev-parse", "HEAD") == diverged
    assert not sudo_log.exists()


def test_deploy_only_warns_when_funnel_is_missing_from_public_dns(repos, fake_sudo, dns_server):
    _, sudo_log = fake_sudo
    commit_file(repos.dev, "app.txt", "new feature")
    git(repos.dev, "push", "-q", "origin", "main")

    result = run_deploy(repos, fake_sudo, funnel_env_for(dns_server("nxdomain")))

    assert result.returncode == 0, result.stdout + result.stderr
    assert sudo_log.exists()  # the install ran; the check comes after it
    assert "公網 DNS 查不到 receipt.example.ts.net" in result.stderr
    assert "tailscale funnel reset" in result.stderr


def test_deploy_skips_the_funnel_check_when_install_fails(repos, fake_sudo, dns_server):
    bin_dir, _ = fake_sudo
    (bin_dir / "sudo").write_text("#!/bin/bash\nexit 1\n")
    dns = dns_server("answer")
    commit_file(repos.dev, "app.txt", "new feature")
    git(repos.dev, "push", "-q", "origin", "main")

    result = run_deploy(repos, fake_sudo, funnel_env_for(dns))

    assert result.returncode != 0
    assert dns.names == []
