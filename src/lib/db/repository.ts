/**
 * The read side of the app: every number a page shows starts here, in SQLite.
 *
 * Reads are shaped into the series the models consume and memoised per data
 * version. The version changes whenever the synced weather, the event log or
 * the promo plan changes, so a fresh Open-Meteo sync is never served from a
 * stale cache.
 */

import { addDays, dayOfWeek, parseISO } from "../format";
import type {
  Category,
  DayCtx,
  FuelGrade,
  FuelSeries,
  ItemSeries,
  LocalEvent,
  OpsEvent,
  Sku,
  Store,
  StoreId,
} from "../data/types";
import { getDb } from "./index";

/** Days of known-ahead calendar kept past the last sales day. */
export const FUTURE_DAYS = 60;

/* -------------------------------------------------------------------------- */
/* Versioning & cache                                                         */
/* -------------------------------------------------------------------------- */

function hasTable(name: string): boolean {
  return !!getDb()
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}

/** Cheap fingerprint of the mutable inputs. */
export function dataVersion(): string {
  const db = getDb();
  const sync = hasTable("external_sync_log")
    ? ((db.prepare("SELECT MAX(synced_at) AS v FROM external_sync_log").get() as { v: string | null }).v ?? "")
    : "";
  const counts = db
    .prepare(
      `SELECT ${["events", "promotions", "store_weather", "holidays", "external_events", "stores"]
        .map((t) => (hasTable(t) ? `(SELECT COUNT(*) FROM ${t})` : "0"))
        .join(" || ':' || ")} AS v`,
    )
    .get() as { v: string };
  return `${sync}|${counts.v}`;
}

const cache = new Map<string, unknown>();
let cacheVersion = "";

