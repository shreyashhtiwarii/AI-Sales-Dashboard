import numpy as np, pandas as pd
from sklearn.linear_model import Ridge
from sklearn.ensemble import GradientBoostingRegressor, RandomForestClassifier
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score

def _features(idx, t0):
    X = pd.DataFrame({"t": np.arange(len(idx)) + t0}, index=idx)
    for k in (1, 2):
        ang = 2 * np.pi * k * idx.dayofyear / 365.25
        X[f"s{k}"], X[f"c{k}"] = np.sin(ang), np.cos(ang)
    for i in range(7):
        X[f"d{i}"] = (idx.dayofweek == i).astype(float)
    return X

def _fit_predict(train, horizon):
    """Ridge (trend + seasonality) with gradient boosting on its residuals."""
    X = _features(train.index, 0)
    lin = Ridge(alpha=1.0).fit(X, train.values)
    resid = train.values - lin.predict(X)
    gb = GradientBoostingRegressor(n_estimators=150, max_depth=3, random_state=0).fit(X, resid)
    fidx = pd.date_range(train.index[-1] + pd.Timedelta(days=1), periods=horizon)
    Xf = _features(fidx, len(train))
    return fidx, np.clip(lin.predict(Xf) + gb.predict(Xf), 0, None), float(np.std(resid))

def forecast(orders, horizon=30):
    s = orders.groupby("date").amount.sum().asfreq("D", fill_value=0)
    _, p, _ = _fit_predict(s[:-horizon], horizon)  # backtest on last 30 days
    wape = float(np.abs(s[-horizon:].values - p).sum() / s[-horizon:].sum())
    idx, pred, sd = _fit_predict(s, horizon)
    return {
        "wape": round(wape, 3),
        "history": [{"date": d.strftime("%Y-%m-%d"), "revenue": round(v, 2)} for d, v in s[-90:].items()],
        "forecast": [{"date": d.strftime("%Y-%m-%d"), "revenue": round(v, 2),
                      "lower": round(max(v - 1.96 * sd, 0), 2), "upper": round(v + 1.96 * sd, 2)}
                     for d, v in zip(idx, pred)],
    }

def _rfm(orders, asof):
    g = orders[orders.date <= asof].groupby("customer_id")
    return pd.DataFrame({"recency": (asof - g.date.max()).dt.days, "frequency": g.size(),
                         "monetary": g.amount.sum(), "tenure": (asof - g.date.min()).dt.days})

def churn_and_segments(orders, window=90):
    end = orders.date.max()
    cut = end - pd.Timedelta(days=window)
    Xtr = _rfm(orders, cut)
    active = orders[orders.date > cut].customer_id.unique()
    y = (~Xtr.index.isin(active)).astype(int)  # churned = no order in last 90 days
    Xa, Xb, ya, yb = train_test_split(Xtr, y, test_size=.25, random_state=0, stratify=y)
    rf = RandomForestClassifier(300, max_depth=6, random_state=0).fit(Xa, ya)
    auc = float(roc_auc_score(yb, rf.predict_proba(Xb)[:, 1]))

    now = _rfm(orders, end)
    now["churn_prob"] = rf.predict_proba(now[Xtr.columns])[:, 1]
    Z = StandardScaler().fit_transform(np.log1p(now[["recency", "frequency", "monetary"]]))
    now["cluster"] = KMeans(4, n_init=10, random_state=0).fit_predict(Z)

    s = now.groupby("cluster").agg(m=("monetary", "mean"), c=("churn_prob", "mean"))
    names, left = {}, set(s.index)
    for label, col in [("Champions", "m"), ("Lost", "c"), ("At Risk", "c"), ("Growing", "m")]:
        pick = s.loc[list(left)].sort_values(col, ascending=False).index[0]
        names[pick] = label; left.discard(pick)
    now["segment"] = now.cluster.map(names)
    seg = now.groupby("segment").agg(customers=("monetary", "size"), revenue=("monetary", "sum"),
                                     avg_churn=("churn_prob", "mean")).round(2)
    return {"auc": round(auc, 3), "segments": seg.reset_index().to_dict("records"),
            "top_at_risk": now.nlargest(10, "churn_prob").reset_index()
                [["customer_id", "monetary", "recency", "churn_prob"]].round(2).to_dict("records")}
