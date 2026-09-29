import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.join(process.cwd(), "data", "forecast.db"), { readonly: true });

console.log("=== STORES ===");
console.table(db.prepare("SELECT id, name, format, history_start FROM stores").all());

console.log("\n=== DATE RANGES PER STORE (item sales) ===");
console.table(
  db
    .prepare(
      `SELECT store_id, MIN(date) as first_date, MAX(date) as last_date,
              COUNT(DISTINCT date) as days, COUNT(*) as total_rows
       FROM daily_item_sales GROUP BY store_id`,
    )
    .all(),
);

console.log("\n=== SAMPLE ITEM SALES (s-101, bev-001, last 5 days) ===");
console.table(
  db
    .prepare(
      `SELECT date, units_sold, on_promo, discount, price_index
       FROM daily_item_sales
       WHERE store_id = 's-101' AND sku_id = 'bev-001'
       ORDER BY date DESC LIMIT 5`,
    )
    .all(),
);

console.log("\n=== FUEL SALES RANGE PER STORE (regular only) ===");
console.table(
  db
    .prepare(
      `SELECT store_id, MIN(date) as first_date, MAX(date) as last_date,
              COUNT(*) as days, ROUND(AVG(gallons_sold)) as avg_gallons,
              ROUND(AVG(street_price), 3) as avg_price
       FROM daily_fuel_sales WHERE grade_id = 'reg' GROUP BY store_id`,
    )
    .all(),
);

console.log("\n=== HOLIDAYS IN WEATHER TABLE ===");
console.table(
  db
    .prepare(
      `SELECT date, holiday, holiday_weight, ROUND(temp_f, 1) as temp_f
       FROM daily_weather WHERE holiday IS NOT NULL ORDER BY date LIMIT 10`,
    )
    .all(),
);

console.log("\n=== EVENTS ===");
console.table(
  db.prepare("SELECT id, start_date, end_date, label, kind, effect FROM events").all(),
);

console.log("\n=== CATEGORY TOTALS (s-101, last 30 days) ===");
console.table(
  db
    .prepare(
      `SELECT c.short_name as category, SUM(d.units_sold) as units,
              ROUND(SUM(d.units_sold * s.unit_price * d.price_index)) as revenue
       FROM daily_item_sales d
       JOIN skus s ON s.id = d.sku_id
       JOIN categories c ON c.id = s.category_id
       WHERE d.store_id = 's-101'
         AND d.date >= date('2026-09-26', '-30 days')
       GROUP BY c.id
       ORDER BY units DESC`,
    )
    .all(),
);

db.close();
