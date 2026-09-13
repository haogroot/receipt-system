"""Shared fixtures.

Importing the app has side effects on the development environment: config.py
loads .env and may create .secret_key, and app.py creates the uploads folder.
Everything below runs before the app is imported so tests never read or touch
the development DB, uploads/ or .env.
"""

import atexit
import os
import shutil
import tempfile

import dotenv
import pytest

TEST_PASSWORD = "correct-horse-battery-staple"

# config.py calls load_dotenv() at import time; make it a no-op so the
# development .env is never read.
dotenv.load_dotenv = lambda *args, **kwargs: False

for name in ("AUTH_PASSWORD_HASH", "FLASK_SECRET", "SESSION_DAYS", "AUTH_SESSION_VERSION"):
    os.environ.pop(name, None)
os.environ["AUTH_PASSWORD"] = TEST_PASSWORD
os.environ["SECRET_KEY"] = "test-secret-key-" + "x" * 32  # avoids writing .secret_key
os.environ["COOKIE_SECURE"] = "false"
os.environ["GEMINI_API_KEY"] = ""

from config import Config  # noqa: E402

_data_dir = tempfile.mkdtemp(prefix="receipt-system-test-")
atexit.register(shutil.rmtree, _data_dir, ignore_errors=True)
Config.UPLOAD_FOLDER = os.path.join(_data_dir, "uploads")
Config.DATABASE_PATH = os.path.join(_data_dir, "receipt_system.db")

import app as app_module  # noqa: E402
import auth  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_lockouts():
    # Failure counts are in-memory module state; start every test clean.
    auth._failures.clear()
    yield
    auth._failures.clear()


@pytest.fixture
def client():
    return app_module.app.test_client()


class FakeClock:
    def __init__(self, start=1_800_000_000.0):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock()
    monkeypatch.setattr(auth, "_now", fake)
    return fake
