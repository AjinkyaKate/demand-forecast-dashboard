/**
 * Seed the SQLite database with dummy store sales data.
 *
 * Each store gets a different history depth so we can test with varied data:
 *   s-101  Route 9 Travel Center  — 2 years  (730 days)
 *   s-204  Midtown & 5th          — 1 year   (365 days)
 *   s-318  Lakeside Commons       — 6 months (180 days)
 *   s-442  County Road 12         — 3 months  (90 days)
 *
 * Usage: npx tsx scripts/seed.ts
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { SCHEMA_SQL } from "../src/lib/db/schema";
import { seedOps } from "./seed-ops";
import {
  AS_OF,
  CATEGORIES,
  FIXED_HOLIDAYS,
  FUEL_GRADES,
  SKUS,
  STORES,
  type StoreId,
} from "./seed-catalog";
import { addDays, dayOfWeek, parseISO, toISO } from "../src/lib/format";
import { gaussian, hashSeed, mulberry32, poisson } from "../src/lib/rng";

/* -------------------------------------------------------------------------- */
/*  Config                                                                     */
/* -------------------------------------------------------------------------- */

const STORE_HISTORY_DAYS: Record<StoreId, number> = {
  "s-101": 730,
  "s-204": 365,
  "s-318": 180,
  "s-442": 90,
};

const FUTURE_DAYS = 60;
const TOTAL_DAYS = 730 + FUTURE_DAYS; // calendar always 730+60

/* -------------------------------------------------------------------------- */
/*  Calendar (same as generate.ts but standalone)                              */
/* -------------------------------------------------------------------------- */

type DayCtx = {
  date: string;
  t: number;
  doy: number;
  dow: number;
  isWeekend: boolean;
  tempF: number;
  tempAnomaly: number;
  holiday: string | null;
  holidayWeight: number;
  preHoliday: boolean;
  isFuture: boolean;
};

function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(year, month - 1, 1).getDay();
  let day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return day;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const last = new Date(year, month, 0);
  const lastDay = last.getDate();
  const lastDow = last.getDay();
  let diff = (lastDow - weekday + 7) % 7;
  return lastDay - diff;
}

function buildCalendar(): DayCtx[] {
  const origin = addDays(AS_OF, -730);
  const days: DayCtx[] = [];
  const rand = mulberry32(hashSeed("weather"));
  let anomaly = 0;

  for (let t = 0; t < TOTAL_DAYS; t++) {
    const date = addDays(origin, t);
    const d = parseISO(date);
    const year = d.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const doy = Math.floor((d.getTime() - startOfYear.getTime()) / 86400000) + 1;
    const dow = dayOfWeek(date);
    const isFuture = date >= AS_OF;

    // Temperature: seasonal normal for temperate US
    const normal = 54 - 24 * Math.cos((2 * Math.PI * (doy - 15)) / 365);
    // AR(1) weather anomaly
    const decay = isFuture ? 0.78 : 0.82;
    anomaly = decay * anomaly + 5.4 * gaussian(rand);
    const tempF = normal + anomaly;

    // Holidays
    let holiday: string | null = null;
    let holidayWeight = 0;

    // Fixed holidays
    const month = d.getMonth() + 1;
    const day = d.getDate();
    for (const h of FIXED_HOLIDAYS) {
      if (h.month === month && h.day === day) {
        holiday = h.name;
        holidayWeight = h.weight;
        break;
      }
    }

    // Floating holidays
    if (!holiday) {
      const floaters: { name: string; month: number; dayFn: () => number; weight: number }[] = [
        { name: "Memorial Day", month: 5, dayFn: () => lastWeekday(year, 5, 1), weight: 0.95 },
        { name: "Labor Day", month: 9, dayFn: () => nthWeekday(year, 9, 1, 1), weight: 0.95 },
        { name: "Thanksgiving", month: 11, dayFn: () => nthWeekday(year, 11, 4, 4), weight: 0.85 },
        { name: "Presidents' Day", month: 2, dayFn: () => nthWeekday(year, 2, 1, 3), weight: 0.35 },
        { name: "MLK Day", month: 1, dayFn: () => nthWeekday(year, 1, 1, 3), weight: 0.30 },
        { name: "Super Bowl Sunday", month: 2, dayFn: () => nthWeekday(year, 2, 0, 2), weight: 0.80 },
      ];
      for (const f of floaters) {
        if (month === f.month && day === f.dayFn()) {
          holiday = f.name;
          holidayWeight = f.weight;
          break;
        }
      }
    }

    // Pre-holiday flag (day before a major holiday)
    let preHoliday = false;
    if (!holiday) {
      const tomorrow = addDays(date, 1);
      const td = parseISO(tomorrow);
      const tm = td.getMonth() + 1;
      const tday = td.getDate();
      for (const h of FIXED_HOLIDAYS) {
        if (h.month === tm && h.day === tday && h.weight >= 0.8) {
          preHoliday = true;
          break;
        }
      }
    }

    days.push({
      date,
      t,
      doy,
      dow,
      isWeekend: dow === 0 || dow === 6,
      tempF,
      tempAnomaly: anomaly,
      holiday,
      holidayWeight,
      preHoliday,
      isFuture,
    });
  }
  return days;
}

