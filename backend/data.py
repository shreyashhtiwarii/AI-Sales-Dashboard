import os, sqlite3
import pandas as pd

DB_PATH = os.path.join(os.path.dirname(__file__), "sales.db")


def load_orders() -> pd.DataFrame:
    """Load orders from sales.db (SQLite)."""
    con = sqlite3.connect(DB_PATH)
    orders = pd.read_sql("SELECT * FROM orders", con, parse_dates=["date"])
    con.close()
    print(f"[data] Loaded {len(orders):,} orders from {DB_PATH}")
    return orders
