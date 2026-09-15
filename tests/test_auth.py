from conftest import TEST_PASSWORD

MAX_ATTEMPTS = 8
LOCKOUT_SECONDS = 15 * 60


def login(client, password, *, forwarded_for=None, remote_addr="127.0.0.1"):
    headers = {"X-Forwarded-For": forwarded_for} if forwarded_for else {}
    return client.post(
        "/api/auth/login",
        json={"password": password},
        headers=headers,
        environ_overrides={"REMOTE_ADDR": remote_addr},
    )


def fail_logins(client, times, **source):
    for _ in range(times):
        assert login(client, "wrong-password", **source).status_code == 401


def test_healthz_is_public(client):
    assert client.get("/healthz").status_code == 200


def test_api_requires_login(client):
    response = client.get("/api/trips")
    assert response.status_code == 401
    assert response.get_json()["login_required"] is True


def test_login_with_correct_password_grants_api_access(client):
    assert login(client, TEST_PASSWORD).status_code == 200
    assert client.get("/api/auth/status").get_json() == {"authenticated": True}


def test_login_attempts_log_the_forwarded_client_and_the_peer(client, caplog):
    # Lets the operator check in production that Funnel's X-Forwarded-For is the
    # real client, not the ingress node (ADR-0001).
    with caplog.at_level("INFO"):
        login(client, "wrong-password", forwarded_for="198.51.100.5")
        login(client, TEST_PASSWORD, forwarded_for="198.51.100.6")

    messages = [r.getMessage() for r in caplog.records if r.getMessage().startswith("login ")]
    assert messages == [
        "login failed client='198.51.100.5' remote_addr=127.0.0.1 x_forwarded_for='198.51.100.5'",
        "login succeeded client='198.51.100.6' remote_addr=127.0.0.1 x_forwarded_for='198.51.100.6'",
    ]


def test_login_log_never_contains_the_password(client, caplog):
    with caplog.at_level("INFO"):
        login(client, "wrong-password-in-log", forwarded_for="198.51.100.5")
        login(client, TEST_PASSWORD, forwarded_for="198.51.100.5")

    assert "wrong-password-in-log" not in caplog.text
    assert TEST_PASSWORD not in caplog.text


def test_funnel_client_is_locked_out_without_locking_out_other_clients(client):
    fail_logins(client, MAX_ATTEMPTS, forwarded_for="198.51.100.1")

    assert login(client, TEST_PASSWORD, forwarded_for="198.51.100.1").status_code == 429
    assert login(client, TEST_PASSWORD, forwarded_for="198.51.100.2").status_code == 200


def test_forged_forwarded_for_from_non_loopback_counts_against_remote_addr(client):
    for i in range(MAX_ATTEMPTS):
        # Rotating the forged header must not let the attacker dodge the lockout.
        assert login(client, "wrong-password", remote_addr="192.168.1.50",
                     forwarded_for=f"203.0.113.{i}").status_code == 401

    assert login(client, TEST_PASSWORD, remote_addr="192.168.1.50",
                 forwarded_for="203.0.113.99").status_code == 429
    # The forged addresses themselves were never charged.
    assert login(client, TEST_PASSWORD, forwarded_for="203.0.113.0").status_code == 200


def test_failures_within_the_same_ipv6_64_are_counted_together(client):
    for i in range(1, MAX_ATTEMPTS + 1):
        assert login(client, "wrong-password",
                     forwarded_for=f"2001:db8:1:2::{i:x}").status_code == 401

    assert login(client, TEST_PASSWORD, forwarded_for="2001:db8:1:2:ffff::1").status_code == 429
    assert login(client, TEST_PASSWORD, forwarded_for="2001:db8:1:3::1").status_code == 200


def test_ipv4_mapped_ipv6_is_counted_as_ipv4(client):
    fail_logins(client, MAX_ATTEMPTS, forwarded_for="::ffff:198.51.100.7")

    assert login(client, TEST_PASSWORD, forwarded_for="198.51.100.7").status_code == 429


def test_successful_login_resets_failure_count(client):
    fail_logins(client, MAX_ATTEMPTS - 1, forwarded_for="198.51.100.3")
    assert login(client, TEST_PASSWORD, forwarded_for="198.51.100.3").status_code == 200

    fail_logins(client, MAX_ATTEMPTS - 1, forwarded_for="198.51.100.3")
    assert login(client, TEST_PASSWORD, forwarded_for="198.51.100.3").status_code == 200


def test_lockout_expires_after_fifteen_minutes(client, clock):
    fail_logins(client, MAX_ATTEMPTS, forwarded_for="198.51.100.4")

    clock.advance(LOCKOUT_SECONDS - 60)
    assert login(client, TEST_PASSWORD, forwarded_for="198.51.100.4").status_code == 429

    clock.advance(61)
    assert login(client, TEST_PASSWORD, forwarded_for="198.51.100.4").status_code == 200
