import os, sqlite3
import pandas as pd

DB_PATH = os.path.join(os.path.dirname(__file__), "sales.db")


def ensure_database():
    """Ensure database exists and is populated."""
    needs_seed = False
    if not os.path.exists(DB_PATH) or os.path.getsize(DB_PATH) == 0:
        needs_seed = True
    else:
        try:
            con = sqlite3.connect(DB_PATH, timeout=5)
            count = con.execute("SELECT count(*) FROM orders").fetchone()[0]
            con.close()
            if count == 0:
                needs_seed = True
        except Exception:
            needs_seed = True

    if needs_seed:
        print("[data] Database missing or uninitialized. Auto-seeding sales.db...")
        try:
            from seed_db import make_data
            customers, orders = make_data()
            con = sqlite3.connect(DB_PATH, timeout=15)
            customers.to_sql("customers", con, if_exists="replace", index=False)
            orders.to_sql("orders", con, if_exists="replace", index=False)
            con.execute("CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_orders_cid  ON orders(customer_id)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_orders_chan  ON orders(channel)")
            con.commit()
            con.close()
            print(f"[data] Successfully auto-seeded {len(orders):,} orders into {DB_PATH}")
        except Exception as e:
            print(f"[data] Warning: Auto-seed failed ({e})")


def load_orders() -> pd.DataFrame:
    """Load orders from sales.db (SQLite)."""
    ensure_database()
    con = sqlite3.connect(DB_PATH, timeout=10)
    orders = pd.read_sql("SELECT * FROM orders", con, parse_dates=["date"])
    con.close()
    print(f"[data] Loaded {len(orders):,} orders from {DB_PATH}")
    return orders