/* -------------------------------------------------------------------------- */
/*  Events                                                                     */
/* -------------------------------------------------------------------------- */

const EVENTS = [
  { id: "ev-01", start: "2025-07-18", end: "2025-07-20", label: "Riverside Music Festival", kind: "local", scope: "all", effect: 1.48, note: "3-day music festival one block south; foot traffic +48%." },
  { id: "ev-02", start: "2025-11-06", end: "2025-11-14", label: "Route 9 lane closure", kind: "traffic", scope: "all", effect: 0.66, note: "Southbound lane closed for utility work; drive-by traffic down 34%." },
  { id: "ev-03", start: "2026-01-22", end: "2026-01-25", label: "Winter storm Ezra", kind: "weather", scope: "all", effect: 0.74, note: "14\" accumulation; travel advisories kept customers home." },
  { id: "ev-04", start: "2026-01-22", end: "2026-01-25", label: "Winter storm Ezra — stock-up", kind: "weather", scope: "hot-food,auto-nonfood,dairy-grocery", effect: 1.62, note: "Storm prep buying in food & essentials." },
  { id: "ev-05", start: "2026-03-05", end: "2026-09-25", label: "Competitor opened on Route 9", kind: "competition", scope: "all", effect: 0.91, note: "New competitor 0.6 mi north; steady 9% traffic loss." },
  { id: "ev-06", start: "2026-05-14", end: "2026-05-17", label: "Walk-in cooler compressor failure", kind: "equipment", scope: "beverages,beer-wine,dairy-grocery", effect: 0.42, note: "Cooler down 3.5 days; cold beverages unavailable." },
  { id: "ev-07", start: "2026-06-26", end: "2026-07-06", label: "Independence Day travel surge", kind: "traffic", scope: "all", effect: 1.24, note: "Extended holiday travel window; +24% drive-by traffic." },
  { id: "ev-08", start: "2026-08-11", end: "2026-08-13", label: "Snack DSD delivery miss", kind: "supply", scope: "salty-snacks,candy", effect: 0.38, note: "DSD route skipped twice; shelves ran bare." },
  { id: "ev-09", start: "2026-09-04", end: "2026-09-10", label: "Street price war", kind: "competition", scope: "fuel", effect: 1.31, note: "Competitor slashed gas price; volume up 31% but margin crushed." },
  { id: "ev-10", start: "2026-02-19", end: "2026-02-21", label: "POS outage", kind: "equipment", scope: "inside", effect: 0.55, note: "Register system down 2.5 days; inside sales halved." },
];

function eventMultiplier(
  date: string,
  target: "fuel" | "inside",
  category?: string,
): number {
  let mult = 1;
  for (const ev of EVENTS) {
    if (date < ev.start || date > ev.end) continue;
    const s = ev.scope;
    if (s === "all") { mult *= ev.effect; continue; }
    if (s === target) { mult *= ev.effect; continue; }
    if (category && s.split(",").includes(category)) { mult *= ev.effect; }
  }
  return mult;
}

