"""
seed_db.py  -  Run once to create and populate sales.db with realistic data.
Usage:
    python seed_db.py
"""

import sqlite3, os
import numpy as np
import pandas as pd

DB_PATH = os.path.join(os.path.dirname(__file__), "sales.db")

# ── Configuration ─────────────────────────────────────────────────────────────
N_CUSTOMERS = 2000
SEED = 42
START = pd.Timestamp("2024-01-01")
END   = pd.Timestamp("2026-09-30")   # up to last month

CHANNELS = ["Online", "Retail", "Wholesale", "Marketplace"]
CHANNEL_P = [0.40, 0.25, 0.15, 0.20]
SCALE     = {"Online": 1.0, "Retail": 1.3, "Wholesale": 3.0, "Marketplace": 0.8}

PRODUCTS = [
    ("Electronics",  180.0),
    ("Clothing",      55.0),
    ("Home & Garden", 75.0),
    ("Sports",        90.0),
    ("Books",         20.0),
    ("Beauty",        45.0),
]
REGIONS = ["North", "South", "East", "West", "Central"]

FIRST_NAMES = ["Alice","Bob","Carol","David","Eva","Frank","Grace","Hank",
               "Iris","Jake","Karen","Leo","Maya","Nora","Oscar","Pam",
               "Quinn","Ray","Sara","Tom","Uma","Victor","Wendy","Xander",
               "Yara","Zoe"]
LAST_NAMES  = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller",
               "Davis","Wilson","Moore","Taylor","Anderson","Thomas","Jackson",
               "White","Harris","Martin","Thompson","Young","Robinson"]


def make_data(n=N_CUSTOMERS, seed=SEED):
    rng = np.random.default_rng(seed)

    # ── Customers table ───────────────────────────────────────────────────────
    first = rng.choice(FIRST_NAMES, n)
    last  = rng.choice(LAST_NAMES,  n)
    emails = [f"{f.lower()}.{l.lower()}{i}@example.com"
              for i, (f, l) in enumerate(zip(first, last))]
    regions  = rng.choice(REGIONS,   n)
    channels = rng.choice(CHANNELS,  n, p=CHANNEL_P)
    signups  = [START + pd.Timedelta(days=int(d))
                for d in rng.integers(0, (END - START).days - 60, n)]

    customers = pd.DataFrame({
        "customer_id": range(n),
        "name":        [f"{f} {l}" for f, l in zip(first, last)],
        "email":       emails,
        "region":      regions,
        "channel":     channels,
        "signup_date": [s.date() for s in signups],
    })

    # ── Orders table ──────────────────────────────────────────────────────────
    parts = []
    order_id = 0
    for cid in range(n):
        ch     = channels[cid]
        signup = signups[cid]
        # ~30% churn within 90-400 days; the rest stay active
        life = int(rng.integers(90, 400)) if rng.random() < 0.30 else 10_000
        days = pd.date_range(signup, min(signup + pd.Timedelta(days=life), END))
        if len(days) == 0:
            continue
        # purchase probability varies with seasonality
        p = rng.uniform(0.01, 0.07) * (
            1 + 0.35 * np.sin(2 * np.pi * days.dayofyear / 365)
        )
        purchase_days = days[rng.random(len(days)) < p]
        if len(purchase_days) == 0:
            continue
        n_orders = len(purchase_days)
        prod_names = [p[0] for p in PRODUCTS]
        prods    = rng.choice(prod_names, n_orders)
        amounts  = rng.gamma(2, [dict(PRODUCTS)[p] * SCALE[ch] for p in prods]).round(2)
        parts.append(pd.DataFrame({
            "order_id":    range(order_id, order_id + n_orders),
            "customer_id": cid,
            "date":        [d.strftime("%Y-%m-%d") for d in purchase_days],
            "channel":     ch,
            "product_cat": prods,
            "region":      regions[cid],
            "amount":      amounts,
            "quantity":    rng.integers(1, 5, n_orders),
        }))
        order_id += n_orders

    orders = pd.concat(parts, ignore_index=True)
    orders["order_id"] = range(len(orders))   # re-index cleanly
    return customers, orders


def seed(db_path=DB_PATH):
    if os.path.exists(db_path):
        print(f"Warning: Database already exists at {db_path}")
        ans = input("   Re-seed? This will DROP existing data. [y/N] ").strip().lower()
        if ans != "y":
            print("Aborted.")
            return

    print("Generating data ...")
    customers, orders = make_data()
    print(f"   {len(customers):,} customers  |  {len(orders):,} orders")

    con = sqlite3.connect(db_path)
    customers.to_sql("customers", con, if_exists="replace", index=False)
    orders.to_sql("orders",    con, if_exists="replace", index=False)

    # basic indexes for fast queries
    con.execute("CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_orders_cid  ON orders(customer_id)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_orders_chan  ON orders(channel)")
    con.commit()
    con.close()

    size_mb = os.path.getsize(db_path) / 1_048_576
    print(f"Done: Saved {db_path}  ({size_mb:.1f} MB)")
    print(f"   Date range: {orders['date'].min()}  to  {orders['date'].max()}")
    print(f"   Channels:   {dict(orders.groupby('channel').size())}")
    print(f"   Categories: {dict(orders.groupby('product_cat').size())}")


if __name__ == "__main__":
    seed()
