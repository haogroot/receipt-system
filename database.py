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
            credit_cards TEXT DEFAULT '',
            payment_methods TEXT,
            companions TEXT,
            cc_budgets TEXT
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
            credit_card_name TEXT DEFAULT '',
            paid_by TEXT DEFAULT '豪'
        );

        CREATE TABLE IF NOT EXISTS receipt_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            receipt_id INTEGER REFERENCES receipts(id) ON DELETE CASCADE,
            name TEXT,
            quantity INTEGER DEFAULT 1,
            unit_price REAL,
            amount REAL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    """)

    # Alter tables to add new columns if they don't exist yet (for existing dbs)
    try:
        cursor.execute("ALTER TABLE trips ADD COLUMN credit_cards TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE trips ADD COLUMN payment_methods TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE trips ADD COLUMN companions TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE trips ADD COLUMN cc_budgets TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE receipts ADD COLUMN credit_card_name TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE receipts ADD COLUMN paid_by TEXT DEFAULT '豪'")
    except sqlite3.OperationalError:
        pass

    import json
    default_pm = json.dumps([
        {"id": "credit_card", "label": "💳 信用卡"},
        {"id": "ic_card", "label": "🚃 交通卡"},
        {"id": "cash", "label": "💴 現金"}
    ], ensure_ascii=False)
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('payment_methods', ?)", (default_pm,))

    default_companions = json.dumps(["豪", "卿"], ensure_ascii=False)
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('companions', ?)", (default_companions,))

    # Initialize cc_budgets if not exists, migrate from trips.credit_cards if available
    existing_cc_budgets = cursor.execute("SELECT value FROM settings WHERE key = 'cc_budgets'").fetchone()
    if not existing_cc_budgets:
        cc_budgets = {}
        # Try to migrate from active trip's credit_cards field
        active_trip = cursor.execute("SELECT credit_cards FROM trips WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1").fetchone()
        if active_trip and active_trip[0]:
            # Get first companion as default owner
            companions_row = cursor.execute("SELECT value FROM settings WHERE key = 'companions'").fetchone()
            first_companion = "豪"
            if companions_row:
                try:
                    companions_list = json.loads(companions_row[0])
                    if companions_list:
                        first_companion = companions_list[0]
                except (ValueError, IndexError):
                    pass
            cc_budgets[first_companion] = active_trip[0]
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('cc_budgets', ?)",
                       (json.dumps(cc_budgets, ensure_ascii=False),))

    # Migrate '管理員' to '豪' and update companions if needed
    cursor.execute("UPDATE receipts SET paid_by = '豪' WHERE paid_by = '管理員'")
    
    existing_comps = cursor.execute("SELECT value FROM settings WHERE key = 'companions'").fetchone()
    if existing_comps:
        try:
            comps = json.loads(existing_comps[0])
            if "管理員" in comps:
                # Replace "管理員" with "豪" and "卿" if they are the only companions
                new_comps = ["豪", "卿"] if comps == ["管理員"] else [c if c != "管理員" else "豪" for c in comps]
                if "卿" not in new_comps:
                    new_comps.append("卿")
                cursor.execute("UPDATE settings SET value = ? WHERE key = 'companions'", (json.dumps(new_comps, ensure_ascii=False),))
        except (ValueError, TypeError):
            pass

    # Migrate cc_budgets
    existing_cc_budgets_val = cursor.execute("SELECT value FROM settings WHERE key = 'cc_budgets'").fetchone()
    if existing_cc_budgets_val:
        try:
            cc = json.loads(existing_cc_budgets_val[0])
            if "管理員" in cc:
                cc["豪"] = cc.pop("管理員")
                cursor.execute("UPDATE settings SET value = ? WHERE key = 'cc_budgets'", (json.dumps(cc, ensure_ascii=False),))
        except (ValueError, TypeError):
            pass

    # Hydrate old trips with current global settings if they are newly added and NULL
    cursor.execute("SELECT value FROM settings WHERE key = 'payment_methods'")
    pm_row = cursor.fetchone()
    if pm_row:
        cursor.execute("UPDATE trips SET payment_methods = ? WHERE payment_methods IS NULL", (pm_row[0],))
        
    cursor.execute("SELECT value FROM settings WHERE key = 'companions'")
    comp_row = cursor.fetchone()
    if comp_row:
        cursor.execute("UPDATE trips SET companions = ? WHERE companions IS NULL", (comp_row[0],))

    cursor.execute("SELECT value FROM settings WHERE key = 'cc_budgets'")
    cc_row = cursor.fetchone()
    if cc_row:
        cursor.execute("UPDATE trips SET cc_budgets = ? WHERE cc_budgets IS NULL", (cc_row[0],))

    conn.commit()
    conn.close()


# ─── Settings Operations ───

def get_setting(key, default=None):
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    if row:
        try:
            return json.loads(row["value"])
        except ValueError:
            return row["value"]
    return default


def update_setting(key, value):
    conn = get_db()
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False)
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value)
    )
    conn.commit()
    conn.close()
    return True


# ─── Trip Operations ───

def create_trip(name, start_date=None, end_date=None, budget_cash=0, currency="JPY", credit_cards="", payment_methods=None, companions=None, cc_budgets=None):
    conn = get_db()
    cursor = conn.cursor()
    
    if payment_methods is None:
        pm_val = cursor.execute("SELECT value FROM settings WHERE key = 'payment_methods'").fetchone()
        payment_methods = pm_val["value"] if pm_val else json.dumps([])
    elif not isinstance(payment_methods, str):
        payment_methods = json.dumps(payment_methods, ensure_ascii=False)
        
    if companions is None:
        c_val = cursor.execute("SELECT value FROM settings WHERE key = 'companions'").fetchone()
        companions = c_val["value"] if c_val else json.dumps([])
    elif not isinstance(companions, str):
        companions = json.dumps(companions, ensure_ascii=False)
        
    if cc_budgets is None:
        cc_val = cursor.execute("SELECT value FROM settings WHERE key = 'cc_budgets'").fetchone()
        cc_budgets = cc_val["value"] if cc_val else json.dumps({})
    elif not isinstance(cc_budgets, str):
        cc_budgets = json.dumps(cc_budgets, ensure_ascii=False)

    cursor.execute(
        "INSERT INTO trips (name, start_date, end_date, budget_cash, currency, credit_cards, payment_methods, companions, cc_budgets) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (name, start_date, end_date, budget_cash, currency, credit_cards, payment_methods, companions, cc_budgets),
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
    allowed = ["name", "start_date", "end_date", "budget_cash", "currency", "is_active", "credit_cards", "payment_methods", "companions", "cc_budgets"]
    fields = {}
    for k, v in kwargs.items():
        if k in allowed:
            if k in ["payment_methods", "companions", "cc_budgets"] and not isinstance(v, str):
                fields[k] = json.dumps(v, ensure_ascii=False)
            else:
                fields[k] = v
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
                   category, image_path, raw_json, items, note="", credit_card_name="", paid_by="豪"):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO receipts
           (trip_id, store_name, date, total_amount, currency, payment_method, category, image_path, raw_json, note, credit_card_name, paid_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (trip_id, store_name, date, total_amount, currency, payment_method,
         category, image_path, json.dumps(raw_json, ensure_ascii=False), note, credit_card_name, paid_by),
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
    allowed = ["store_name", "date", "total_amount", "currency", "payment_method", "category", "note", "trip_id", "credit_card_name", "paid_by"]
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
    cc_spent = []
    cc_spent_by_payer = {}
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

        cc_spent_raw = conn.execute(
            "SELECT credit_card_name, COALESCE(SUM(total_amount), 0) as total FROM receipts WHERE trip_id = ? AND payment_method = 'credit_card' AND credit_card_name != '' GROUP BY credit_card_name ORDER BY total DESC",
            (trip_id,)
        ).fetchall()
        cc_spent = [dict(r) for r in cc_spent_raw]

        # Credit card spending grouped by payer
        cc_by_payer_raw = conn.execute(
            "SELECT paid_by, credit_card_name, COALESCE(SUM(total_amount), 0) as total FROM receipts WHERE trip_id = ? AND payment_method = 'credit_card' AND credit_card_name != '' GROUP BY paid_by, credit_card_name ORDER BY paid_by, total DESC",
            (trip_id,)
        ).fetchall()
        for row in cc_by_payer_raw:
            r = dict(row)
            payer = r["paid_by"] or "管理員"
            if payer not in cc_spent_by_payer:
                cc_spent_by_payer[payer] = []
            cc_spent_by_payer[payer].append({"credit_card_name": r["credit_card_name"], "total": r["total"]})

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
        "cc_spent": cc_spent,
        "cc_spent_by_payer": cc_spent_by_payer,
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

    # Payers
    payers = conn.execute(
        f"SELECT paid_by, SUM(total_amount) as total FROM receipts {where} GROUP BY paid_by ORDER BY total DESC",
        params,
    ).fetchall()

    conn.close()

    return {
        "daily_trend": [dict(d) for d in daily],
        "categories": [dict(c) for c in categories],
        "payment_methods": [dict(p) for p in payments],
        "top10": [dict(t) for t in top10],
        "payers": [dict(p) for p in payers],
    }
