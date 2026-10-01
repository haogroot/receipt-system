import io
import json
import sqlite3
from pathlib import Path

import pytest

import app as app_module
import receipt_processor
from config import Config
from conftest import TEST_PASSWORD
from database import get_receipt, init_db


@pytest.fixture
def api(client, tmp_path, monkeypatch):
    monkeypatch.setattr(Config, "DATABASE_PATH", str(tmp_path / "receipts.db"))
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(Config, "UPLOAD_FOLDER", str(upload_dir))
    init_db()
    assert client.post("/api/auth/login", json={"password": TEST_PASSWORD}).status_code == 200
    return client


def _photos():
    return [(io.BytesIO(b"top"), "top.jpg"), (io.BytesIO(b"bottom"), "bottom.png")]


def test_long_receipt_is_reviewed_then_saved_as_one_receipt(api, monkeypatch):
    seen = []

    def recognize(images):
        seen.extend(images)
        return {"store_name": "商店", "date": "2026-10-01", "total_amount": 150,
                "items": [{"name": "茶", "quantity": 1, "unit_price": 150, "amount": 150}]}

    monkeypatch.setattr(app_module, "process_receipt_images", recognize)

    response = api.post("/api/receipts/long/recognize", data={"images": _photos()})
    assert response.status_code == 200
    assert seen == [(b"top", "image/jpeg"), (b"bottom", "image/png")]
    assert list(Path(Config.UPLOAD_FOLDER).iterdir()) == []

    edited = response.get_json()
    edited["total_amount"] = 140
    response = api.post("/api/receipts/long/confirm", data={
        "receipt": json.dumps(edited), "images": _photos(),
    })
    assert response.status_code == 201
    saved = get_receipt(response.get_json()["id"])
    assert saved["total_amount"] == 140
    assert len(saved["image_paths"]) == 2
    assert saved["image_path"] == saved["image_paths"][0]
    assert saved["items"][0]["name"] == "茶"

    paths = [Path(Config.UPLOAD_FOLDER) / name for name in saved["image_paths"]]
    assert [path.read_bytes() for path in paths] == [b"top", b"bottom"]
    assert api.delete(f"/api/receipts/{saved['id']}").status_code == 200
    assert all(not path.exists() for path in paths)


def test_long_receipt_requires_two_photos_and_keeps_single_upload_limit(api):
    response = api.post("/api/receipts/long/recognize", data={"images": [(io.BytesIO(b"top"), "top.jpg")]})
    assert response.status_code == 400

    response = api.post("/api/receipts/upload", data={
        "image": (io.BytesIO(b"x" * (10 * 1024 * 1024 + 1)), "large.jpg"),
    })
    assert response.status_code == 413


def test_long_receipt_accepts_more_than_ten_mb_across_photos(api, monkeypatch):
    monkeypatch.setattr(app_module, "process_receipt_images", lambda images: {"photo_count": len(images)})
    response = api.post("/api/receipts/long/recognize", data={"images": [
        (io.BytesIO(b"a" * (6 * 1024 * 1024)), "top.jpg"),
        (io.BytesIO(b"b" * (6 * 1024 * 1024)), "bottom.jpg"),
    ]})
    assert response.status_code == 200
    assert response.get_json()["photo_count"] == 2


def test_existing_receipts_still_expose_their_single_photo(tmp_path, monkeypatch):
    db_path = tmp_path / "old.db"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE receipts (id INTEGER PRIMARY KEY, image_path TEXT)")
    conn.execute("INSERT INTO receipts (image_path) VALUES ('old.jpg')")
    conn.commit()
    conn.close()
    monkeypatch.setattr(Config, "DATABASE_PATH", str(db_path))

    init_db()

    assert get_receipt(1)["image_paths"] == ["old.jpg"]


def test_multiple_images_are_sent_to_gemini_in_order(monkeypatch):
    captured = {}

    class Models:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return type("Response", (), {"text": '{"store_name":"商店","total_amount":150}'})()

    monkeypatch.setattr(receipt_processor.genai, "Client", lambda **_kwargs: type("Client", (), {"models": Models()})())
    result = receipt_processor.process_receipt_images([(b"top", "image/jpeg"), (b"bottom", "image/jpeg")])

    parts = captured["contents"][0]["parts"]
    assert "重疊" in parts[0]["text"]
    assert parts[1]["text"].startswith("第 1 段")
    assert parts[3]["text"].startswith("第 2 段")
    assert result["total_amount"] == 150
