import sqlite3
import json
from config import Config


def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(Config.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Initialize the database schema."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            start_date TEXT,
            end_date TEXT,
            budget_cash REAL DEFAULT 0,
            currency TEXT DEFAULT 'JPY',
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            credit_cards TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER REFERENCES trips(id),
            store_name TEXT,
            date TEXT,
            total_amount REAL,
            currency TEXT,
            payment_method TEXT,
            category TEXT,
            image_path TEXT,
            raw_json TEXT,
            note TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            credit_card_name TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS receipt_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            receipt_id INTEGER REFERENCES receipts(id) ON DELETE CASCADE,
            name TEXT,
            quantity INTEGER DEFAULT 1,
            unit_price REAL,
            amount REAL
        );
    """)

    # Alter tables to add new columns if they don't exist yet (for existing dbs)
    try:
        cursor.execute("ALTER TABLE trips ADD COLUMN credit_cards TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE receipts ADD COLUMN credit_card_name TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()


# ─── Trip Operations ───

def create_trip(name, start_date=None, end_date=None, budget_cash=0, currency="JPY", credit_cards=""):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO trips (name, start_date, end_date, budget_cash, currency, credit_cards) VALUES (?, ?, ?, ?, ?, ?)",
        (name, start_date, end_date, budget_cash, currency, credit_cards),
    )
    conn.commit()
    trip_id = cursor.lastrowid
    conn.close()
    return trip_id


def get_trips():
    conn = get_db()
    trips = conn.execute("SELECT * FROM trips ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(t) for t in trips]


def get_active_trip():
    conn = get_db()
    trip = conn.execute("SELECT * FROM trips WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1").fetchone()
    conn.close()
    return dict(trip) if trip else None


def update_trip(trip_id, **kwargs):
    conn = get_db()
    allowed = ["name", "start_date", "end_date", "budget_cash", "currency", "is_active", "credit_cards"]
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        conn.close()
        return False
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [trip_id]
    conn.execute(f"UPDATE trips SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return True


# ─── Receipt Operations ───

def create_receipt(trip_id, store_name, date, total_amount, currency, payment_method,
                   category, image_path, raw_json, items, note="", credit_card_name=""):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO receipts
           (trip_id, store_name, date, total_amount, currency, payment_method, category, image_path, raw_json, note, credit_card_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (trip_id, store_name, date, total_amount, currency, payment_method,
         category, image_path, json.dumps(raw_json, ensure_ascii=False), note, credit_card_name),
    )
    receipt_id = cursor.lastrowid

    for item in items:
        cursor.execute(
            "INSERT INTO receipt_items (receipt_id, name, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?)",
            (receipt_id, item.get("name", ""), item.get("quantity", 1),
             item.get("unit_price", 0), item.get("amount", 0)),
        )

    conn.commit()
    conn.close()
    return receipt_id


def get_receipts(trip_id=None, date=None, limit=100, offset=0):
    conn = get_db()
    query = "SELECT * FROM receipts WHERE 1=1"
    params = []

    if trip_id:
        query += " AND trip_id = ?"
        params.append(trip_id)
    if date:
        query += " AND date = ?"
        params.append(date)

    query += " ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    receipts = conn.execute(query, params).fetchall()
    result = []
    for r in receipts:
        rd = dict(r)
        items = conn.execute(
            "SELECT * FROM receipt_items WHERE receipt_id = ?", (rd["id"],)
        ).fetchall()
        rd["items"] = [dict(i) for i in items]
        result.append(rd)

    conn.close()
    return result


def get_receipt(receipt_id):
    conn = get_db()
    r = conn.execute("SELECT * FROM receipts WHERE id = ?", (receipt_id,)).fetchone()
    if not r:
        conn.close()
        return None
    rd = dict(r)
    items = conn.execute(
        "SELECT * FROM receipt_items WHERE receipt_id = ?", (receipt_id,)
    ).fetchall()
    rd["items"] = [dict(i) for i in items]
    conn.close()
    return rd


def update_receipt(receipt_id, **kwargs):
    conn = get_db()
    allowed = ["store_name", "date", "total_amount", "currency", "payment_method", "category", "note", "trip_id", "credit_card_name"]
    fields = {k: v for k, v in kwargs.items() if k in allowed}

    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [receipt_id]
        conn.execute(f"UPDATE receipts SET {set_clause} WHERE id = ?", values)

    if "items" in kwargs:
        conn.execute("DELETE FROM receipt_items WHERE receipt_id = ?", (receipt_id,))
        for item in kwargs["items"]:
            conn.execute(
                "INSERT INTO receipt_items (receipt_id, name, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?)",
                (receipt_id, item.get("name", ""), item.get("quantity", 1),
                 item.get("unit_price", 0), item.get("amount", 0)),
            )

    conn.commit()
    conn.close()
    return True


def delete_receipt(receipt_id):
    conn = get_db()
    conn.execute("DELETE FROM receipts WHERE id = ?", (receipt_id,))
    conn.commit()
    conn.close()
    return True


# ─── Dashboard & Stats ───

def get_dashboard_data(trip_id=None):
    conn = get_db()
    from datetime import date as dt_date
    today = dt_date.today().isoformat()

    # Today's spending
    params_today = [today]
    q_today = "SELECT COALESCE(SUM(total_amount), 0) as total FROM receipts WHERE date = ?"
    if trip_id:
        q_today += " AND trip_id = ?"
        params_today.append(trip_id)
    today_total = conn.execute(q_today, params_today).fetchone()["total"]

    # Today's count
    q_count = "SELECT COUNT(*) as cnt FROM receipts WHERE date = ?"
    params_count = [today]
    if trip_id:
        q_count += " AND trip_id = ?"
        params_count.append(trip_id)
    today_count = conn.execute(q_count, params_count).fetchone()["cnt"]

    # Trip cumulative
    trip_total = 0
    trip_count = 0
    cash_spent = 0
    if trip_id:
        trip_total = conn.execute(
            "SELECT COALESCE(SUM(total_amount), 0) as total FROM receipts WHERE trip_id = ?",
            (trip_id,)
        ).fetchone()["total"]
        trip_count = conn.execute(
            "SELECT COUNT(*) as cnt FROM receipts WHERE trip_id = ?",
            (trip_id,)
        ).fetchone()["cnt"]
        cash_spent = conn.execute(
            "SELECT COALESCE(SUM(total_amount), 0) as total FROM receipts WHERE trip_id = ? AND payment_method = 'cash'",
            (trip_id,)
        ).fetchone()["total"]

    # Recent receipts
    q_recent = "SELECT id, store_name, date, total_amount, currency, payment_method, category, credit_card_name FROM receipts"
    params_recent = []
    if trip_id:
        q_recent += " WHERE trip_id = ?"
        params_recent.append(trip_id)
    q_recent += " ORDER BY date DESC, created_at DESC LIMIT 5"
    recent = conn.execute(q_recent, params_recent).fetchall()

    conn.close()

    return {
        "today_total": today_total,
        "today_count": today_count,
        "trip_total": trip_total,
        "trip_count": trip_count,
        "cash_spent": cash_spent,
        "recent_receipts": [dict(r) for r in recent],
    }


def get_stats_data(trip_id=None):
    conn = get_db()

    where = ""
    params = []
    if trip_id:
        where = "WHERE trip_id = ?"
        params = [trip_id]

    # Daily trend
    daily = conn.execute(
        f"SELECT date, SUM(total_amount) as total, COUNT(*) as count FROM receipts {where} GROUP BY date ORDER BY date",
        params,
    ).fetchall()

    # Category breakdown
    categories = conn.execute(
        f"SELECT category, SUM(total_amount) as total, COUNT(*) as count FROM receipts {where} GROUP BY category ORDER BY total DESC",
        params,
    ).fetchall()

    # Payment method distribution
    payments = conn.execute(
        f"SELECT payment_method, SUM(total_amount) as total, COUNT(*) as count FROM receipts {where} GROUP BY payment_method ORDER BY total DESC",
        params,
    ).fetchall()

    # TOP 10 spending
    top10 = conn.execute(
        f"SELECT store_name, date, total_amount, currency, category FROM receipts {where} ORDER BY total_amount DESC LIMIT 10",
        params,
    ).fetchall()

    conn.close()

    return {
        "daily_trend": [dict(d) for d in daily],
        "categories": [dict(c) for c in categories],
        "payment_methods": [dict(p) for p in payments],
        "top10": [dict(t) for t in top10],
    }
