"""Seam 2: run `ops.py funnel-check` as a separate process against fake DNS servers."""

import json
import os
import subprocess
import sys
from pathlib import Path

OPS = Path(__file__).resolve().parent.parent / "ops.py"
HOST = "receipt.example.ts.net"


def funnel_check(*args, env=None):
    return subprocess.run(
        [sys.executable, str(OPS), "funnel-check", *args],
        env={**os.environ, **(env or {})}, capture_output=True, text=True,
    )


def test_reports_ok_when_public_dns_resolves_the_host(dns_server):
    dns = dns_server("answer")

    result = funnel_check("--host", HOST, "--resolver", dns.address)

    assert result.returncode == 0, result.stderr
    assert HOST in result.stdout
    assert "警告" not in result.stderr
    assert dns.names == [HOST]


def test_warns_with_the_repair_command_when_the_name_is_missing(dns_server):
    for mode in ("nxdomain", "nodata"):
        dns = dns_server(mode)

        result = funnel_check("--host", HOST, "--resolver", dns.address)

        assert result.returncode == 0, result.stderr  # advisory: never fails a deploy
        assert "警告" in result.stderr
        assert HOST in result.stderr
        assert "tailscale funnel reset" in result.stderr
        assert "無法確認" not in result.stderr


def test_says_it_cannot_tell_when_no_resolver_replies(dns_server):
    dns = dns_server("silent")

    result = funnel_check("--host", HOST, "--resolver", dns.address, "--timeout", "0.3")

    assert result.returncode == 0, result.stderr
    assert "警告" in result.stderr
    assert "無法確認" in result.stderr
    assert "tailscale funnel reset" not in result.stderr


def test_one_resolver_that_sees_the_name_is_enough(dns_server):
    stale = dns_server("nxdomain")
    fresh = dns_server("answer")

    result = funnel_check("--host", HOST, "--resolver", stale.address,
                          "--resolver", fresh.address)

    assert result.returncode == 0, result.stderr
    assert "警告" not in result.stderr


def test_a_resolver_that_says_missing_outweighs_one_that_is_silent(dns_server):
    silent = dns_server("silent")
    missing = dns_server("nxdomain")

    result = funnel_check("--host", HOST, "--resolver", silent.address,
                          "--resolver", missing.address, "--timeout", "0.3")

    assert result.returncode == 0, result.stderr
    assert "tailscale funnel reset" in result.stderr


def test_host_and_resolvers_can_come_from_the_environment(dns_server):
    dns = dns_server("nxdomain")

    result = funnel_check(env={"RECEIPT_FUNNEL_HOST": HOST,
                               "RECEIPT_FUNNEL_RESOLVERS": dns.address})

    assert result.returncode == 0, result.stderr
    assert HOST in result.stderr
    assert dns.names == [HOST]


def fake_tailscale(tmp_path, body):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    script = bin_dir / "tailscale"
    script.write_text(f"#!/bin/bash\n{body}\n")
    script.chmod(0o755)
    return {"PATH": str(bin_dir)}


def test_host_defaults_to_this_nodes_tailscale_name(tmp_path, dns_server):
    dns = dns_server("answer")
    status = json.dumps({"Self": {"DNSName": "mac.tailnet.ts.net."}})
    path = fake_tailscale(tmp_path, f"echo '{status}'")

    result = funnel_check("--resolver", dns.address, env={**path, "RECEIPT_FUNNEL_HOST": ""})

    assert result.returncode == 0, result.stderr
    assert dns.names == ["mac.tailnet.ts.net"]  # without the trailing dot


def test_skips_with_a_warning_when_tailscale_gives_no_name(tmp_path, dns_server):
    dns = dns_server("answer")
    path = fake_tailscale(tmp_path, "exit 1")

    result = funnel_check("--resolver", dns.address, env={**path, "RECEIPT_FUNNEL_HOST": ""})

    assert result.returncode == 0, result.stderr
    assert "找不到 Funnel 網址" in result.stderr
    assert dns.names == []


def test_skips_with_a_warning_when_tailscale_is_not_installed(tmp_path, dns_server):
    dns = dns_server("answer")
    empty = tmp_path / "empty"
    empty.mkdir()

    result = funnel_check("--resolver", dns.address,
                          env={"PATH": str(empty), "RECEIPT_FUNNEL_HOST": ""})

    assert result.returncode == 0, result.stderr
    assert "找不到 Funnel 網址" in result.stderr
