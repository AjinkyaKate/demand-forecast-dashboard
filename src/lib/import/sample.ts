/**
 * Sample sales history for people who want to try the forecast without
 * uploading their own export.
 *
 * The generator writes a CSV in the same shape as `public/sample-sales.csv`
 * and hands it to the ordinary importer, so the sample goes through exactly
 * the path a real file takes: mapping, normalising, SKU prices, promo lift,
 * and the import log. Nothing on the forecasting pages knows it is a sample.
 *
 * The data is deterministic for a given span (seeded PRNG), so two people who
 * pick "6 months" see the same numbers, and it ends yesterday so the forecast
 * starts today.
 */

import { gaussian, hashSeed, mulberry32, poisson } from "@/lib/rng";

export const SAMPLE_MONTHS = [6, 7, 8, 10] as const;
export type SampleMonths = (typeof SAMPLE_MONTHS)[number];

export function isSampleMonths(n: unknown): n is SampleMonths {
  return typeof n === "number" && (SAMPLE_MONTHS as readonly number[]).includes(n);
}

type Item = {
  sku: string;
  name: string;
  category: string;
  /** Mean units per day at the busier store. */
  base: number;
  price: number;
  /** Weekend demand relative to a weekday. */
  weekend: number;
  /** Summer (June–August) demand relative to the rest of the year. */
  summer: number;
  /** Takes part in promo windows. */
  promo: boolean;
};

const STORES = [
  { name: "Elm Street Market", scale: 1.0 },
  { name: "Route 1 Express", scale: 0.65 },
];

const ITEMS: Item[] = [
  { sku: "1234", name: "Cold Brew 12oz", category: "Beverages", base: 22, price: 3.49, weekend: 0.85, summer: 1.35, promo: true },
  { sku: "2201", name: "Spring Water 1L", category: "Beverages", base: 34, price: 1.49, weekend: 1.1, summer: 1.5, promo: true },
  { sku: "2240", name: "Energy Drink 16oz", category: "Beverages", base: 18, price: 2.99, weekend: 1.2, summer: 1.15, promo: true },
  { sku: "3010", name: "Potato Chips 2.5oz", category: "Snacks", base: 26, price: 1.99, weekend: 1.35, summer: 1.1, promo: true },
  { sku: "3055", name: "Chocolate Bar", category: "Snacks", base: 20, price: 1.79, weekend: 1.3, summer: 0.9, promo: true },
  { sku: "3090", name: "Trail Mix 6oz", category: "Snacks", base: 9, price: 3.29, weekend: 1.15, summer: 1.2, promo: false },
  { sku: "7788", name: "Breakfast Burrito", category: "Hot Food", base: 15, price: 4.99, weekend: 0.7, summer: 1.0, promo: false },
  { sku: "7801", name: "Hot Dog", category: "Hot Food", base: 17, price: 2.49, weekend: 1.25, summer: 1.2, promo: true },
  { sku: "7820", name: "Pizza Slice", category: "Hot Food", base: 13, price: 3.49, weekend: 1.4, summer: 1.05, promo: false },
  { sku: "4011", name: "Bananas (lb)", category: "Produce", base: 19, price: 0.69, weekend: 1.05, summer: 1.0, promo: false },
  { sku: "5120", name: "Whole Milk 1gal", category: "Dairy", base: 14, price: 4.29, weekend: 1.15, summer: 0.95, promo: false },
  { sku: "5140", name: "Yogurt Cup", category: "Dairy", base: 11, price: 1.29, weekend: 0.9, summer: 1.1, promo: true },
  { sku: "6010", name: "Ice Cream Pint", category: "Frozen", base: 8, price: 5.49, weekend: 1.5, summer: 1.8, promo: true },
  { sku: "8100", name: "Cigarettes (pack)", category: "Tobacco", base: 24, price: 9.75, weekend: 1.05, summer: 1.0, promo: false },
  { sku: "9050", name: "Windshield Washer 1gal", category: "Auto", base: 4, price: 3.99, weekend: 1.1, summer: 0.6, promo: false },
  { sku: "9220", name: "Phone Charger", category: "General", base: 2, price: 12.99, weekend: 1.2, summer: 1.0, promo: false },
];