/* -------------------------------------------------------------------------- */
/*  Promos                                                                     */
/* -------------------------------------------------------------------------- */

type Promo = { start: string; end: string; discount: number };

function promoCalendar(
  skuId: string,
  cal: DayCtx[],
): Promo[] {
  const rand = mulberry32(hashSeed(`promo:${skuId}`));
  const promos: Promo[] = [];
  let cursor = 0;
  while (cursor < cal.length) {
    cursor += Math.floor(28 + rand() * 42); // 4-10 weeks gap
    if (cursor >= cal.length) break;
    const len = Math.floor(7 + rand() * 8); // 7-14 days
    const end = Math.min(cursor + len - 1, cal.length - 1);
    promos.push({
      start: cal[cursor].date,
      end: cal[end].date,
      discount: 0.12 + rand() * 0.18,
    });
    cursor = end + 1;
  }
  return promos;
}

/* -------------------------------------------------------------------------- */
/*  Fuel prices                                                                */
/* -------------------------------------------------------------------------- */

const GRADE_SPREAD: Record<string, number> = {
  reg: 0,
  mid: 0.38,
  prem: 0.74,
  diesel: 0.52,
};

function buildFuelPrices(cal: DayCtx[]): Map<string, number[]> {
  const rand = mulberry32(hashSeed("fuel-price"));
  const regPrices: number[] = [];
  let price = 3.28;

  for (let i = 0; i < cal.length; i++) {
    const doy = cal[i].doy;
    const seasonal = 3.30 + 0.16 * Math.max(0, Math.sin((Math.PI * (doy - 100)) / 180));
    price = price + 0.965 * (price - price) + 0.035 * (seasonal - price) + 0.012 * gaussian(rand);
    price = Math.max(2.50, Math.min(5.00, price));

    // Price war week
    if (cal[i].date >= "2026-09-04" && cal[i].date <= "2026-09-10") {
      regPrices.push(price - 0.22);
    } else if (cal[i].isFuture && i > 0) {
      regPrices.push(regPrices[i - 1]); // flat in future
    } else {
      regPrices.push(price);
    }
  }

  const prices = new Map<string, number[]>();
  for (const g of FUEL_GRADES) {
    const spread = GRADE_SPREAD[g.id] ?? 0;
    prices.set(g.id, regPrices.map((p) => +(p + spread).toFixed(3)));
  }
  return prices;
}

/* -------------------------------------------------------------------------- */
/*  Main seeder                                                                */
/* -------------------------------------------------------------------------- */

