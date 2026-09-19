import json

import pytest

from config import Config
from conftest import TEST_PASSWORD
from database import create_trip, get_active_trip, init_db, update_trip


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(Config, "DATABASE_PATH", str(tmp_path / "receipt_system.db"))
    init_db()


@pytest.fixture
def api(client):
    assert client.post("/api/auth/login", json={"password": TEST_PASSWORD}).status_code == 200
    return client


def test_active_trip_wins_over_a_newer_inactive_trip():
    older = create_trip("Older")
    newer = create_trip("Newer")
    update_trip(newer, is_active=0)

    assert get_active_trip()["id"] == older


def test_falls_back_to_the_newest_trip_when_none_is_active():
    older = create_trip("Older")
    newer = create_trip("Newer")
    update_trip(older, is_active=0)
    update_trip(newer, is_active=0)

    assert get_active_trip()["id"] == newer


def test_no_trips_means_no_active_trip():
    assert get_active_trip() is None


def test_dashboard_uses_the_fallback_trips_credit_cards(api):
    trip = create_trip("Tokyo", cc_budgets={"豪": "Cathay:50000,NewCard:0"})
    update_trip(trip, is_active=0)

    data = api.get("/api/dashboard").get_json()

    assert data["active_trip"]["id"] == trip
    assert json.loads(data["active_trip"]["cc_budgets"]) == data["cc_budgets"]
    assert data["cc_budgets"]["豪"] == "Cathay:50000,NewCard:0"


def test_confirmed_receipt_is_filed_under_the_fallback_trip(api):
    trip = create_trip("Tokyo")
    update_trip(trip, is_active=0)

    receipt_id = api.post("/api/receipts/confirm", json={
        "store_name": "Shop", "date": "2026-09-10", "total_amount": 100,
        "payment_method": "credit_card", "credit_card_name": "NewCard", "paid_by": "豪",
    }).get_json()["id"]

    assert api.get(f"/api/receipts/{receipt_id}").get_json()["trip_id"] == trip
