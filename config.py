import os
import secrets
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_secret_key():
    """Return a stable secret key.

    It has to survive restarts and deploys: if it changes, every signed session
    cookie is invalidated and everyone is logged out — which defeats the point
    of a long-lived login.
    """
    key = os.getenv("SECRET_KEY") or os.getenv("FLASK_SECRET")
    if key:
        # The key signs the session cookie; a short one can be brute-forced
        # offline from any cookie, which would forge a login.
        if len(key) < 32:
            raise RuntimeError(
                "SECRET_KEY / FLASK_SECRET 太短（至少 32 字元）。"
                "建議直接從 .env 移除，讓系統自動產生並存到 .secret_key。"
            )
        return key

    key_file = os.path.join(BASE_DIR, ".secret_key")
    if os.path.exists(key_file):
        with open(key_file) as f:
            stored = f.read().strip()
            if stored:
                return stored

    key = secrets.token_urlsafe(48)
    with open(key_file, "w") as f:
        f.write(key)
    os.chmod(key_file, 0o600)
    return key


def _env_bool(name, default):
    val = os.getenv(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


class Config:
    BASE_DIR = BASE_DIR

    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
    DATABASE_PATH = os.path.join(BASE_DIR, "receipt_system.db")
    MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10MB
    SECRET_KEY = _load_secret_key()

    # ─── Auth ───
    AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "")
    AUTH_PASSWORD_HASH = os.getenv("AUTH_PASSWORD_HASH", "")
    # Bump this to force every device to log in again.
    AUTH_SESSION_VERSION = int(os.getenv("AUTH_SESSION_VERSION", "1"))
    # How long a device stays logged in without any activity.
    SESSION_LIFETIME = timedelta(days=int(os.getenv("SESSION_DAYS", "180")))
    # Cookies are HTTPS-only in production (Funnel terminates TLS).
    COOKIE_SECURE = _env_bool("COOKIE_SECURE", True)
