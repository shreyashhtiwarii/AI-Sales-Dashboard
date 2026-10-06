from contextlib import asynccontextmanager
import os, sqlite3
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from data import load_orders, DB_PATH
import ml

STATE = {}

@asynccontextmanager
async def lifespan(app):
    STATE["orders"] = load_orders()
    STATE["forecast"] = ml.forecast(STATE["orders"])
    STATE["churn"] = ml.churn_and_segments(STATE["orders"])
    yield

app = FastAPI(title="AI Sales Analytics API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/api/kpis")
def kpis():
    o = STATE["orders"]
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
        "aov": round(cur_aov, 2),
        "active_customers": cur_cust,
        "changes": {
            "revenue": round(((cur_rev / prev_rev) - 1) * 100, 1) if prev_rev else 0,
            "growth": round(((cur_rev / prev_rev) - 1) * 100, 1) if prev_rev else 0,
            "orders": round(((cur_orders / prev_orders) - 1) * 100, 1) if prev_orders else 0,
            "aov": round(((cur_aov / prev_aov) - 1) * 100, 1) if prev_aov else 0,
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
    o = STATE["orders"]
    o = o[o.date > o.date.max() - pd.Timedelta(days=90)]
    return o.groupby("region").agg(
        revenue=("amount", "sum"),
        orders=("amount", "size"),
        customers=("customer_id", "nunique"),
    ).round(2).reset_index().sort_values("revenue", ascending=False).to_dict("records")

@app.get("/api/channels")
def channels():
    o = STATE["orders"]
    o = o[o.date > o.date.max() - pd.Timedelta(days=90)]
    return o.groupby("channel").agg(
        revenue=("amount", "sum"),
        orders=("amount", "size")
    ).round(2).reset_index().to_dict("records")

@app.get("/api/categories")
def categories():
    o = STATE["orders"]
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
    con = sqlite3.connect(DB_PATH)
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
    return STATE["forecast"]

@app.get("/api/churn")
def churn():
    return STATE["churn"]

