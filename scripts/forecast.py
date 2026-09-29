"""
TimesFM-3 forecast script.

For each store:
  1. Read aggregated daily item sales from SQLite
  2. Hold back the last 30 days as ground truth
  3. Feed remaining history to TimesFM-3 as context
  4. Forecast 30 days with quantiles
  5. Compare forecast vs actuals → MAPE, WAPE, MAE, RMSE
  6. Write forecasts + accuracy back to SQLite
"""

import sqlite3
import uuid
import json
import datetime
import sys
from pathlib import Path

import numpy as np

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "forecast.db"
HORIZON = 30
MODEL_NAME = "timesfm-3"


def get_store_daily_totals(conn: sqlite3.Connection, store_id: str):
    """Aggregate daily item sales across all SKUs for one store."""
    rows = conn.execute(
        """
        SELECT date, SUM(units_sold) AS total_units
        FROM daily_item_sales
        WHERE store_id = ?
        GROUP BY date
        ORDER BY date
        """,
        (store_id,),
    ).fetchall()
    dates = [r[0] for r in rows]
    values = np.array([r[1] for r in rows], dtype=np.float32)
    return dates, values


def compute_metrics(actual: np.ndarray, forecast: np.ndarray):
    """Compute MAE, MAPE, WAPE, RMSE."""
    errors = actual - forecast
    abs_errors = np.abs(errors)
    mae = float(np.mean(abs_errors))
    mape = float(np.mean(abs_errors / np.maximum(actual, 1)) * 100)
    wape = float(np.sum(abs_errors) / np.sum(np.maximum(actual, 1)) * 100)
    rmse = float(np.sqrt(np.mean(errors ** 2)))
    return {"mae": mae, "mape": mape, "wape": wape, "rmse": rmse}


def create_forecast_tables(conn: sqlite3.Connection):
    """Create forecast tables if they don't exist."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS forecast_runs (
            id         TEXT PRIMARY KEY,
            model      TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            config     TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS forecasts (
            run_id     TEXT NOT NULL REFERENCES forecast_runs(id),
            store_id   TEXT NOT NULL REFERENCES stores(id),
            date       TEXT NOT NULL,
            forecast   REAL NOT NULL,
            q10        REAL,
            q20        REAL,
            q30        REAL,
            q40        REAL,
            q50        REAL,
            q60        REAL,
            q70        REAL,
            q80        REAL,
            q90        REAL,
            PRIMARY KEY (run_id, store_id, date)
        );

        CREATE TABLE IF NOT EXISTS forecast_accuracy (
            run_id       TEXT NOT NULL REFERENCES forecast_runs(id),
            store_id     TEXT NOT NULL REFERENCES stores(id),
            horizon_days INTEGER NOT NULL,
            mae          REAL NOT NULL,
            mape         REAL NOT NULL,
            wape         REAL NOT NULL,
            rmse         REAL NOT NULL,
            PRIMARY KEY (run_id, store_id)
        );

        CREATE INDEX IF NOT EXISTS idx_forecasts_store_date
            ON forecasts(store_id, date);
    """)


def main():
    print("Loading TimesFM-3 model...")
    import timesfm

    model = timesfm.TimesFM3Forecaster.from_pretrained(
        "google/timesfm-3.0-pytorch",
        device="cpu",
    )
    print("Model loaded.\n")

    conn = sqlite3.connect(str(DB_PATH))
    create_forecast_tables(conn)

    stores = [r[0] for r in conn.execute("SELECT id FROM stores ORDER BY id").fetchall()]
    print(f"Found {len(stores)} stores: {stores}\n")

    run_id = f"run-{uuid.uuid4().hex[:8]}"
    config = {"horizon": HORIZON, "model": MODEL_NAME, "holdback": HORIZON}
    conn.execute(
        "INSERT INTO forecast_runs (id, model, config) VALUES (?, ?, ?)",
        (run_id, MODEL_NAME, json.dumps(config)),
    )
    conn.commit()

    for store_id in stores:
        dates, values = get_store_daily_totals(conn, store_id)
        total_days = len(dates)
        print(f"--- {store_id}: {total_days} days of history ({dates[0]} to {dates[-1]})")

        if total_days < HORIZON + 7:
            print(f"    SKIP: not enough history (need at least {HORIZON + 7} days)")
            continue

        context = values[:-HORIZON]
        actual_holdback = values[-HORIZON:]
        holdback_dates = dates[-HORIZON:]

        print(f"    Context: {len(context)} days | Holdback: {HORIZON} days")
        print(f"    Context range: {dates[0]} → {dates[-HORIZON - 1]}")
        print(f"    Holdback range: {holdback_dates[0]} → {holdback_dates[-1]}")

        results = list(model.predict_batch(
            contexts=[context],
            horizon=HORIZON,
            return_quantiles=True,
            make_positive=True,
        ))
        result = results[0]

        point_forecast = result.forecast   # shape (HORIZON,)
        quantile_forecast = result.quantiles  # shape (HORIZON, 9)

        metrics = compute_metrics(actual_holdback, point_forecast)
        print(f"    MAE:  {metrics['mae']:.1f} units")
        print(f"    MAPE: {metrics['mape']:.1f}%")
        print(f"    WAPE: {metrics['wape']:.1f}%")
        print(f"    RMSE: {metrics['rmse']:.1f} units")

        for i in range(HORIZON):
            conn.execute(
                """INSERT INTO forecasts
                   (run_id, store_id, date, forecast, q10, q20, q30, q40, q50, q60, q70, q80, q90)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    run_id,
                    store_id,
                    holdback_dates[i],
                    float(point_forecast[i]),
                    float(quantile_forecast[i, 0]),
                    float(quantile_forecast[i, 1]),
                    float(quantile_forecast[i, 2]),
                    float(quantile_forecast[i, 3]),
                    float(quantile_forecast[i, 4]),
                    float(quantile_forecast[i, 5]),
                    float(quantile_forecast[i, 6]),
                    float(quantile_forecast[i, 7]),
                    float(quantile_forecast[i, 8]),
                ),
            )

        conn.execute(
            """INSERT INTO forecast_accuracy
               (run_id, store_id, horizon_days, mae, mape, wape, rmse)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (run_id, store_id, HORIZON, metrics["mae"], metrics["mape"], metrics["wape"], metrics["rmse"]),
        )
        conn.commit()

        print(f"    Actual vs Forecast (first 5 days):")
        for j in range(min(5, HORIZON)):
            a = actual_holdback[j]
            f = point_forecast[j]
            lo = quantile_forecast[j, 0]
            hi = quantile_forecast[j, 8]
            print(f"      {holdback_dates[j]}: actual={a:.0f}  forecast={f:.0f}  [{lo:.0f} - {hi:.0f}]")
        print()

    conn.close()
    print(f"Done. Run ID: {run_id}")
    print(f"Results written to {DB_PATH}")


if __name__ == "__main__":
    main()
