import os
import uuid
from flask import Flask, request, jsonify, send_from_directory
from config import Config
from database import (
    init_db, create_trip, get_trips, get_active_trip, update_trip,
    create_receipt, get_receipts, get_receipt, update_receipt, delete_receipt,
    get_dashboard_data, get_stats_data,
)
from receipt_processor import process_receipt_image

app = Flask(__name__, static_folder="static", static_url_path="")
app.config.from_object(Config)

os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)


# ─── Static Files ───

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# ─── Receipt Upload & OCR ───

@app.route("/api/receipts/upload", methods=["POST"])
def upload_receipt():
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    # Determine MIME type
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "jpg"
    mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "heic": "image/heic"}
    mime_type = mime_map.get(ext, "image/jpeg")

    # Read image data
    image_data = file.read()

    # Save image
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(Config.UPLOAD_FOLDER, filename)
    with open(filepath, "wb") as f:
        f.write(image_data)

    try:
        # Process with Gemini
        result = process_receipt_image(image_data, mime_type)

        # Get active trip
        trip = get_active_trip()
        trip_id = trip["id"] if trip else None

        # Auto-save to database
        receipt_id = create_receipt(
            trip_id=trip_id,
            store_name=result.get("store_name", ""),
            date=result.get("date", ""),
            total_amount=result.get("total_amount", 0),
            currency=result.get("currency", "JPY"),
            payment_method=result.get("payment_method", "cash"),
            category=result.get("category", "其他"),
            image_path=filename,
            raw_json=result,
            items=result.get("items", []),
        )

        result["id"] = receipt_id
        result["image_path"] = filename
        return jsonify(result), 201

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/receipts/upload-only", methods=["POST"])
def upload_only():
    """Upload image and get OCR result without saving to database."""
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files["image"]
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "jpg"
    mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "heic": "image/heic"}
    mime_type = mime_map.get(ext, "image/jpeg")

    image_data = file.read()

    # Save image temporarily
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(Config.UPLOAD_FOLDER, filename)
    with open(filepath, "wb") as f:
        f.write(image_data)

    try:
        result = process_receipt_image(image_data, mime_type)
        result["image_path"] = filename
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/receipts/confirm", methods=["POST"])
def confirm_receipt():
    """Confirm and save a previously OCR'd receipt."""
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    trip = get_active_trip()
    trip_id = data.get("trip_id", trip["id"] if trip else None)

    receipt_id = create_receipt(
        trip_id=trip_id,
        store_name=data.get("store_name", ""),
        date=data.get("date", ""),
        total_amount=data.get("total_amount", 0),
        currency=data.get("currency", "JPY"),
        payment_method=data.get("payment_method", "cash"),
        category=data.get("category", "其他"),
        image_path=data.get("image_path", ""),
        raw_json=data,
        items=data.get("items", []),
        note=data.get("note", ""),
    )

    return jsonify({"id": receipt_id, "message": "Receipt saved"}), 201


# ─── Receipt CRUD ───

@app.route("/api/receipts", methods=["GET"])
def list_receipts():
    trip_id = request.args.get("trip_id", type=int)
    date = request.args.get("date")
    limit = request.args.get("limit", 100, type=int)
    offset = request.args.get("offset", 0, type=int)
    receipts = get_receipts(trip_id=trip_id, date=date, limit=limit, offset=offset)
    return jsonify(receipts)


@app.route("/api/receipts/<int:receipt_id>", methods=["GET"])
def get_receipt_detail(receipt_id):
    receipt = get_receipt(receipt_id)
    if not receipt:
        return jsonify({"error": "Receipt not found"}), 404
    return jsonify(receipt)


@app.route("/api/receipts/<int:receipt_id>", methods=["PUT"])
def update_receipt_api(receipt_id):
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400
    update_receipt(receipt_id, **data)
    return jsonify({"message": "Receipt updated"})


@app.route("/api/receipts/<int:receipt_id>", methods=["DELETE"])
def delete_receipt_api(receipt_id):
    receipt = get_receipt(receipt_id)
    if not receipt:
        return jsonify({"error": "Receipt not found"}), 404

    # Delete image file
    if receipt.get("image_path"):
        img_path = os.path.join(Config.UPLOAD_FOLDER, receipt["image_path"])
        if os.path.exists(img_path):
            os.remove(img_path)

    delete_receipt(receipt_id)
    return jsonify({"message": "Receipt deleted"})


# ─── Dashboard & Stats ───

@app.route("/api/dashboard", methods=["GET"])
def dashboard():
    trip_id = request.args.get("trip_id", type=int)
    if not trip_id:
        trip = get_active_trip()
        trip_id = trip["id"] if trip else None
    data = get_dashboard_data(trip_id)

    # Include active trip info
    trip = get_active_trip()
    data["active_trip"] = trip
    return jsonify(data)


@app.route("/api/stats", methods=["GET"])
def stats():
    trip_id = request.args.get("trip_id", type=int)
    if not trip_id:
        trip = get_active_trip()
        trip_id = trip["id"] if trip else None
    data = get_stats_data(trip_id)
    return jsonify(data)


# ─── Trip Management ───

@app.route("/api/trips", methods=["GET"])
def list_trips():
    trips = get_trips()
    return jsonify(trips)


@app.route("/api/trips", methods=["POST"])
def create_trip_api():
    data = request.json
    if not data or not data.get("name"):
        return jsonify({"error": "Trip name is required"}), 400

    trip_id = create_trip(
        name=data["name"],
        start_date=data.get("start_date"),
        end_date=data.get("end_date"),
        budget_cash=data.get("budget_cash", 0),
        currency=data.get("currency", "JPY"),
    )
    return jsonify({"id": trip_id, "message": "Trip created"}), 201


@app.route("/api/trips/<int:trip_id>", methods=["PUT"])
def update_trip_api(trip_id):
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400
    update_trip(trip_id, **data)
    return jsonify({"message": "Trip updated"})


# ─── Image Access ───

@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(Config.UPLOAD_FOLDER, filename)


# ─── Init & Run ───

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
