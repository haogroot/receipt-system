import sqlite3

import pytest

import receipt_processor
from config import Config
from conftest import TEST_PASSWORD
from database import get_receipt, init_db


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(Config, "DATABASE_PATH", str(tmp_path / "receipt_system.db"))
    init_db()


@pytest.fixture
def api(client):
    assert client.post("/api/auth/login", json={"password": TEST_PASSWORD}).status_code == 200
    return client


def _confirm(api, **overrides):
    body = {"store_name": "Shop", "date": "2026-09-10", "total_amount": 100, "items": []}
    body.update(overrides)
    return api.post("/api/receipts/confirm", json=body).get_json()["id"]


@pytest.mark.parametrize("raw, expected", [
    (True, True),
    (False, False),
    (None, False),
    ("true", True),
    ("True", True),
    ("false", False),
    ("", False),
    (1, True),
    (0, False),
])
def test_recognition_normalizes_tax_free_to_a_bool(raw, expected):
    data = {"tax_free": raw}

    assert receipt_processor._normalize_receipt(data)["tax_free"] is expected


def test_recognition_defaults_to_not_tax_free_when_the_field_is_missing():
    assert receipt_processor._normalize_receipt({})["tax_free"] is False


def test_prompt_asks_the_model_for_the_tax_free_flag():
    assert '"tax_free"' in receipt_processor.RECEIPT_PROMPT


def test_confirmed_receipt_keeps_the_tax_free_flag(api):
    receipt_id = _confirm(api, tax_free=True)

    assert api.get(f"/api/receipts/{receipt_id}").get_json()["tax_free"] == 1


def test_receipt_is_not_tax_free_unless_stated(api):
    receipt_id = _confirm(api)

    assert api.get(f"/api/receipts/{receipt_id}").get_json()["tax_free"] == 0


def test_tax_free_can_be_corrected_after_recognition(api):
    receipt_id = _confirm(api, tax_free=False)

    api.put(f"/api/receipts/{receipt_id}", json={"tax_free": True})
    assert get_receipt(receipt_id)["tax_free"] == 1

    api.put(f"/api/receipts/{receipt_id}", json={"tax_free": False})
    assert get_receipt(receipt_id)["tax_free"] == 0


def test_recent_receipts_on_the_dashboard_carry_the_flag(api):
    _confirm(api, store_name="Duty Free", tax_free=True)

    recent = api.get("/api/dashboard").get_json()["recent_receipts"]

    assert [r["tax_free"] for r in recent if r["store_name"] == "Duty Free"] == [1]


def test_existing_database_gets_the_column_on_init(tmp_path, monkeypatch):
    old_db = tmp_path / "old.db"
    conn = sqlite3.connect(old_db)
    conn.execute("CREATE TABLE receipts (id INTEGER PRIMARY KEY, store_name TEXT)")
    conn.execute("INSERT INTO receipts (store_name) VALUES ('Old shop')")
    conn.commit()
    conn.close()
    monkeypatch.setattr(Config, "DATABASE_PATH", str(old_db))

    init_db()

    assert get_receipt(1)["tax_free"] == 0
