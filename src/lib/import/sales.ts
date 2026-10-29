/**
 * Bring-your-own sales history.
 *
 * A POS export (CSV) comes in; a column mapping says which column is the
 * date, the item, the units, and optionally the store, category, price and
 * promo flag. Rows are aggregated to one per store, item and day, and written
 * into the same tables the forecast already reads, so nothing downstream
 * knows the numbers came from a file.
 *
 * Missing days are left out: the series builder already reads a gap as a
 * zero-sales day. Negative units (returns) count as zero.
 */

import { getDb, getWritableDb } from "../db";
import { ensureSchema } from "../db/migrate";
import { parseCsv, type ParsedCsv } from "./csv";
import type {
  Assessment,
  DataSummary,
  DateDetect,
  DateFormat,
  ImportResult,
  Preview,
  SalesField,
  SalesMapping,
} from "./types";

export type * from "./types";
export { SALES_FIELDS } from "./types";

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

const GUESS: [SalesField, RegExp][] = [
  ["date", /^(date|day|sale.?date|business.?date|trans.?date|period)$|date/i],
  ["units", /^(qty|quantity|units?|units?.?sold|qty.?sold|sold|volume|count)$|qty|quantit|units/i],
  ["item", /^(sku|plu|upc|item.?(id|code|no|number)|product.?(id|code)|article|code|barcode)$|sku|plu|upc|item.?code|product.?code/i],
  ["itemName", /^(item|product|description|item.?name|product.?name|name|desc)$|desc|name/i],
  ["store", /store|site|location|branch|shop|outlet/i],
  ["category", /categor|dept|department|group|class/i],
  ["price", /price|unit.?amount|rate/i],
  ["promo", /promo|on.?deal|deal|offer/i],
  ["discount", /discount|markdown|off/i],
];

/** Best-guess column for each field from the header names. */
export function guessMapping(columns: string[]): Partial<Record<SalesField, string>> {
  const out: Partial<Record<SalesField, string>> = {};
  const taken = new Set<string>();
  for (const [field, re] of GUESS) {
    const hit = columns.find((c) => !taken.has(c) && re.test(c.trim()));
    if (hit) {
      out[field] = hit;
      taken.add(hit);
    }
  }
  // "Item" alone with no separate code column is the code.
  if (!out.item && out.itemName) {
    out.item = out.itemName;
    delete out.itemName;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

const SPLIT = /^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})(?:[ T].*)?$/;

