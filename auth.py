"""Application-level authentication gate.

The app is published to the public internet through Tailscale Funnel, which
performs no authentication of its own — anything reachable on the local port is
reachable by anyone. So every request has to be checked here, including static
assets and uploaded receipt images.
"""

import ipaddress
import time
from flask import Blueprint, jsonify, redirect, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

from config import Config

auth_bp = Blueprint("auth", __name__)

# Endpoints that must stay reachable without a session cookie.
PUBLIC_ENDPOINTS = {
    "auth.login_page",
    "auth.login",
    "auth.logout",
    "auth.status",
    "healthz",
}

# Brute-force throttling. In-memory and therefore per-worker; with 2 gunicorn
# workers an attacker effectively gets 2x the attempts, which is still fine for
# a password of the length we require (ADR-0002).
MAX_ATTEMPTS = 8
ATTEMPT_WINDOW = 15 * 60   # seconds over which failures accumulate
LOCKOUT = 15 * 60          # seconds locked out after too many failures

_failures = {}  # source key -> {"count": int, "first": ts, "until": ts}

# Clock used for lockout bookkeeping; tests replace it to skip ahead in time.
_now = time.time

# Resolved once at startup so a bad configuration fails loudly and immediately.
_password_hash = None


def _client_ip():
    # Behind Funnel every request arrives from tailscaled on loopback. Funnel
    # overwrites X-Forwarded-For (Set, not append) with the real client address,
    # so a client cannot forge it (ADR-0001). Only trust it from loopback so
    # nobody on the LAN can inject it by connecting to the port directly.
    if request.remote_addr in ("127.0.0.1", "::1"):
        forwarded = request.headers.get("X-Forwarded-For", "").strip()
        if forwarded:
            return forwarded
    return request.remote_addr or "unknown"


def _source_key(ip):
    # A single IPv6 client typically controls a whole /64, so count failures per
    # /64 or an attacker could rotate addresses forever. IPv4-mapped IPv6 is the
    # same client as its IPv4 address.
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if addr.version == 6:
        if addr.ipv4_mapped:
            return str(addr.ipv4_mapped)
        return str(ipaddress.IPv6Network((int(addr), 64), strict=False))
    return str(addr)


def _lock_remaining(source):
    entry = _failures.get(source)
    if not entry:
        return 0
    remaining = int(entry.get("until", 0) - _now())
    return remaining if remaining > 0 else 0


def _record_failure(source):
    now = _now()
    entry = _failures.get(source)
    if not entry or now - entry["first"] > ATTEMPT_WINDOW:
        entry = {"count": 0, "first": now, "until": 0}
    entry["count"] += 1
    if entry["count"] >= MAX_ATTEMPTS:
        entry["until"] = now + LOCKOUT
        entry["count"] = 0
        entry["first"] = now
    _failures[source] = entry


def _clear_failures(source):
    _failures.pop(source, None)


def is_authenticated():
    return session.get("auth_v") == Config.AUTH_SESSION_VERSION


def _sign_in():
    # permanent + a long PERMANENT_SESSION_LIFETIME is what keeps the user
    # logged in across browser restarts, so they only log in once per device.
    session.permanent = True
    session["auth_v"] = Config.AUTH_SESSION_VERSION
    session["since"] = int(time.time())


# ─── Routes ───

@auth_bp.route("/login")
def login_page():
    if is_authenticated():
        return redirect("/")
    # Served as a standalone page so no gated asset (/css, /js) is needed here.
    return send_from_directory(Config.BASE_DIR, "static/login.html")


@auth_bp.route("/api/auth/login", methods=["POST"])
def login():
    source = _source_key(_client_ip())
    locked = _lock_remaining(source)
    if locked:
        return jsonify({"error": f"嘗試次數過多，請於 {locked // 60 + 1} 分鐘後再試"}), 429

    data = request.get_json(silent=True) or {}
    password = data.get("password", "")

    if not password or not check_password_hash(_password_hash, password):
        _record_failure(source)
        return jsonify({"error": "密碼錯誤"}), 401

    _clear_failures(source)
    _sign_in()
    return jsonify({"message": "登入成功"})


@auth_bp.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "已登出"})


@auth_bp.route("/api/auth/status")
def status():
    return jsonify({"authenticated": is_authenticated()})


# ─── Gate ───

def init_auth(app):
    global _password_hash

    if Config.AUTH_PASSWORD_HASH:
        _password_hash = Config.AUTH_PASSWORD_HASH
    elif Config.AUTH_PASSWORD:
        if len(Config.AUTH_PASSWORD) < 12:
            raise RuntimeError(
                "AUTH_PASSWORD 太短：公開在網際網路上的服務請使用至少 12 個字元的密碼。"
            )
        _password_hash = generate_password_hash(Config.AUTH_PASSWORD)
    else:
        # Fail closed: never start an unauthenticated service that is about to
        # be published through Funnel.
        raise RuntimeError(
            "未設定登入密碼。請在 .env 加入 AUTH_PASSWORD=<至少12字元的密碼>"
            "（或 AUTH_PASSWORD_HASH=<generate_password_hash 產生的雜湊>）後再啟動。"
        )

    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=Config.COOKIE_SECURE,
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=Config.SESSION_LIFETIME,
        SESSION_REFRESH_EACH_REQUEST=True,  # sliding expiry: active use never logs you out
    )

    app.register_blueprint(auth_bp)

    @app.before_request
    def require_login():
        if request.endpoint in PUBLIC_ENDPOINTS:
            return None
        if is_authenticated():
            return None
        if request.path.startswith("/api/"):
            return jsonify({"error": "未登入", "login_required": True}), 401
        return redirect("/login")

    @app.after_request
    def set_cache_headers(response):
        # Keep any intermediary (proxy, shared cache) from caching authenticated
        # content. Without this, a logged-in user's /uploads/<id>.jpg could be
        # served from cache to someone else, and a login redirect for
        # /js/app.js could be cached and break logged-in users.
        if (response.status_code >= 300
                or request.path.startswith(("/api/", "/uploads/"))
                or request.path in ("/", "/login")):
            response.headers["Cache-Control"] = "private, no-store"
        else:
            response.headers["Cache-Control"] = "private, no-cache"
        return response
