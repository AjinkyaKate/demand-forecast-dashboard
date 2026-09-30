export const SCHEMA_SQL = `
-- Reference: stores
CREATE TABLE IF NOT EXISTS stores (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  format        TEXT NOT NULL CHECK (format IN ('Highway','Urban','Suburban','Rural')),
  traffic       REAL NOT NULL DEFAULT 1.0,
  fuel_skew     REAL NOT NULL DEFAULT 1.0,
  history_start TEXT NOT NULL,
  latitude      REAL,
  longitude     REAL,
  timezone      TEXT NOT NULL DEFAULT 'America/New_York',
  region        TEXT,
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

-- Promotion plan per SKU (chain-wide). Planned ahead, so it extends past the
-- last sales day and gives the forecast window known promo days.
CREATE TABLE IF NOT EXISTS promotions (
  sku_id     TEXT NOT NULL REFERENCES skus(id),
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  discount   REAL NOT NULL,
  PRIMARY KEY (sku_id, start_date)
);

-- Latest counted on-hand inventory per store and SKU.
CREATE TABLE IF NOT EXISTS inventory_on_hand (
  store_id   TEXT NOT NULL REFERENCES stores(id),
  sku_id     TEXT NOT NULL REFERENCES skus(id),
  counted_on TEXT NOT NULL,
  units      INTEGER NOT NULL,
  PRIMARY KEY (store_id, sku_id)
);

-- Latest tank gauge reading per store and fuel grade.
CREATE TABLE IF NOT EXISTS tank_levels (
  store_id  TEXT NOT NULL REFERENCES stores(id),
  grade_id  TEXT NOT NULL REFERENCES fuel_grades(id),
  read_on   TEXT NOT NULL,
  gallons   INTEGER NOT NULL,
  PRIMARY KEY (store_id, grade_id)
);

-- Daily weather at each store's own location (Open-Meteo). temp_anomaly is
-- the departure from that location's 10-year normal for the day of year.
CREATE TABLE IF NOT EXISTS store_weather (
  store_id     TEXT NOT NULL REFERENCES stores(id),
  date         TEXT NOT NULL,
  temp_f       REAL NOT NULL,
  temp_anomaly REAL NOT NULL,
  precip_mm    REAL NOT NULL DEFAULT 0,
  kind         TEXT NOT NULL CHECK (kind IN ('observed','forecast')),
  source       TEXT NOT NULL DEFAULT 'open-meteo',
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, date)
);

-- Climate normals per store and day of year, from 10 years of Open-Meteo history.
CREATE TABLE IF NOT EXISTS store_weather_normals (
  store_id  TEXT NOT NULL REFERENCES stores(id),
  doy       INTEGER NOT NULL,
  temp_f    REAL NOT NULL,
  precip_mm REAL NOT NULL,
  years     TEXT NOT NULL,
  PRIMARY KEY (store_id, doy)
);

-- Public holidays (Nager.Date), national and state-level.
CREATE TABLE IF NOT EXISTS holidays (
  date    TEXT NOT NULL,
  name    TEXT NOT NULL,
  region  TEXT NOT NULL DEFAULT 'US',
  kind    TEXT NOT NULL DEFAULT 'public',
  source  TEXT NOT NULL DEFAULT 'nager-date',
  PRIMARY KEY (date, name, region)
);

-- Events near each store (PredictHQ).
CREATE TABLE IF NOT EXISTS external_events (
  source      TEXT NOT NULL DEFAULT 'predicthq',
  id          TEXT NOT NULL,
  store_id    TEXT NOT NULL REFERENCES stores(id),
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  attendance  INTEGER,
  rank        INTEGER,
  local_rank  INTEGER,
  distance_km REAL,
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, id, store_id)
);
CREATE INDEX IF NOT EXISTS idx_ext_events_store_dates ON external_events(store_id, start_date, end_date);

-- Indexes for fast time-range queries
CREATE INDEX IF NOT EXISTS idx_item_sales_store_date ON daily_item_sales(store_id, date);
CREATE INDEX IF NOT EXISTS idx_item_sales_sku_date   ON daily_item_sales(sku_id, date);
CREATE INDEX IF NOT EXISTS idx_fuel_sales_store_date ON daily_fuel_sales(store_id, date);
CREATE INDEX IF NOT EXISTS idx_events_dates          ON events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_forecasts_store_date  ON forecasts(store_id, date);
CREATE INDEX IF NOT EXISTS idx_promotions_dates      ON promotions(start_date, end_date);
`;