export function detectDateFormat(values: string[]): DateDetect {
  const sample = values.map((v) => v.trim()).filter(Boolean).slice(0, 500);
  const example = sample[0] ?? "";
  if (!sample.length) return { format: "text", ambiguous: false, example, label: "unknown" };
  if (sample.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) {
    return { format: "ymd", ambiguous: false, example, label: "YYYY-MM-DD" };
  }
  if (sample.every((v) => /^\d{5}(\.\d+)?$/.test(v))) {
    return { format: "excel", ambiguous: false, example, label: "Excel serial number" };
  }
  const parts = sample.map((v) => SPLIT.exec(v)).filter(Boolean) as RegExpExecArray[];
  if (parts.length === sample.length) {
    if (parts.every((m) => m[1].length === 4)) {
      return { format: "ymd", ambiguous: false, example, label: "YYYY/MM/DD" };
    }
    const firstOver12 = parts.some((m) => Number(m[1]) > 12);
    const secondOver12 = parts.some((m) => Number(m[2]) > 12);
    if (firstOver12 && !secondOver12) return { format: "dmy", ambiguous: false, example, label: "DD/MM/YYYY" };
    if (secondOver12 && !firstOver12) return { format: "mdy", ambiguous: false, example, label: "MM/DD/YYYY" };
    // Nothing above 12 in either slot: the file cannot tell us.
    return { format: "mdy", ambiguous: true, example, label: "MM/DD/YYYY (could be DD/MM)" };
  }
  return { format: "text", ambiguous: false, example, label: "written out (e.g. 14 Mar 2026)" };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Parse one cell to ISO, or null when it is not a date in the chosen format. */
export function parseDate(raw: string, format: DateFormat, detected: DateDetect["format"]): string | null {
  const v = raw.trim();
  if (!v) return null;
  const f = format === "auto" ? detected : format;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (f === "excel" || /^\d{5}(\.\d+)?$/.test(v)) {
    const serial = Number(v);
    if (!Number.isFinite(serial)) return null;
    const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const m = SPLIT.exec(v);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    if (m[1].length === 4) return iso(a, b, c);
    if (f === "dmy") return iso(c, b, a);
    return iso(c, a, b);
  }
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                    */
/* -------------------------------------------------------------------------- */

export function previewFile(text: string, fileName: string): Preview {
  const parsed = parseCsv(text);
  const guess = guessMapping(parsed.columns);
  const dateCol = guess.date ? parsed.columns.indexOf(guess.date) : -1;
  return {
    fileName,
    delimiter: parsed.delimiter === "\t" ? "tab" : parsed.delimiter,
    columns: parsed.columns,
    sample: parsed.rows.slice(0, 8),
    rowCount: parsed.rows.length,
    guess,
    dateDetect: dateCol >= 0 ? detectDateFormat(parsed.rows.map((r) => r[dateCol] ?? "")) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Normalising rows                                                           */
/* -------------------------------------------------------------------------- */

type DayRow = {
  storeId: string;
  storeName: string;
  skuId: string;
  skuName: string;
  categoryId: string;
  categoryName: string;
  date: string;
  units: number;
  priceSum: number;
  priceN: number;
  promo: boolean;
  discount: number;
};

const TRUTHY = new Set(["1", "true", "yes", "y", "t", "promo", "on"]);

function slug(s: string): string {
  const out = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "unnamed";
}

function num(raw: string | undefined): number {
  if (raw == null) return NaN;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  return cleaned === "" ? NaN : Number(cleaned);
}

function normalise(parsed: ParsedCsv, mapping: SalesMapping) {
  const col = (name: string | null | undefined) =>
    name ? parsed.columns.indexOf(name) : -1;
  const ci = {
    date: col(mapping.date),
    item: col(mapping.item),
    units: col(mapping.units),
    store: col(mapping.store),
    itemName: col(mapping.itemName),
    category: col(mapping.category),
    price: col(mapping.price),
    promo: col(mapping.promo),
    discount: col(mapping.discount),
  };
  for (const k of ["date", "item", "units"] as const) {
    if (ci[k] < 0) throw new Error(`The ${k} column "${mapping[k]}" is not in the file.`);
  }
  const detected = detectDateFormat(parsed.rows.map((r) => r[ci.date] ?? "")).format;
  const singleStore = (mapping.storeName ?? "").trim() || "My store";

  const days = new Map<string, DayRow>();
  const dropped = { badDate: 0, badUnits: 0, blankItem: 0 };

  for (const r of parsed.rows) {
    const date = parseDate(r[ci.date] ?? "", mapping.dateFormat, detected);
    if (!date) {
      dropped.badDate++;
      continue;
    }
    const skuRaw = (r[ci.item] ?? "").trim();
    if (!skuRaw) {
      dropped.blankItem++;
      continue;
    }
    let units = num(r[ci.units]);
    if (!Number.isFinite(units)) {
      dropped.badUnits++;
      continue;
    }
    if (units < 0) units = 0;

    const storeName = ci.store >= 0 ? (r[ci.store] ?? "").trim() || singleStore : singleStore;
    const storeId = slug(storeName);
    const skuId = skuRaw;
    const skuName = ci.itemName >= 0 ? (r[ci.itemName] ?? "").trim() || skuRaw : skuRaw;
    const categoryName = ci.category >= 0 ? (r[ci.category] ?? "").trim() || "Uncategorised" : "Uncategorised";
    const price = ci.price >= 0 ? num(r[ci.price]) : NaN;
    const promo = ci.promo >= 0 ? TRUTHY.has((r[ci.promo] ?? "").trim().toLowerCase()) : false;
    let discount = ci.discount >= 0 ? num(r[ci.discount]) : NaN;
    if (Number.isFinite(discount)) {
      if (discount > 1) discount = discount / 100;
      discount = Math.max(0, Math.min(0.95, discount));
    }

    const key = `${storeId}\u0000${skuId}\u0000${date}`;
    const row = days.get(key);
    if (row) {
      row.units += units;
      if (Number.isFinite(price)) {
        row.priceSum += price;
        row.priceN++;
      }
      row.promo = row.promo || promo;
      if (Number.isFinite(discount)) row.discount = Math.max(row.discount, discount);
    } else {
      days.set(key, {
        storeId,
        storeName,
        skuId,
        skuName,
        categoryId: slug(categoryName),
        categoryName,
        date,
        units,
        priceSum: Number.isFinite(price) ? price : 0,
        priceN: Number.isFinite(price) ? 1 : 0,
        promo,
        discount: Number.isFinite(discount) ? discount : promo && ci.discount < 0 ? 0.1 : 0,
      });
    }
  }

  const rows = [...days.values()];
  for (const r of rows) r.units = Math.round(r.units);
  return { rows, dropped, detected };
}

export function assess(parsed: ParsedCsv, mapping: SalesMapping): Assessment {
  const { rows, dropped } = normalise(parsed, mapping);
  const dates = rows.map((r) => r.date).sort();
  const dateFrom = dates[0] ?? null;
  const dateTo = dates[dates.length - 1] ?? null;
  const days =
    dateFrom && dateTo
      ? Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000) + 1
      : 0;

  const byStore = new Map<string, { id: string; name: string; rows: number; items: Set<string> }>();
  const items = new Set<string>();
  for (const r of rows) {
    items.add(r.skuId);
    const s = byStore.get(r.storeId) ?? { id: r.storeId, name: r.storeName, rows: 0, items: new Set<string>() };
    s.rows++;
    s.items.add(r.skuId);
    byStore.set(r.storeId, s);
  }

  const warnings: string[] = [];
  const total = parsed.rows.length;
  const droppedTotal = dropped.badDate + dropped.badUnits + dropped.blankItem;
  if (!rows.length) warnings.push("No usable rows. Check the date, item and units columns.");
  if (dropped.badDate > 0)
    warnings.push(`${dropped.badDate.toLocaleString("en-US")} rows skipped: the date could not be read. Try another date format.`);
  if (dropped.badUnits > 0)
    warnings.push(`${dropped.badUnits.toLocaleString("en-US")} rows skipped: units were not a number.`);
  if (dropped.blankItem > 0)
    warnings.push(`${dropped.blankItem.toLocaleString("en-US")} rows skipped: blank item code.`);
  if (rows.length && days < 120)
    warnings.push(
      `${days} days of history. The forecast runs from about 8 weeks; scoring its accuracy needs about 4 months, so the accuracy panel will stay empty until then.`,
    );
  if (rows.length && days >= 120 && days < 400)
    warnings.push("Under a year of history: the model can learn the weekly shape and promotions, but not the time of year yet.");
  if (rows.length && droppedTotal / total > 0.2)
    warnings.push("More than a fifth of the rows were skipped. The mapping is probably off.");
  if (rows.length && !mapping.price)
    warnings.push("No price column: the model will not learn price sensitivity, and order costs will show as $0 until prices are added.");

  return {
    rowsRead: total,
    rowsKept: rows.length,
    rowsDropped: dropped,
    days,
    dateFrom,
    dateTo,
    stores: [...byStore.values()]
      .map((s) => ({ id: s.id, name: s.name, rows: s.rows, items: s.items.size }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    items: items.size,
    warnings,
  };
}

export function assessFile(text: string, mapping: SalesMapping): Assessment {
  return assess(parseCsv(text), mapping);
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

const REPLACE_TABLES = [
  "daily_item_sales",
  "daily_fuel_sales",
  "promotions",
  "inventory_on_hand",
  "tank_levels",
  "forecasts",
  "forecast_runs",
  "forecast_accuracy",
  "store_weather",
  "store_weather_normals",
  "external_events",
  "skus",
  "categories",
  "stores",
];

export function importSales(text: string, fileName: string, mapping: SalesMapping): ImportResult {
  const parsed = parseCsv(text);
  const { rows } = normalise(parsed, mapping);
  const summary = assess(parsed, mapping);
  if (!rows.length) throw new Error(summary.warnings[0] ?? "No usable rows in the file.");

  // Mean price per SKU over the whole file: the elasticity feature is the
  // day's price relative to it, and it becomes the SKU's listed price.
  const priceBySku = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (!r.priceN) continue;
    const p = priceBySku.get(r.skuId) ?? { sum: 0, n: 0 };
    p.sum += r.priceSum;
    p.n += r.priceN;
    priceBySku.set(r.skuId, p);
  }
  const meanPrice = (skuId: string) => {
    const p = priceBySku.get(skuId);
    return p && p.n ? p.sum / p.n : null;
  };

  const db = getWritableDb();
  try {
    ensureSchema(db);
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name),
    );

    const run = db.transaction(() => {
      if (mapping.mode === "replace") {
        for (const t of REPLACE_TABLES) if (tables.has(t)) db.exec(`DELETE FROM ${t}`);
      }

      const insCat = db.prepare(
        "INSERT INTO categories (id, name, short_name) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
      );
      const insStore = db.prepare(
        `INSERT INTO stores (id, name, format, traffic, fuel_skew, history_start)
         VALUES (?, ?, 'Urban', 1.0, 1.0, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           history_start = MIN(history_start, excluded.history_start)`,
      );
      const insSku = db.prepare(
        `INSERT INTO skus (id, name, category_id, unit_cost, unit_price, case_size, lead_time_days, shelf_life_days)
         VALUES (?, ?, ?, ?, ?, 1, 2, NULL)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           category_id = excluded.category_id,
           unit_price = CASE WHEN excluded.unit_price > 0 THEN excluded.unit_price ELSE unit_price END,
           unit_cost = CASE WHEN excluded.unit_price > 0 THEN excluded.unit_cost ELSE unit_cost END`,
      );
      const insSale = db.prepare(
        `INSERT OR REPLACE INTO daily_item_sales
           (store_id, sku_id, date, units_sold, on_promo, discount, price_index)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      const seenCat = new Set<string>();
      const seenStore = new Map<string, string>();
      const seenSku = new Set<string>();
      for (const r of rows) {
        if (!seenCat.has(r.categoryId)) {
          insCat.run(r.categoryId, r.categoryName, r.categoryName.slice(0, 14));
          seenCat.add(r.categoryId);
        }
        const first = seenStore.get(r.storeId);
        if (!first || r.date < first) seenStore.set(r.storeId, r.date);
        if (!seenSku.has(r.skuId)) {
          const mp = meanPrice(r.skuId);
          // Cost is unknown from a sales file; a 30% margin is the placeholder
          // the order-cost column runs on until real costs are loaded.
          insSku.run(r.skuId, r.skuName, r.categoryId, mp ? mp * 0.7 : 0, mp ?? 0);
          seenSku.add(r.skuId);
        }
      }
      for (const r of rows) {
        const name = rows.find((x) => x.storeId === r.storeId)?.storeName ?? r.storeId;
        if (seenStore.has(r.storeId)) {
          insStore.run(r.storeId, name, seenStore.get(r.storeId));
          seenStore.delete(r.storeId);
        }
      }
      for (const r of rows) {
        const mp = meanPrice(r.skuId);
        const dayPrice = r.priceN ? r.priceSum / r.priceN : null;
        const priceIndex = mp && dayPrice ? Math.max(0.2, Math.min(5, dayPrice / mp)) : 1;
        insSale.run(r.storeId, r.skuId, r.date, r.units, r.promo ? 1 : 0, r.discount, priceIndex);
      }

      db.prepare(
        `INSERT INTO import_log (kind, file_name, mode, rows, stores, items, date_from, date_to)
         VALUES ('sales', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(fileName, mapping.mode, rows.length, summary.stores.length, summary.items, summary.dateFrom, summary.dateTo);
    });
    run();
  } finally {
    db.close();
  }

  return { ...summary, fileName, mode: mapping.mode, importedAt: new Date().toISOString() };
}

/* -------------------------------------------------------------------------- */
/* What is on file                                                            */
/* -------------------------------------------------------------------------- */

export function getDataSummary(): DataSummary {
  const db = getDb();
  const has = (t: string) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const stores = db
    .prepare(
      `SELECT s.id, s.name,
              MIN(d.date) AS dateFrom, MAX(d.date) AS dateTo,
              COUNT(DISTINCT d.date) AS days, COUNT(DISTINCT d.sku_id) AS items, COUNT(d.date) AS rows,
              (SELECT COUNT(*) FROM daily_fuel_sales f WHERE f.store_id = s.id) AS fuelRows
       FROM stores s LEFT JOIN daily_item_sales d ON d.store_id = s.id
       GROUP BY s.id ORDER BY s.name`,
    )
    .all() as DataSummary["stores"];
  const imports = has("import_log")
    ? (db
        .prepare(
          `SELECT id, file_name AS fileName, mode, rows, stores, items,
                  date_from AS dateFrom, date_to AS dateTo, imported_at AS importedAt
           FROM import_log ORDER BY id DESC LIMIT 10`,
        )
        .all() as DataSummary["imports"])
    : [];
  const last = db
    .prepare("SELECT MAX(date) AS d FROM (SELECT date FROM daily_item_sales UNION ALL SELECT date FROM daily_fuel_sales)")
    .get() as { d: string | null };
  return { isDemo: imports.length === 0 && stores.length > 0, asOf: last.d, stores, imports };
}
