import sys
from pathlib import Path

# Ensure backend directory is in Python path regardless of execution directory
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from contextlib import asynccontextmanager
import os, sqlite3
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from data import load_orders, DB_PATH
import ml

STATE = {}

def get_orders():
    if "orders" not in STATE or STATE["orders"] is None or STATE["orders"].empty:
        STATE["orders"] = load_orders()
    return STATE["orders"]

def get_forecast():
    if "forecast" not in STATE or STATE["forecast"] is None:
        STATE["forecast"] = ml.forecast(get_orders())
    return STATE["forecast"]

def get_churn():
    if "churn" not in STATE or STATE["churn"] is None:
        STATE["churn"] = ml.churn_and_segments(get_orders())
    return STATE["churn"]

@asynccontextmanager
async def lifespan(app):
    STATE["orders"] = load_orders()
    STATE["forecast"] = ml.forecast(STATE["orders"])
    STATE["churn"] = ml.churn_and_segments(STATE["orders"])
    yield

app = FastAPI(title="AI Sales Analytics API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/")
def root():
    return {
        "status": "online",
        "service": "AI Sales Analytics API",
        "docs": "/docs",
        "endpoints": [
            "/api/kpis",
            "/api/forecast",
            "/api/channels",
            "/api/churn",
            "/api/categories",
            "/api/regions",
            "/api/recent-orders",
            "/api/health",
        ],
    }

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "ready": "orders" in STATE and STATE["orders"] is not None and not STATE["orders"].empty,
    }

@app.get("/api/kpis")
def kpis():
    o = get_orders()
    end = o.date.max()
    cur = o[o.date > end - pd.Timedelta(days=30)]
    prev = o[(o.date <= end - pd.Timedelta(days=30)) & (o.date > end - pd.Timedelta(days=60))]

    cur_rev = cur.amount.sum()
    prev_rev = prev.amount.sum()
    cur_orders = len(cur)
    prev_orders = len(prev)
    cur_aov = cur.amount.mean()
    prev_aov = prev.amount.mean()
    cur_cust = int(cur.customer_id.nunique())
    prev_cust = int(prev.customer_id.nunique())

    # 14-day daily sparkline points
    last14 = o[o.date > end - pd.Timedelta(days=14)].copy()
    last14["day"] = last14.date.dt.strftime("%m-%d")
    daily = last14.groupby("day").agg(
        rev=("amount", "sum"),
        ords=("order_id", "count"),
        aov=("amount", "mean"),
        cust=("customer_id", "nunique"),
    ).round(1).reset_index()

    return {
        "revenue_30d": round(cur_rev, 2),
        "growth_pct": round(((cur_rev / prev_rev) - 1) * 100, 1) if prev_rev else 0,
        "orders_30d": cur_orders,
        "aov": round(cur_aov, 2) if pd.notna(cur_aov) else 0.0,
        "active_customers": cur_cust,
        "changes": {
            "revenue": round(((cur_rev / prev_rev) - 1) * 100, 1) if prev_rev else 0,
            "growth": round(((cur_rev / prev_rev) - 1) * 100, 1) if prev_rev else 0,
            "orders": round(((cur_orders / prev_orders) - 1) * 100, 1) if prev_orders else 0,
            "aov": round(((cur_aov / prev_aov) - 1) * 100, 1) if (prev_aov and pd.notna(cur_aov) and pd.notna(prev_aov)) else 0,
            "customers": round(((cur_cust / prev_cust) - 1) * 100, 1) if prev_cust else 0,
        },
        "sparklines": {
            "revenue_30d": daily["rev"].tolist(),
            "growth_pct": daily["rev"].tolist(),
            "orders_30d": daily["ords"].tolist(),
            "aov": daily["aov"].tolist(),
            "active_customers": daily["cust"].tolist(),
        }
    }

@app.get("/api/regions")
def regions():
    o = get_orders()
    o = o[o.date > o.date.max() - pd.Timedelta(days=90)]
    return o.groupby("region").agg(
        revenue=("amount", "sum"),
        orders=("amount", "size"),
        customers=("customer_id", "nunique"),
    ).round(2).reset_index().sort_values("revenue", ascending=False).to_dict("records")

@app.get("/api/channels")
def channels():
    o = get_orders()
    o = o[o.date > o.date.max() - pd.Timedelta(days=90)]
    return o.groupby("channel").agg(
        revenue=("amount", "sum"),
        orders=("amount", "size")
    ).round(2).reset_index().to_dict("records")

@app.get("/api/categories")
def categories():
    o = get_orders()
    end = o.date.max()
    last90 = o[o.date > end - pd.Timedelta(days=90)]
    total = last90.amount.sum()
    cat = last90.groupby("product_cat").agg(
        revenue=("amount", "sum"),
        orders=("order_id", "count")
    ).round(2).reset_index().sort_values("revenue", ascending=False)
    cat["share"] = ((cat["revenue"] / total) * 100).round(1)
    return cat.to_dict("records")

@app.get("/api/recent-orders")
def recent_orders():
    con = sqlite3.connect(DB_PATH, timeout=10)
    q = """
    SELECT o.order_id, o.date, o.product_cat, o.channel, o.region, o.amount, o.quantity, c.name, c.email
    FROM orders o
    JOIN customers c ON o.customer_id = c.customer_id
    ORDER BY o.date DESC, o.order_id DESC
    LIMIT 10
    """
    df = pd.read_sql(q, con)
    con.close()
    return df.to_dict("records")

@app.get("/api/forecast")
def forecast():
    return get_forecast()

@app.get("/api/churn")
def churn():
    return get_churn()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)

