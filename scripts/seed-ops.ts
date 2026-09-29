/**
 * Seed the operational tables the dashboard reads alongside sales:
 *
 *   promotions         the promo plan per SKU, including planned future promos
 *   inventory_on_hand  the latest shelf count per store and SKU
 *   tank_levels        the latest tank gauge reading per store and grade
 *
 * Safe to run on an existing database: it creates the tables if missing and
 * replaces only their rows. Sales, weather (including synced Open-Meteo rows)
 * and events are untouched.
 *
 * Everything is derived from what is already in the database — the calendar
 * from the sales dates, averages from sales, sizes from the SKU and grade
 * tables. The promo plan reproduces the seed's promo generator exactly, so
 * the planned promos agree with the on_promo flags in daily_item_sales.
 *
 * Usage: npx tsx scripts/seed-ops.ts
 */

import Database from "better-sqlite3";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SCHEMA_SQL } from "../src/lib/db/schema";
import { addDays } from "../src/lib/format";
import { hashSeed, mulberry32 } from "../src/lib/rng";

/** Calendar length the seed generated promos over: 730 history + 60 future. */
const CALENDAR_DAYS = 790;

type Promo = { start: string; end: string; discount: number };

/** Same algorithm and seed as scripts/seed.ts, so history flags line up. */
function promoPlan(skuId: string, dates: string[]): Promo[] {
  const rand = mulberry32(hashSeed(`promo:${skuId}`));
  const promos: Promo[] = [];
  let cursor = 0;
  while (cursor < dates.length) {
    cursor += Math.floor(28 + rand() * 42);
    if (cursor >= dates.length) break;
    const len = Math.floor(7 + rand() * 8);
    const end = Math.min(cursor + len - 1, dates.length - 1);
    promos.push({ start: dates[cursor], end: dates[end], discount: 0.12 + rand() * 0.18 });
    cursor = end + 1;
  }
  return promos;
}

export function seedOps(db: Database.Database) {
  db.exec(SCHEMA_SQL);

  const span = db
    .prepare("SELECT MIN(date) AS first, MAX(date) AS last FROM daily_item_sales")
    .get() as { first: string; last: string };
  const asOf = addDays(span.last, 1);
  const dates = Array.from({ length: CALENDAR_DAYS }, (_, i) => addDays(span.first, i));

  const skus = db
    .prepare("SELECT id, case_size AS caseSize FROM skus ORDER BY id")
    .all() as { id: string; caseSize: number }[];
  const stores = db.prepare("SELECT id FROM stores ORDER BY id").all() as { id: string }[];
  const grades = db
    .prepare(
      "SELECT id, tank_gallons AS tank, reserve_fraction AS reserve FROM fuel_grades ORDER BY id",
    )
    .all() as { id: string; tank: number; reserve: number }[];

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM promotions").run();
    const insPromo = db.prepare(
      "INSERT INTO promotions (sku_id, start_date, end_date, discount) VALUES (?,?,?,?)",
    );
    let promoRows = 0;
    for (const s of skus) {
      for (const p of promoPlan(s.id, dates)) {
        insPromo.run(s.id, p.start, p.end, +p.discount.toFixed(3));
        promoRows++;
      }
    }

    // On hand: between half a week and ~3.5 weeks of the last 28 days' average
    // sales, in whole cases — what a real shelf count looks like.
    db.prepare("DELETE FROM inventory_on_hand").run();
    const insInv = db.prepare(
      "INSERT INTO inventory_on_hand (store_id, sku_id, counted_on, units) VALUES (?,?,?,?)",
    );
    const avgSales = db.prepare(
      `SELECT AVG(units_sold) AS avg FROM daily_item_sales
       WHERE store_id = ? AND sku_id = ? AND date > ?`,
    );
    for (const st of stores) {
      for (const s of skus) {
        const { avg } = avgSales.get(st.id, s.id, addDays(asOf, -29)) as { avg: number | null };
        const rand = mulberry32(hashSeed(`onhand:${s.id}:${st.id}`));
        const units = (avg ?? 0) * (0.5 + rand() * 24);
        insInv.run(st.id, s.id, span.last, Math.max(0, Math.round(units / s.caseSize) * s.caseSize));
      }
    }

    // Tank level: reserve plus 18–92% of the usable volume, to the nearest 50 gal.
    db.prepare("DELETE FROM tank_levels").run();
    const insTank = db.prepare(
      "INSERT INTO tank_levels (store_id, grade_id, read_on, gallons) VALUES (?,?,?,?)",
    );
    for (const st of stores) {
      for (const g of grades) {
        const rand = mulberry32(hashSeed(`tank:${g.id}:${st.id}`));
        const usable = g.tank * (1 - g.reserve);
        const gallons = g.tank * g.reserve + usable * (0.18 + rand() * 0.74);
        insTank.run(st.id, g.id, span.last, Math.round(gallons / 50) * 50);
      }
    }
    return promoRows;
  });

  const promoRows = tx();
  return {
    asOf,
    promoRows,
    inventoryRows: stores.length * skus.length,
    tankRows: stores.length * grades.length,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const db = new Database(path.join(process.cwd(), "data", "forecast.db"));
  const r = seedOps(db);

  // Cross-check: every promo day in sales history must fall inside a planned promo.
  const mismatch = db
    .prepare(
      `SELECT COUNT(*) AS n FROM daily_item_sales s
       WHERE (s.on_promo = 1) <> EXISTS (
         SELECT 1 FROM promotions p
         WHERE p.sku_id = s.sku_id AND s.date BETWEEN p.start_date AND p.end_date)`,
    )
    .get() as { n: number };
  db.close();

  console.log(`Promotions: ${r.promoRows} planned promos`);
  console.log(`On-hand inventory: ${r.inventoryRows} rows · tank levels: ${r.tankRows} rows`);
  console.log(`Sales days whose promo flag disagrees with the plan: ${mismatch.n}`);
  if (mismatch.n > 0) process.exit(1);
}
