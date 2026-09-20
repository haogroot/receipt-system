"""Shared fixtures.

Importing the app has side effects on the development environment: config.py
loads .env and may create .secret_key, and app.py creates the uploads folder.
Everything below runs before the app is imported so tests never read or touch
the development DB, uploads/ or .env.
"""

import atexit
import os
import shutil
import socket
import struct
import tempfile
import threading

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


class FakeDns:
    """A UDP DNS server on loopback that answers every query the same way.

    mode: "answer" (one A record), "nxdomain", "nodata" (name exists, no
    address) or "silent" (never replies, like an unreachable resolver).
    """

    def __init__(self, mode):
        self.mode = mode
        self.names = []  # every name asked about
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.settimeout(0.1)
        self.address = "127.0.0.1:%d" % self._sock.getsockname()[1]
        self._stopping = threading.Event()
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self):
        while not self._stopping.is_set():
            try:
                query, client = self._sock.recvfrom(512)
            except socket.timeout:
                continue
            except OSError:
                return
            question = query[12:]
            labels, i = [], 0
            while question[i]:
                labels.append(question[i + 1:i + 1 + question[i]].decode("ascii"))
                i += 1 + question[i]
            self.names.append(".".join(labels))
            reply = self._reply(query[:2], question)
            if reply:
                self._sock.sendto(reply, client)

    def _reply(self, query_id, question):
        if self.mode == "silent":
            return None
        rcode = 3 if self.mode == "nxdomain" else 0
        answers = 1 if self.mode == "answer" else 0
        header = query_id + struct.pack("!HHHHH", 0x8180 | rcode, 1, answers, 0, 0)
        record = b""
        if answers:
            # Points back at the name in the question; 203.0.113.7 is a documentation address.
            record = b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 60, 4) + bytes([203, 0, 113, 7])
        return header + question + record

    def stop(self):
        self._stopping.set()
        self._thread.join()
        self._sock.close()


@pytest.fixture
def dns_server():
    """Factory for local fake DNS servers; they are stopped after the test."""
    servers = []

    def start(mode):
        servers.append(FakeDns(mode))
        return servers[-1]

    yield start
    for server in servers:
        server.stop()