/** Memoise `fn` under `key` for the current data version. */
export function memo<T>(key: string, fn: () => T): T {
  const v = dataVersion();
  if (v !== cacheVersion) {
    cache.clear();
    cacheVersion = v;
  }
  if (cache.has(key)) return cache.get(key) as T;
  const out = fn();
  cache.set(key, out);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Reference data                                                             */
/* -------------------------------------------------------------------------- */

export function getStores(): Store[] {
  return memo("stores", () =>
    getDb()
      .prepare(
        `SELECT id, name, format, traffic, fuel_skew AS fuelSkew, history_start AS historyStart,
                latitude, longitude, timezone, region
         FROM stores ORDER BY id`,
      )
      .all() as Store[],
  );
}

export function getStore(id: StoreId): Store | null {
  return getStores().find((s) => s.id === id) ?? null;
}

// Reference lists keep the order they were entered in (rowid): that order
// assigns each category and grade its fixed chart colour.
export function getCategories(): Category[] {
  return memo("categories", () =>
    getDb()
      .prepare("SELECT id, name, short_name AS short FROM categories ORDER BY rowid")
      .all() as Category[],
  );
}

export function getSkus(): Sku[] {
  return memo("skus", () =>
    getDb()
      .prepare(
        `SELECT id, name, category_id AS category, unit_cost AS unitCost,
                unit_price AS unitPrice, case_size AS caseSize,
                lead_time_days AS leadTimeDays, shelf_life_days AS shelfLifeDays
         FROM skus ORDER BY rowid`,
      )
      .all() as Sku[],
  );
}

export function getFuelGrades(): FuelGrade[] {
  return memo("grades", () =>
    getDb()
      .prepare(
        `SELECT id, name, short_name AS short, octane, tank_gallons AS tankGallons,
                reserve_fraction AS reserveFraction, margin_per_gallon AS marginPerGallon,
                price_elasticity AS priceElasticity
         FROM fuel_grades ORDER BY rowid`,
      )
      .all() as FuelGrade[],
  );
}

export function getEvents(): OpsEvent[] {
  return memo("events", () => {
    const rows = getDb()
      .prepare(
        `SELECT id, start_date AS start, end_date AS end, label, kind, scope, effect, note
         FROM events ORDER BY start_date`,
      )
      .all() as (Omit<OpsEvent, "scope"> & { scope: string })[];
    return rows.map((r) => ({
      ...r,
      scope:
        r.scope === "all" || r.scope === "fuel" || r.scope === "inside"
          ? r.scope
          : r.scope.split(",").map((s) => s.trim()),
    }));
  });
}

/** First day after the last recorded sale — the forecast origin. */
export function getAsOf(): string {
  return memo("asOf", () => {
    const r = getDb()
      .prepare(
        `SELECT MAX(d) AS last FROM (
           SELECT MAX(date) AS d FROM daily_item_sales
           UNION ALL SELECT MAX(date) FROM daily_fuel_sales)`,
      )
      .get() as { last: string | null };
    return r.last ? addDays(r.last, 1) : new Date().toISOString().slice(0, 10);
  });
}

/* -------------------------------------------------------------------------- */
/* Weather, holidays & calendar                                               */
/* -------------------------------------------------------------------------- */

type WeatherRow = {
  date: string;
  tempF: number;
  tempAnomaly: number;
  precipMm: number;
  kind: "observed" | "forecast";
};

/** Open-Meteo weather at the store's own location. */
function storeWeather(storeId: StoreId): Map<string, WeatherRow> {
  return memo(`weather:${storeId}`, () => {
    if (!hasTable("store_weather")) return new Map();
    const rows = getDb()
      .prepare(
        `SELECT date, temp_f AS tempF, temp_anomaly AS tempAnomaly, precip_mm AS precipMm, kind
         FROM store_weather WHERE store_id = ? ORDER BY date`,
      )
      .all(storeId) as WeatherRow[];
    return new Map(rows.map((r) => [r.date, r]));
  });
}

/** Public holidays that apply to a store: national, plus its state's. */
function holidaysFor(region: string | null): Map<string, string> {
  return memo(`holidays:${region ?? ""}`, () => {
    if (!hasTable("holidays")) return new Map();
    const rows = getDb()
      .prepare(
        `SELECT date, name FROM holidays
         WHERE kind = 'public' AND (region = 'US' OR region = ?)
         ORDER BY date, region`,
      )
      .all(region ?? "") as { date: string; name: string }[];
    const out = new Map<string, string>();
    for (const r of rows) if (!out.has(r.date)) out.set(r.date, r.name);
    return out;
  });
}

function dayOfYear(iso: string): number {
  const d = parseISO(iso);
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

/** First and last sales day for a store's inside or fuel history. */
function salesSpan(storeId: StoreId, table: "daily_item_sales" | "daily_fuel_sales") {
  return getDb()
    .prepare(`SELECT MIN(date) AS first, MAX(date) AS last FROM ${table} WHERE store_id = ?`)
    .get(storeId) as { first: string | null; last: string | null };
}

/**
 * The store's calendar: every day of its sales history, then FUTURE_DAYS of
 * known-ahead days — holidays, and the weather forecast where one exists.
 */
export function getCalendar(storeId: StoreId, stream: "items" | "fuel" = "items"): DayCtx[] {
  return memo(`cal:${storeId}:${stream}`, () => {
    const span = salesSpan(storeId, stream === "items" ? "daily_item_sales" : "daily_fuel_sales");
    if (!span.first) return [];
    const asOf = getAsOf();
    const weather = storeWeather(storeId);
    const holidays = holidaysFor(getStore(storeId)?.region ?? null);

    const days: DayCtx[] = [];
    const total = Math.round((parseISO(asOf).getTime() - parseISO(span.first).getTime()) / 86400000) + FUTURE_DAYS;
    for (let t = 0; t < total; t++) {
      const date = addDays(span.first, t);
      const w = weather.get(date);
      const holiday = holidays.get(date) ?? null;
      const nextHoliday = holiday ? null : (holidays.get(addDays(date, 1)) ?? null);
      const dow = dayOfWeek(date);
      days.push({
        date,
        t,
        doy: dayOfYear(date),
        dow,
        isWeekend: dow === 0 || dow === 6,
        tempF: w?.tempF ?? NaN,
        // No reading → treated as a normal day, never as an invented temperature.
        tempAnomaly: w?.tempAnomaly ?? 0,
        precipMm: w?.precipMm ?? 0,
        weatherSource: w ? w.kind : "none",
        holiday,
        holidayWeight: holiday ? 1 : 0,
        preHoliday: nextHoliday != null,
        nextHoliday,
        isFuture: date >= asOf,
      });
    }
    return days;
  });
}

/* -------------------------------------------------------------------------- */
/* Events near the store                                                      */
/* -------------------------------------------------------------------------- */

export function getLocalEvents(storeId: StoreId): LocalEvent[] {
  return memo(`local:${storeId}`, () => {
    if (!hasTable("external_events")) return [];
    return getDb()
      .prepare(
        `SELECT id, title, category, start_date AS start, end_date AS end,
                attendance, rank, distance_km AS distanceKm
         FROM external_events WHERE store_id = ? ORDER BY start_date`,
      )
      .all(storeId) as LocalEvent[];
  });
}

export type LocalEventDay = {
  /** Predicted attendance near the store that day (multi-day events spread evenly). */
  attendance: number;
  severeWeather: boolean;
  /** The day's biggest events, largest first — for the tooltip. */
  top: { title: string; category: string; attendance: number | null }[];
};

/** Nearby-event load per calendar day. */
export function getLocalEventDays(storeId: StoreId, cal: DayCtx[]): LocalEventDay[] {
  return memo(`localdays:${storeId}:${cal.length}:${cal[0]?.date ?? ""}`, () => {
    const events = getLocalEvents(storeId);
    return cal.map((d) => {
      const live = events.filter((e) => d.date >= e.start && d.date <= e.end);
      let attendance = 0;
      for (const e of live) {
        if (!e.attendance) continue;
        const days = Math.max(1, Math.round((parseISO(e.end).getTime() - parseISO(e.start).getTime()) / 86400000) + 1);
        attendance += e.attendance / days;
      }
      return {
        attendance,
        severeWeather: live.some((e) => e.category === "severe-weather"),
        top: live
          .filter((e) => e.category !== "severe-weather")
          .sort((a, b) => (b.attendance ?? 0) - (a.attendance ?? 0))
          .slice(0, 3)
          .map((e) => ({ title: e.title, category: e.category, attendance: e.attendance })),
      };
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Sales series                                                               */
/* -------------------------------------------------------------------------- */

export function getItemSeries(storeId: StoreId): ItemSeries[] {
  return memo(`items:${storeId}`, () => {
    const cal = getCalendar(storeId, "items");
    if (!cal.length) return [];
    const dates = cal.map((d) => d.date);
    const index = new Map(dates.map((d, i) => [d, i]));
    const histLen = cal.filter((d) => !d.isFuture).length;
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT sku_id AS skuId, date, units_sold AS units, on_promo AS onPromo,
                discount, price_index AS priceIndex
         FROM daily_item_sales WHERE store_id = ? ORDER BY sku_id, date`,
      )
      .all(storeId) as {
      skuId: string;
      date: string;
      units: number;
      onPromo: number;
      discount: number;
      priceIndex: number;
    }[];

    const promos = hasTable("promotions")
      ? (db
          .prepare(
            `SELECT sku_id AS skuId, start_date AS start, end_date AS end, discount
             FROM promotions WHERE end_date >= ?`,
          )
          .all(getAsOf()) as { skuId: string; start: string; end: string; discount: number }[])
      : [];

    const bySku = new Map<string, ItemSeries>();
    for (const sku of getSkus()) {
      bySku.set(sku.id, {
        skuId: sku.id,
        storeId,
        dates,
        units: new Array<number>(histLen).fill(0),
        onPromo: new Array<boolean>(cal.length).fill(false),
        discount: new Array<number>(cal.length).fill(0),
        priceIndex: new Array<number>(cal.length).fill(1),
      });
    }
    for (const r of rows) {
      const s = bySku.get(r.skuId);
      const i = index.get(r.date);
      if (!s || i == null || i >= histLen) continue;
      s.units[i] = r.units;
      s.onPromo[i] = r.onPromo === 1;
      s.discount[i] = r.discount;
      s.priceIndex[i] = r.priceIndex;
    }

    // Forward days: the planned promo calendar, and the shelf price held at
    // its last level (the last day's price index with its discount removed).
    for (const s of bySku.values()) {
      const last = histLen - 1;
      const shelf = last >= 0 ? s.priceIndex[last] / Math.max(0.01, 1 - s.discount[last]) : 1;
      for (let i = histLen; i < cal.length; i++) s.priceIndex[i] = shelf;
    }
    for (const p of promos) {
      const s = bySku.get(p.skuId);
      if (!s) continue;
      for (let i = histLen; i < cal.length; i++) {
        if (dates[i] >= p.start && dates[i] <= p.end) {
          s.onPromo[i] = true;
          s.discount[i] = p.discount;
          s.priceIndex[i] = s.priceIndex[i] * (1 - p.discount);
        }
      }
    }

    // SKUs with no sales at this store are not part of its range.
    return [...bySku.values()].filter((s) => s.units.some((u) => u > 0));
  });
}

export function getFuelSeries(storeId: StoreId): FuelSeries[] {
  return memo(`fuel:${storeId}`, () => {
    const cal = getCalendar(storeId, "fuel");
    if (!cal.length) return [];
    const dates = cal.map((d) => d.date);
    const index = new Map(dates.map((d, i) => [d, i]));
    const histLen = cal.filter((d) => !d.isFuture).length;

    const rows = getDb()
      .prepare(
        `SELECT grade_id AS gradeId, date, gallons_sold AS gallons,
                street_price AS price, price_index AS priceIndex
         FROM daily_fuel_sales WHERE store_id = ? ORDER BY grade_id, date`,
      )
      .all(storeId) as {
      gradeId: string;
      date: string;
      gallons: number;
      price: number;
      priceIndex: number;
    }[];

    const out: FuelSeries[] = [];
    for (const g of getFuelGrades()) {
      const s: FuelSeries = {
        gradeId: g.id,
        storeId,
        dates,
        gallons: new Array<number>(histLen).fill(0),
        price: new Array<number>(cal.length).fill(NaN),
        priceIndex: new Array<number>(cal.length).fill(1),
      };
      let seen = false;
      for (const r of rows) {
        if (r.gradeId !== g.id) continue;
        const i = index.get(r.date);
        if (i == null || i >= histLen) continue;
        s.gallons[i] = r.gallons;
        s.price[i] = r.price;
        s.priceIndex[i] = r.priceIndex;
        seen = true;
      }
      if (!seen) continue;

      // Carry gaps forward, then hold the forward price at today's level — a
      // volume forecast is made under the current price, not a guessed one.
      for (let i = 1; i < cal.length; i++) {
        if (!Number.isFinite(s.price[i])) s.price[i] = s.price[i - 1];
      }
      for (let i = histLen; i < cal.length; i++) {
        const from = Math.max(0, i - 89);
        let sum = 0;
        for (let j = from; j <= i; j++) sum += s.price[j];
        s.priceIndex[i] = s.price[i] / (sum / (i - from + 1));
      }
      out.push(s);
    }
    return out;
  });
}

/* -------------------------------------------------------------------------- */
/* Stock positions                                                            */
/* -------------------------------------------------------------------------- */

export function getOnHand(storeId: StoreId): Map<string, number> {
  return memo(`onhand:${storeId}`, () => {
    if (!hasTable("inventory_on_hand")) return new Map();
    const rows = getDb()
      .prepare("SELECT sku_id AS id, units FROM inventory_on_hand WHERE store_id = ?")
      .all(storeId) as { id: string; units: number }[];
    return new Map(rows.map((r) => [r.id, r.units]));
  });
}

export function getTankLevels(storeId: StoreId): Map<string, number> {
  return memo(`tanks:${storeId}`, () => {
    if (!hasTable("tank_levels")) return new Map();
    const rows = getDb()
      .prepare("SELECT grade_id AS id, gallons FROM tank_levels WHERE store_id = ?")
      .all(storeId) as { id: string; gallons: number }[];
    return new Map(rows.map((r) => [r.id, r.gallons]));
  });
}

/* -------------------------------------------------------------------------- */
/* What the page is built from                                                */
/* -------------------------------------------------------------------------- */

export type DataInventory = {
  salesDays: number;
  firstSale: string | null;
  lastSale: string | null;
  weatherDays: { observed: number; forecast: number; none: number };
  holidays: number;
  loggedEvents: number;
  localEvents: number;
  promotions: number;
};

export function getDataInventory(storeId: StoreId, stream: "items" | "fuel"): DataInventory {
  return memo(`inventory:${storeId}:${stream}`, () => {
    const cal = getCalendar(storeId, stream);
    const hist = cal.filter((d) => !d.isFuture);
    const count = (src: DayCtx["weatherSource"]) => cal.filter((d) => d.weatherSource === src).length;
    const promotions = hasTable("promotions")
      ? (getDb().prepare("SELECT COUNT(*) AS n FROM promotions").get() as { n: number }).n
      : 0;
    return {
      salesDays: hist.length,
      firstSale: hist[0]?.date ?? null,
      lastSale: hist[hist.length - 1]?.date ?? null,
      weatherDays: { observed: count("observed"), forecast: count("forecast"), none: count("none") },
      holidays: cal.filter((d) => d.holidayWeight > 0).length,
      loggedEvents: getEvents().length,
      localEvents: getLocalEvents(storeId).length,
      promotions: stream === "items" ? promotions : 0,
    };
  });
}
