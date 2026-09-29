export const SCHEMA_SQL = `
-- Reference: stores
CREATE TABLE IF NOT EXISTS stores (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  format        TEXT NOT NULL CHECK (format IN ('Highway','Urban','Suburban','Rural')),
  traffic       REAL NOT NULL DEFAULT 1.0,
  fuel_skew     REAL NOT NULL DEFAULT 1.0,
  history_start TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reference: categories
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  short_name TEXT NOT NULL
);

-- Reference: SKUs
CREATE TABLE IF NOT EXISTS skus (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category_id     TEXT NOT NULL REFERENCES categories(id),
  unit_cost       REAL NOT NULL,
  unit_price      REAL NOT NULL,
  case_size       INTEGER NOT NULL,
  lead_time_days  INTEGER NOT NULL,
  shelf_life_days INTEGER
);

-- Reference: fuel grades
CREATE TABLE IF NOT EXISTS fuel_grades (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  short_name        TEXT NOT NULL,
  octane            TEXT NOT NULL,
  tank_gallons      INTEGER NOT NULL,
  reserve_fraction  REAL NOT NULL,
  margin_per_gallon REAL NOT NULL,
  price_elasticity  REAL NOT NULL
);

-- Daily item sales (the big table)
CREATE TABLE IF NOT EXISTS daily_item_sales (
  store_id    TEXT NOT NULL REFERENCES stores(id),
  sku_id      TEXT NOT NULL REFERENCES skus(id),
  date        TEXT NOT NULL,
  units_sold  INTEGER NOT NULL,
  on_promo    INTEGER NOT NULL DEFAULT 0,
  discount    REAL NOT NULL DEFAULT 0,
  price_index REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (store_id, sku_id, date)
);

-- Daily fuel sales
CREATE TABLE IF NOT EXISTS daily_fuel_sales (
  store_id     TEXT NOT NULL REFERENCES stores(id),
  grade_id     TEXT NOT NULL REFERENCES fuel_grades(id),
  date         TEXT NOT NULL,
  gallons_sold INTEGER NOT NULL,
  street_price REAL NOT NULL,
  price_index  REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (store_id, grade_id, date)
);

-- Daily weather (shared across stores — same region)
CREATE TABLE IF NOT EXISTS daily_weather (
  date         TEXT PRIMARY KEY,
  temp_f       REAL NOT NULL,
  temp_anomaly REAL NOT NULL,
  holiday      TEXT,
  holiday_weight REAL NOT NULL DEFAULT 0
);

-- Operational events
CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('weather','traffic','equipment','supply','competition','local')),
  scope      TEXT NOT NULL DEFAULT 'all',
  effect     REAL NOT NULL DEFAULT 1.0,
  note       TEXT NOT NULL DEFAULT ''
);

-- Forecast runs metadata
CREATE TABLE IF NOT EXISTS forecast_runs (
  id         TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  config     TEXT NOT NULL DEFAULT '{}'
);

-- Forecasted daily totals per store
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

-- Accuracy metrics per store per run
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

-- External data sync log
CREATE TABLE IF NOT EXISTS external_sync_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL,
  synced_at  TEXT NOT NULL DEFAULT (datetime('now')),
  rows       INTEGER NOT NULL DEFAULT 0,
  date_from  TEXT,
  date_to    TEXT,
  status     TEXT NOT NULL DEFAULT 'ok',
  error      TEXT
);

-- Indexes for fast time-range queries
CREATE INDEX IF NOT EXISTS idx_item_sales_store_date ON daily_item_sales(store_id, date);
CREATE INDEX IF NOT EXISTS idx_item_sales_sku_date   ON daily_item_sales(sku_id, date);
CREATE INDEX IF NOT EXISTS idx_fuel_sales_store_date ON daily_fuel_sales(store_id, date);
CREATE INDEX IF NOT EXISTS idx_events_dates          ON events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_forecasts_store_date  ON forecasts(store_id, date);
`;