function main() {
  const dbDir = path.join(process.cwd(), "data");
  const dbPath = path.join(dbDir, "forecast.db");
  fs.mkdirSync(dbDir, { recursive: true });

  // Delete old DB if exists
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log("Deleted existing database.");
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = OFF"); // fast seeding

  // Create tables
  db.exec(SCHEMA_SQL);
  console.log("Tables created.");

  const cal = buildCalendar();
  const fuelPrices = buildFuelPrices(cal);
  const origin = 730; // index of AS_OF in the calendar

  // ----- Insert reference data -----

  const insertStore = db.prepare(
    `INSERT INTO stores (id, name, format, traffic, fuel_skew, history_start, latitude, longitude, timezone, region)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const s of STORES) {
    const histDays = STORE_HISTORY_DAYS[s.id];
    const startDate = addDays(AS_OF, -histDays);
    insertStore.run(s.id, s.name, s.format, s.traffic, s.fuelSkew, startDate, s.latitude, s.longitude, s.timezone, s.region);
  }
  console.log(`Inserted ${STORES.length} stores.`);

  const insertCat = db.prepare(
    `INSERT INTO categories (id, name, short_name) VALUES (?,?,?)`,
  );
  for (const c of CATEGORIES) {
    insertCat.run(c.id, c.name, c.short);
  }
  console.log(`Inserted ${CATEGORIES.length} categories.`);

  const insertSku = db.prepare(
    `INSERT INTO skus (id, name, category_id, unit_cost, unit_price, case_size, lead_time_days, shelf_life_days) VALUES (?,?,?,?,?,?,?,?)`,
  );
  for (const s of SKUS) {
    insertSku.run(s.id, s.name, s.category, s.unitCost, s.unitPrice, s.caseSize, s.leadTimeDays, s.shelfLifeDays);
  }
  console.log(`Inserted ${SKUS.length} SKUs.`);

  const insertGrade = db.prepare(
    `INSERT INTO fuel_grades (id, name, short_name, octane, tank_gallons, reserve_fraction, margin_per_gallon, price_elasticity) VALUES (?,?,?,?,?,?,?,?)`,
  );
  for (const g of FUEL_GRADES) {
    insertGrade.run(g.id, g.name, g.short, g.octane, g.tankGallons, g.reserveFraction, g.marginPerGallon, g.priceElasticity);
  }
  console.log(`Inserted ${FUEL_GRADES.length} fuel grades.`);

  // ----- Insert weather -----

  const insertWeather = db.prepare(
    `INSERT INTO daily_weather (date, temp_f, temp_anomaly, holiday, holiday_weight) VALUES (?,?,?,?,?)`,
  );
  const weatherTx = db.transaction(() => {
    for (const d of cal) {
      insertWeather.run(d.date, +d.tempF.toFixed(1), +d.tempAnomaly.toFixed(2), d.holiday, d.holidayWeight);
    }
  });
  weatherTx();
  console.log(`Inserted ${cal.length} weather days.`);

  // ----- Insert events -----

  const insertEvent = db.prepare(
    `INSERT INTO events (id, start_date, end_date, label, kind, scope, effect, note) VALUES (?,?,?,?,?,?,?,?)`,
  );
  for (const e of EVENTS) {
    insertEvent.run(e.id, e.start, e.end, e.label, e.kind, e.scope, e.effect, e.note);
  }
  console.log(`Inserted ${EVENTS.length} events.`);

  // ----- Generate item sales per store -----

  const insertItem = db.prepare(
    `INSERT INTO daily_item_sales (store_id, sku_id, date, units_sold, on_promo, discount, price_index) VALUES (?,?,?,?,?,?,?)`,
  );

  let totalItemRows = 0;

  for (const store of STORES) {
    const histDays = STORE_HISTORY_DAYS[store.id];
    const fromIdx = origin - histDays; // start of this store's history in the calendar

    for (const sku of SKUS) {
      const rand = mulberry32(hashSeed(`item:${store.id}:${sku.id}`));
      const promos = promoCalendar(sku.id, cal);
      const shape = sku.shape;

      // Precompute price index bumps
      const priceBump1Idx = Math.floor(0.28 * 730);
      const priceBump2Idx = Math.floor(0.71 * 730);

      const itemTx = db.transaction(() => {
        for (let i = fromIdx; i < origin; i++) {
          const d = cal[i];
          const t = i; // timeline index

          // Trend
          const trend = Math.pow(1 + shape.trend, t / 365);

          // Seasonality
          const season = Math.max(
            0.05,
            1 + shape.yearAmp * Math.cos((2 * Math.PI * (d.doy - shape.yearPeak)) / 365),
          );

          // Day of week
          const dowMult = shape.dow[d.dow];

          // Promo
          let isPromo = false;
          let discount = 0;
          for (const p of promos) {
            if (d.date >= p.start && d.date <= p.end) {
              isPromo = true;
              discount = p.discount;
              break;
            }
          }
          const promoMult = isPromo ? shape.promoLift : 1;

          // Holiday
          let holidayMult = 1;
          if (d.holidayWeight > 0) {
            holidayMult = 1 + (shape.holidayLift - 1) * d.holidayWeight;
          } else if (d.preHoliday) {
            holidayMult = 1 + (shape.holidayLift - 1) * 0.55;
          }

          // Weather
          const weatherMult = Math.max(0.2, 1 + (shape.tempCoef * d.tempAnomaly) / 100);

          // Events
          const evMult = eventMultiplier(d.date, "inside", sku.category);

          // Price index
          let priceIdx = 1.0;
          if (i >= priceBump2Idx) priceIdx = 1.019 * 1.024;
          else if (i >= priceBump1Idx) priceIdx = 1.019;
          if (isPromo) priceIdx *= 1 - discount;

          // Lambda → Poisson draw
          const lambda =
            shape.base * store.traffic * trend * season * dowMult * promoMult * holidayMult * weatherMult * evMult;
          const units = poisson(rand, Math.max(0, lambda));

          insertItem.run(store.id, sku.id, d.date, units, isPromo ? 1 : 0, +discount.toFixed(3), +priceIdx.toFixed(4));
          totalItemRows++;
        }
      });
      itemTx();
    }
    console.log(`  ${store.id}: ${histDays} days × ${SKUS.length} SKUs = ${histDays * SKUS.length} item rows`);
  }
  console.log(`Total item sales rows: ${totalItemRows.toLocaleString()}`);

  // ----- Generate fuel sales per store -----

  const insertFuel = db.prepare(
    `INSERT INTO daily_fuel_sales (store_id, grade_id, date, gallons_sold, street_price, price_index) VALUES (?,?,?,?,?,?)`,
  );

  let totalFuelRows = 0;

  for (const store of STORES) {
    const histDays = STORE_HISTORY_DAYS[store.id];
    const fromIdx = origin - histDays;

    for (const grade of FUEL_GRADES) {
      const rand = mulberry32(hashSeed(`fuel:${store.id}:${grade.id}`));
      const prices = fuelPrices.get(grade.id)!;
      const shape = grade.shape;

      // Trailing 90-day price mean for price index
      const priceMeans: number[] = [];
      for (let i = 0; i < cal.length; i++) {
        const start = Math.max(0, i - 89);
        let sum = 0;
        for (let j = start; j <= i; j++) sum += prices[j];
        priceMeans.push(sum / (i - start + 1));
      }

      const fuelTx = db.transaction(() => {
        for (let i = fromIdx; i < origin; i++) {
          const d = cal[i];
          const t = i;

          const trend = Math.pow(1 + shape.trend, t / 365);
          const season = Math.max(
            0.05,
            1 + shape.yearAmp * Math.cos((2 * Math.PI * (d.doy - shape.yearPeak)) / 365),
          );
          const dowMult = shape.dow[d.dow];

          let holidayMult = 1;
          if (d.holidayWeight > 0) {
            holidayMult = 1 + (shape.holidayLift - 1) * d.holidayWeight;
          }

          const weatherMult = Math.max(0.2, 1 + (shape.tempCoef * d.tempAnomaly) / 1000);

          const priceIdx = priceMeans[i] > 0 ? prices[i] / priceMeans[i] : 1;
          const priceEffect = Math.pow(priceIdx, grade.priceElasticity * 6);

          const evMult = eventMultiplier(d.date, "fuel");

          const mean =
            grade.base * store.traffic * store.fuelSkew * trend * season * dowMult * holidayMult * weatherMult * priceEffect * evMult;
          const noise = Math.max(0.35, 1 + gaussian(rand) * 0.062);
          const gallons = Math.round(mean * noise);

          insertFuel.run(store.id, grade.id, d.date, gallons, prices[i], +priceIdx.toFixed(4));
          totalFuelRows++;
        }
      });
      fuelTx();
    }
    console.log(`  ${store.id}: ${histDays} days × ${FUEL_GRADES.length} grades = ${histDays * FUEL_GRADES.length} fuel rows`);
  }
  console.log(`Total fuel sales rows: ${totalFuelRows.toLocaleString()}`);

  // ----- Promo plan, on-hand inventory, tank levels -----

  const ops = seedOps(db);
  console.log(`Inserted ${ops.promoRows} promotions, ${ops.inventoryRows} on-hand counts, ${ops.tankRows} tank readings.`);

  // ----- Summary -----

  db.pragma("synchronous = NORMAL");
  db.close();

  const stats = fs.statSync(dbPath);
  console.log(`\nDatabase created: ${dbPath}`);
  console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`\nStore history lengths:`);
  for (const s of STORES) {
    const days = STORE_HISTORY_DAYS[s.id];
    const label =
      days >= 730 ? "2 years" : days >= 365 ? "1 year" : days >= 180 ? "6 months" : "3 months";
    console.log(`  ${s.id} ${s.name.padEnd(40)} ${label} (${days} days)`);
  }
}

main();
