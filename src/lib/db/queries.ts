import { getDb } from "./index";

export function queryStores() {
  return getDb()
    .prepare(
      `SELECT id, name, format, traffic, fuel_skew AS fuelSkew, history_start AS historyStart
       FROM stores ORDER BY id`,
    )
    .all() as {
    id: string;
    name: string;
    format: string;
    traffic: number;
    fuelSkew: number;
    historyStart: string;
  }[];
}

export function queryCategories() {
  return getDb()
    .prepare("SELECT id, name, short_name AS shortName FROM categories ORDER BY id")
    .all() as { id: string; name: string; shortName: string }[];
}

export function querySkus(categoryId?: string) {
  const db = getDb();
  if (categoryId && categoryId !== "all") {
    return db
      .prepare(
        `SELECT id, name, category_id AS categoryId, unit_cost AS unitCost,
                unit_price AS unitPrice, case_size AS caseSize,
                lead_time_days AS leadTimeDays, shelf_life_days AS shelfLifeDays
         FROM skus WHERE category_id = ? ORDER BY id`,
      )
      .all(categoryId) as SkuRow[];
  }
  return db
    .prepare(
      `SELECT id, name, category_id AS categoryId, unit_cost AS unitCost,
              unit_price AS unitPrice, case_size AS caseSize,
              lead_time_days AS leadTimeDays, shelf_life_days AS shelfLifeDays
       FROM skus ORDER BY id`,
    )
    .all() as SkuRow[];
}

type SkuRow = {
  id: string;
  name: string;
  categoryId: string;
  unitCost: number;
  unitPrice: number;
  caseSize: number;
  leadTimeDays: number;
  shelfLifeDays: number | null;
};

export function queryFuelGrades() {
  return getDb()
    .prepare(
      `SELECT id, name, short_name AS shortName, octane,
              tank_gallons AS tankGallons, reserve_fraction AS reserveFraction,
              margin_per_gallon AS marginPerGallon, price_elasticity AS priceElasticity
       FROM fuel_grades ORDER BY id`,
    )
    .all() as {
    id: string;
    name: string;
    shortName: string;
    octane: string;
    tankGallons: number;
    reserveFraction: number;
    marginPerGallon: number;
    priceElasticity: number;
  }[];
}

export function queryItemSales(storeId: string, from?: string, to?: string) {
  const db = getDb();
  let sql = `SELECT date, sku_id AS skuId, units_sold AS unitsSold,
                    on_promo AS onPromo, discount, price_index AS priceIndex
             FROM daily_item_sales WHERE store_id = ?`;
  const params: (string | number)[] = [storeId];
  if (from) {
    sql += " AND date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND date <= ?";
    params.push(to);
  }
  sql += " ORDER BY date, sku_id";
  return db.prepare(sql).all(...params) as {
    date: string;
    skuId: string;
    unitsSold: number;
    onPromo: number;
    discount: number;
    priceIndex: number;
  }[];
}

export function queryItemSalesAggregated(storeId: string, from?: string, to?: string) {
  const db = getDb();
  let sql = `SELECT date, SUM(units_sold) AS totalUnits
             FROM daily_item_sales WHERE store_id = ?`;
  const params: (string | number)[] = [storeId];
  if (from) {
    sql += " AND date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND date <= ?";
    params.push(to);
  }
  sql += " GROUP BY date ORDER BY date";
  return db.prepare(sql).all(...params) as { date: string; totalUnits: number }[];
}

export function queryFuelSales(storeId: string, from?: string, to?: string) {
  const db = getDb();
  let sql = `SELECT date, grade_id AS gradeId, gallons_sold AS gallonsSold,
                    street_price AS streetPrice, price_index AS priceIndex
             FROM daily_fuel_sales WHERE store_id = ?`;
  const params: (string | number)[] = [storeId];
  if (from) {
    sql += " AND date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND date <= ?";
    params.push(to);
  }
  sql += " ORDER BY date, grade_id";
  return db.prepare(sql).all(...params) as {
    date: string;
    gradeId: string;
    gallonsSold: number;
    streetPrice: number;
    priceIndex: number;
  }[];
}

export function queryWeather(from?: string, to?: string) {
  const db = getDb();
  let sql = `SELECT date, temp_f AS tempF, temp_anomaly AS tempAnomaly,
                    holiday, holiday_weight AS holidayWeight
             FROM daily_weather WHERE 1=1`;
  const params: string[] = [];
  if (from) {
    sql += " AND date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND date <= ?";
    params.push(to);
  }
  sql += " ORDER BY date";
  return db.prepare(sql).all(...params) as {
    date: string;
    tempF: number;
    tempAnomaly: number;
    holiday: string | null;
    holidayWeight: number;
  }[];
}

export function queryEvents(from?: string, to?: string) {
  const db = getDb();
  let sql = `SELECT id, start_date AS startDate, end_date AS endDate,
                    label, kind, scope, effect, note
             FROM events WHERE 1=1`;
  const params: string[] = [];
  if (from) {
    sql += " AND end_date >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND start_date <= ?";
    params.push(to);
  }
  sql += " ORDER BY start_date";
  return db.prepare(sql).all(...params) as {
    id: string;
    startDate: string;
    endDate: string;
    label: string;
    kind: string;
    scope: string;
    effect: number;
    note: string;
  }[];
}

export function latestRunId(): string | null {
  const row = getDb()
    .prepare("SELECT id FROM forecast_runs ORDER BY created_at DESC LIMIT 1")
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

export function queryForecasts(storeId: string, runId?: string) {
  const db = getDb();
  const rid = runId ?? latestRunId();
  if (!rid) return [];
  return db
    .prepare(
      `SELECT date, forecast, q10, q20, q30, q40, q50, q60, q70, q80, q90
       FROM forecasts WHERE run_id = ? AND store_id = ? ORDER BY date`,
    )
    .all(rid, storeId) as {
    date: string;
    forecast: number;
    q10: number | null;
    q20: number | null;
    q30: number | null;
    q40: number | null;
    q50: number | null;
    q60: number | null;
    q70: number | null;
    q80: number | null;
    q90: number | null;
  }[];
}

export function queryForecastAccuracy(runId?: string) {
  const db = getDb();
  const rid = runId ?? latestRunId();
  if (!rid) return [];
  return db
    .prepare(
      `SELECT fa.store_id AS storeId, s.name AS storeName,
              fa.horizon_days AS horizonDays, fa.mae, fa.mape, fa.wape, fa.rmse
       FROM forecast_accuracy fa
       JOIN stores s ON s.id = fa.store_id
       WHERE fa.run_id = ?
       ORDER BY fa.store_id`,
    )
    .all(rid) as {
    storeId: string;
    storeName: string;
    horizonDays: number;
    mae: number;
    mape: number;
    wape: number;
    rmse: number;
  }[];
}

export function queryForecastRuns() {
  return getDb()
    .prepare(
      `SELECT id, model, created_at AS createdAt, config
       FROM forecast_runs ORDER BY created_at DESC`,
    )
    .all() as {
    id: string;
    model: string;
    createdAt: string;
    config: string;
  }[];
}