/** Public holidays in the span, with how much they lift snacks and drinks. */
function holidayLift(d: Date): number {
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const dow = d.getUTCDay();
  if (m === 7 && day === 4) return 1.6; // Independence Day
  if (m === 5 && dow === 1 && day >= 25) return 1.4; // Memorial Day
  if (m === 9 && dow === 1 && day <= 7) return 1.4; // Labor Day
  if (m === 11 && dow === 4 && day >= 22 && day <= 28) return 1.25; // Thanksgiving
  if (m === 12 && (day === 24 || day === 31)) return 1.3;
  if (m === 12 && day === 25) return 0.5; // closed most of the day
  if (m === 1 && day === 1) return 0.7;
  return 1;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

export type SampleCsv = { text: string; fileName: string; dateFrom: string; dateTo: string; days: number };

/**
 * A CSV covering `months` calendar months ending yesterday, in the same
 * columns as `public/sample-sales.csv`.
 */
export function buildSampleCsv(months: SampleMonths, today = new Date()): SampleCsv {
  const end = addDays(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())), -1);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - months);
  start.setUTCDate(start.getUTCDate() + 1);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

  const rand = mulberry32(hashSeed(`sample-${months}-${iso(end)}`));

  // Promo calendar: a 10-day window about every six weeks, on a rotating
  // third of the promo-eligible items, 15–25% off.
  const promoItems = ITEMS.filter((i) => i.promo);
  const promo = new Map<string, number>(); // `${sku}|${date}` -> discount
  let cursor = 14 + Math.floor(rand() * 10);
  let wave = 0;
  while (cursor < days) {
    const discount = 0.15 + Math.round(rand() * 2) * 0.05;
    for (let k = 0; k < promoItems.length; k++) {
      if (k % 3 !== wave % 3) continue;
      for (let t = 0; t < 10 && cursor + t < days; t++) {
        promo.set(`${promoItems[k].sku}|${iso(addDays(start, cursor + t))}`, discount);
      }
    }
    cursor += 35 + Math.floor(rand() * 14);
    wave++;
  }

  // A slow trend per item so the forecast has something to pick up, and a
  // few days of bad weather that pull footfall down across the store.
  const trend = new Map(ITEMS.map((i) => [i.sku, (rand() - 0.4) * 0.3]));
  const weatherDip = new Set<number>();
  for (let n = 0; n < Math.max(2, Math.round(days / 40)); n++) {
    const at = Math.floor(rand() * days);
    weatherDip.add(at);
    if (rand() < 0.5) weatherDip.add(at + 1);
  }

  const lines = ["Date,Store,SKU,Item,Category,Qty Sold,Unit Price,On Promo,Discount"];
  for (let t = 0; t < days; t++) {
    const d = addDays(start, t);
    const date = iso(d);
    const dow = d.getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const month = d.getUTCMonth() + 1;
    const summer = month >= 6 && month <= 8;
    const hol = holidayLift(d);
    const dip = weatherDip.has(t) ? 0.7 : 1;
    const progress = t / Math.max(1, days - 1);
    for (const store of STORES) {
      for (const item of ITEMS) {
        const disc = promo.get(`${item.sku}|${date}`) ?? 0;
        let mean = item.base * store.scale;
        if (weekend) mean *= item.weekend;
        if (summer) mean *= item.summer;
        mean *= 1 + (trend.get(item.sku) ?? 0) * progress;
        mean *= dip;
        if (hol !== 1) mean *= item.category === "Snacks" || item.category === "Beverages" || item.category === "Hot Food" ? hol : hol < 1 ? hol : 1.05;
        if (disc) mean *= 1 + disc * 2.2; // promo lift: elasticity ~2.2
        mean *= Math.max(0.3, 1 + 0.08 * gaussian(rand)); // day noise
        const units = poisson(rand, mean);
        const price = disc ? Math.round(item.price * (1 - disc) * 100) / 100 : item.price;
        lines.push(
          `${date},${store.name},${item.sku},${item.name},${item.category},${units},${price.toFixed(2)},${disc ? "Yes" : "No"},${disc ? Math.round(disc * 100) : 0}`,
        );
      }
    }
  }

  return {
    text: lines.join("\n") + "\n",
    fileName: `sample-sales-${months}-months.csv`,
    dateFrom: iso(start),
    dateTo: iso(end),
    days,
  };
}

/** The mapping the sample CSV is written for. */
export const SAMPLE_MAPPING = {
  date: "Date",
  item: "SKU",
  units: "Qty Sold",
  store: "Store",
  itemName: "Item",
  category: "Category",
  price: "Unit Price",
  promo: "On Promo",
  discount: "Discount",
  dateFormat: "ymd" as const,
};
