# AI Sales Analytics Dashboard
Full-stack predictive analytics suite: automated revenue forecasting, churn prediction and RFM segmentation, and interactive KPI tracking across multi-channel sales data.

**Stack:** Python, Pandas, scikit-learn, FastAPI, SQLite, React, Recharts, Vite

## Setup & Run
```bash
# 1. Backend – seed the database (run once)
cd backend
pip install -r requirements.txt
python seed_db.py              # creates sales.db with 2,000 customers / 35k orders

# 2. Start the API
uvicorn main:app --reload      # http://localhost:8000  (docs at /docs)

# 3. Frontend (separate terminal)
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

## Data
- **`sales.db`** — SQLite database (auto-created by `seed_db.py`). Contains two tables:
  - `orders` — 35k rows: `order_id, customer_id, date, channel, product_cat, region, amount, quantity`
  - `customers` — 2k rows: `customer_id, name, email, region, channel, signup_date`
- **`seed_db.py`** — Re-run anytime to wipe and regenerate the database.
- Date range: `2024-01-01` → `2026-09-30`

## Models
- **Forecast:** Ridge (trend + Fourier seasonality + day-of-week) plus gradient-boosted residuals; 30-day holdout WAPE; 95% interval from residual std.
- **Churn:** RandomForest on RFM + tenure with a temporal split (label = no order in last 90 days); reports ROC-AUC.
- **Segments:** KMeans (k=4) on log-scaled RFM, labelled Champions / Growing / At Risk / Lost.
