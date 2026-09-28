/**
 * Synthetic demand generator.
 *
 * Builds a two-year daily history per store for every SKU and fuel grade out
 * of effects a real C-store actually experiences: annual seasonality, a weekday
 * shape, a compounding trend, promotions, weather, holidays, street price, and
 * a log of dated operational events.
 *
 * The generator also emits the *observable* feature columns (promo flag,
 * holiday weight, temperature, price index). Those — and only those — are what
 * the forecasting and driver models are allowed to read. The latent shape
 * parameters in the catalog never leave this file.
 */

import {
  AS_OF,
  CATEGORIES,
  FIXED_HOLIDAYS,
  FUEL_GRADES,
  HISTORY_DAYS,
  SKUS,
  STORE_BY_ID,
  type CategoryId,
  type FuelGradeId,
  type Sku,
  type StoreId,
} from "./catalog";
import { addDays, dayOfWeek, daysBetween, parseISO, toISO } from "../format";
import { gaussian, hashSeed, mulberry32, poisson } from "../rng";

/** Days of future calendar generated beyond AS_OF, so the forecast window has
 *  known feature values (holidays, promo plan, weather normals). */
export const FUTURE_DAYS = 60;

export type DayCtx = {
  date: string;
  /** 0 = first day of history. */
  t: number;
  /** Day of year, 1-366. */
  doy: number;
  /** 0 = Sunday. */
  dow: number;
  isWeekend: boolean;
  tempF: number;
  /** Departure from the seasonal normal, °F. The part that carries signal. */
  tempAnomaly: number;
  holiday: string | null;
  /** 0 when not a holiday; the holiday's traffic weight otherwise. */
  holidayWeight: number;
  /** True for the day before a weighted holiday — the real stock-up day. */
  preHoliday: boolean;
  /** True once the date is past AS_OF. */
  isFuture: boolean;
};

export type OpsEvent = {
  id: string;
  start: string;
  end: string;
  label: string;
  /** What an operator would file it under. */
  kind: "weather" | "traffic" | "equipment" | "supply" | "competition" | "local";
  /** Which series it touches. */
  scope: "all" | "fuel" | "inside" | CategoryId[];
  /** Multiplicative effect applied inside the window. */
  effect: number;
  note: string;
};

/* -------------------------------------------------------------------------- */
/* Calendar                                                                   */
/* -------------------------------------------------------------------------- */

/** Nth weekday of a month, e.g. nthDow(2026, 11, 4, 4) = 4th Thursday of Nov. */
function nthDow(year: number, month: number, dow: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (dow - first.getUTCDay() + 7) % 7;
  return toISO(new Date(Date.UTC(year, month - 1, 1 + shift + (n - 1) * 7)));
}

/** Last given weekday of a month, e.g. Memorial Day. */
function lastDow(year: number, month: number, dow: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  const shift = (last.getUTCDay() - dow + 7) % 7;
  return toISO(new Date(Date.UTC(year, month - 1, last.getUTCDate() - shift)));
}

function holidayMap(years: number[]): Map<string, { name: string; weight: number }> {
  const m = new Map<string, { name: string; weight: number }>();
  for (const y of years) {
    for (const h of FIXED_HOLIDAYS) {
      m.set(toISO(new Date(Date.UTC(y, h.month - 1, h.day))), {
        name: h.name,
        weight: h.weight,
      });
    }
    m.set(lastDow(y, 5, 1), { name: "Memorial Day", weight: 0.95 });
    m.set(nthDow(y, 9, 1, 1), { name: "Labor Day", weight: 0.95 });
    m.set(nthDow(y, 11, 4, 4), { name: "Thanksgiving", weight: 0.85 });
    m.set(nthDow(y, 2, 1, 3), { name: "Presidents' Day", weight: 0.35 });
    m.set(nthDow(y, 1, 1, 3), { name: "MLK Day", weight: 0.3 });
    // Super Bowl Sunday — the single biggest snack-and-beer day of the year.
    m.set(nthDow(y, 2, 0, 2), { name: "Super Bowl Sunday", weight: 0.8 });
  }
  return m;
}

/** Seasonal-normal temperature for a temperate US region, °F. */
function tempNormal(doy: number): number {
  return 54 - 24 * Math.cos((2 * Math.PI * (doy - 15)) / 365);
}

function dayOfYear(iso: string): number {
  const d = parseISO(iso);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86400000) + 1;
}

let calendarCache: DayCtx[] | null = null;

/** The shared calendar: HISTORY_DAYS of history ending the day before AS_OF,
 *  then FUTURE_DAYS of known-ahead context. */
export function getCalendar(): DayCtx[] {
  if (calendarCache) return calendarCache;

  const start = addDays(AS_OF, -HISTORY_DAYS);
  const total = HISTORY_DAYS + FUTURE_DAYS;
  const years = new Set<number>();
  for (let i = 0; i <= total; i++) {
    years.add(parseISO(addDays(start, i)).getUTCFullYear());
  }
  const holidays = holidayMap([...years]);

  const rand = mulberry32(hashSeed("weather-v1"));
  const days: DayCtx[] = [];
  let anomaly = 0;

  for (let i = 0; i < total; i++) {
    const date = addDays(start, i);
    const doy = dayOfYear(date);
    const dow = dayOfWeek(date);
    const isFuture = date >= AS_OF;
    const normal = tempNormal(doy);

    // AR(1) weather anomaly. Beyond AS_OF it decays toward normal, which is
    // what a real forward weather signal looks like — persistence, then normals.
    if (isFuture) {
      anomaly *= 0.78;
    } else {
      anomaly = 0.82 * anomaly + gaussian(rand) * 5.4;
    }

    const h = holidays.get(date);
    const next = holidays.get(addDays(date, 1));

    days.push({
      date,
      t: i,
      doy,
      dow,
      isWeekend: dow === 0 || dow === 6,
      tempF: Math.round((normal + anomaly) * 10) / 10,
      tempAnomaly: Math.round(anomaly * 10) / 10,
      holiday: h?.name ?? null,
      holidayWeight: h?.weight ?? 0,
      preHoliday: (next?.weight ?? 0) >= 0.8,
      isFuture,
    });
  }

  calendarCache = days;
  return days;
}

/** Index of the first future day — the forecast origin. */
export function forecastOriginIndex(): number {
  return HISTORY_DAYS;
}

/* -------------------------------------------------------------------------- */
/* Operational event log                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Dated events an operator would have in a log. These create the anomalies the
 * detector later finds. The detector does NOT read this list — it finds
 * outliers statistically, and the UI then joins on date to name a likely cause.
 */
export const OPS_EVENTS: OpsEvent[] = [
  {
    id: "ev-01",
    start: "2025-07-18",
    end: "2025-07-20",
    label: "Riverside Music Festival",
    kind: "local",
    scope: "all",
    effect: 1.48,
    note: "Three-day event 2 miles from Store 101. Inside and fuel both surged.",
  },
  {
    id: "ev-02",
    start: "2025-11-06",
    end: "2025-11-14",
    label: "Route 9 lane closure",
    kind: "traffic",
    scope: "all",
    effect: 0.66,
    note: "Northbound resurfacing diverted commuter traffic for nine days.",
  },
  {
    id: "ev-03",
    start: "2026-01-22",
    end: "2026-01-25",
    label: "Winter storm Ezra",
    kind: "weather",
    scope: "all",
    effect: 0.74,
    note: "Regional travel advisory. Fuel volume fell; hot food and auto rose.",
  },
  {
    id: "ev-04",
    start: "2026-01-22",
    end: "2026-01-25",
    label: "Winter storm Ezra — stock-up",
    kind: "weather",
    scope: ["hot-food", "auto-nonfood", "dairy-grocery"],
    effect: 1.62,
    note: "Storm pull-forward on coffee, washer fluid, milk and bread.",
  },
  {
    id: "ev-05",
    start: "2026-03-05",
    end: "2026-09-25",
    label: "Competitor opened on Route 9",
    kind: "competition",
    scope: "all",
    effect: 0.91,
    note: "New 12-pump site 0.8 miles south. Persistent step-down, not a blip.",
  },
  {
    id: "ev-06",
    start: "2026-05-14",
    end: "2026-05-17",
    label: "Walk-in cooler compressor failure",
    kind: "equipment",
    scope: ["beverages", "beer-wine", "dairy-grocery"],
    effect: 0.42,
    note: "Cooler down 3.5 days awaiting a compressor. Cold sales collapsed.",
  },
  {
    id: "ev-07",
    start: "2026-06-26",
    end: "2026-07-06",
    label: "Independence Day travel surge",
    kind: "traffic",
    scope: "all",
    effect: 1.24,
    note: "Extended holiday corridor traffic across all four sites.",
  },
  {
    id: "ev-08",
    start: "2026-08-11",
    end: "2026-08-13",
    label: "Snack DSD delivery miss",
    kind: "supply",
    scope: ["salty-snacks", "candy"],
    effect: 0.38,
    note: "Direct-store-delivery vendor skipped two cycles. Shelves ran empty.",
  },
  {
    id: "ev-09",
    start: "2026-09-04",
    end: "2026-09-10",
    label: "Street price war",
    kind: "competition",
    scope: "fuel",
    effect: 1.31,
    note: "Matched a 22c undercut for a week. Volume up, margin compressed.",
  },
  {
    id: "ev-10",
    start: "2026-02-19",
    end: "2026-02-21",
    label: "POS outage",
    kind: "equipment",
    scope: "inside",
    effect: 0.55,
    note: "Card processing down intermittently; inside baskets abandoned.",
  },
];

function eventMultiplier(
  date: string,
  target: "fuel" | "inside",
  category: CategoryId | null,
): { mult: number; hits: OpsEvent[] } {
  let mult = 1;
  const hits: OpsEvent[] = [];
  for (const ev of OPS_EVENTS) {
    if (date < ev.start || date > ev.end) continue;
    const applies =
      ev.scope === "all" ||
      ev.scope === target ||
      (Array.isArray(ev.scope) && category !== null && ev.scope.includes(category));
    if (!applies) continue;
    mult *= ev.effect;
    hits.push(ev);
  }
  return { mult, hits };
}

/** An event running longer than this is a standing condition, not an incident. */
export const STRUCTURAL_DAYS = 30;

export function eventLengthDays(ev: OpsEvent): number {
  return daysBetween(ev.start, ev.end) + 1;
}

/**
 * Events overlapping a date, split into acute causes and standing context.
 *
 * A six-month competitor opening overlaps every anomaly in the window, so
 * date-overlap alone would name it as the cause of all of them. Short windows
 * are what actually explain a single bad Tuesday; long ones are background,
 * and are surfaced separately so they still inform without crowding out the
 * real answer. Acute events are returned shortest-first.
 */
export function eventsOn(date: string): {
  causes: OpsEvent[];
  context: OpsEvent[];
} {
  const hits = OPS_EVENTS.filter((ev) => date >= ev.start && date <= ev.end);
  const causes = hits
    .filter((ev) => eventLengthDays(ev) <= STRUCTURAL_DAYS)
    .sort((a, b) => eventLengthDays(a) - eventLengthDays(b));
  const context = hits.filter((ev) => eventLengthDays(ev) > STRUCTURAL_DAYS);
  return { causes, context };
}

/* -------------------------------------------------------------------------- */
/* Promotions                                                                 */
/* -------------------------------------------------------------------------- */

export type Promo = { start: string; end: string; discount: number };

/** Promo calendar per SKU. Windows are planned ahead, so the future window is
 *  populated too — operators know their own promo plan. */
function promoCalendar(sku: Sku, cal: DayCtx[]): Promo[] {
  const rand = mulberry32(hashSeed(`promo:${sku.id}`));
  const promos: Promo[] = [];
  let t = Math.floor(rand() * 30);
  while (t < cal.length - 7) {
    const len = 7 + Math.floor(rand() * 8); // 7–14 day windows
    const discount = 0.12 + rand() * 0.18;
    promos.push({
      start: cal[t].date,
      end: cal[Math.min(t + len - 1, cal.length - 1)].date,
      discount: Math.round(discount * 100) / 100,
    });
    t += len + 28 + Math.floor(rand() * 42); // 4–10 weeks between promos
  }
  return promos;
}

/* -------------------------------------------------------------------------- */
/* Street fuel price                                                          */
/* -------------------------------------------------------------------------- */

const GRADE_SPREAD: Record<FuelGradeId, number> = {
  reg: 0,
  mid: 0.38,
  prem: 0.74,
  diesel: 0.52,
};

let priceCache: Map<string, number[]> | null = null;

/** Street price per gallon, per grade. Regular is a mean-reverting random walk
 *  with a slow drift; the other grades ride it at a fixed spread. */
export function getFuelPrices(): Map<FuelGradeId, number[]> {
  const cal = getCalendar();
  if (!priceCache) {
    const rand = mulberry32(hashSeed("fuel-price-v1"));
    const reg: number[] = [];
    let p = 3.28;
    let drift = 0;
    for (let i = 0; i < cal.length; i++) {
      const d = cal[i];
      if (d.isFuture) {
        // Forward price is held at the last observed level — an operator
        // forecasts volume under today's price, not a guessed one.
        reg.push(reg[reg.length - 1]);
        continue;
      }
      drift = 0.965 * drift + gaussian(rand) * 0.012;
      // Mild mean reversion toward a seasonal base (summer blend costs more).
      const seasonal = 3.3 + 0.16 * Math.sin((2 * Math.PI * (d.doy - 80)) / 365);
      p += drift + (seasonal - p) * 0.035;
      // Price-war week: matched undercut.
      const war = d.date >= "2026-09-04" && d.date <= "2026-09-10" ? -0.22 : 0;
      reg.push(Math.round((p + war) * 1000) / 1000);
    }
    priceCache = new Map([["reg", reg]]);
  }
  const reg = priceCache.get("reg")!;
  const out = new Map<FuelGradeId, number[]>();
  for (const g of FUEL_GRADES) {
    out.set(
      g.id,
      reg.map((v) => Math.round((v + GRADE_SPREAD[g.id]) * 1000) / 1000),
    );
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Series                                                                     */
/* -------------------------------------------------------------------------- */

/** One SKU's daily series at one store, with its observable feature columns. */
export type ItemSeries = {
  skuId: string;
  storeId: StoreId;
  dates: string[];
  /** Units sold. Length = history only. */
  units: number[];
  /** Feature columns span history + future. */
  onPromo: boolean[];
  discount: number[];
  priceIndex: number[];
};

export type FuelSeries = {
  gradeId: FuelGradeId;
  storeId: StoreId;
  dates: string[];
  gallons: number[];
  price: number[];
  /** Price relative to the trailing 90-day mean — the elasticity feature. */
  priceIndex: number[];
};

const yearWave = (doy: number, peak: number) =>
  Math.cos((2 * Math.PI * (doy - peak)) / 365);

const itemCache = new Map<string, ItemSeries[]>();
const fuelCache = new Map<string, FuelSeries[]>();

export function getItemSeries(storeId: StoreId): ItemSeries[] {
  const hit = itemCache.get(storeId);
  if (hit) return hit;

  const cal = getCalendar();
  const store = STORE_BY_ID.get(storeId)!;
  const out: ItemSeries[] = [];

  for (const sku of SKUS) {
    const rand = mulberry32(hashSeed(`${sku.id}:${storeId}`));
    const promos = promoCalendar(sku, cal);
    const promoOn = new Array<boolean>(cal.length).fill(false);
    const discount = new Array<number>(cal.length).fill(0);
    for (const p of promos) {
      for (let i = 0; i < cal.length; i++) {
        if (cal[i].date >= p.start && cal[i].date <= p.end) {
          promoOn[i] = true;
          discount[i] = p.discount;
        }
      }
    }

    // Two discrete shelf-price increases over the two years.
    const bump1 = Math.floor(cal.length * 0.28);
    const bump2 = Math.floor(cal.length * 0.71);

    const units: number[] = [];
    const priceIndex: number[] = [];
    const dates: string[] = [];

    for (let i = 0; i < cal.length; i++) {
      const d = cal[i];
      dates.push(d.date);

      const shelf = 1 + (i >= bump1 ? 0.019 : 0) + (i >= bump2 ? 0.024 : 0);
      const effective = shelf * (1 - discount[i]);
      priceIndex.push(Math.round(effective * 1000) / 1000);

      if (d.isFuture) continue; // units are history only

      const years = i / 365;
      const trend = Math.pow(1 + sku.shape.trend, years);
      const season = 1 + sku.shape.yearAmp * yearWave(d.doy, sku.shape.yearPeak);
      const weekday = sku.shape.dow[d.dow];
      const promo = promoOn[i] ? sku.shape.promoLift : 1;
      const holiday =
        d.holidayWeight > 0
          ? 1 + (sku.shape.holidayLift - 1) * d.holidayWeight
          : d.preHoliday
            ? 1 + (sku.shape.holidayLift - 1) * 0.55
            : 1;
      const weather = 1 + (sku.shape.tempCoef * d.tempAnomaly) / 100;
      const { mult: evMult } = eventMultiplier(d.date, "inside", sku.category);

      const lambda =
        sku.shape.base *
        store.traffic *
        trend *
        Math.max(0.05, season) *
        weekday *
        promo *
        holiday *
        Math.max(0.2, weather) *
        evMult;

      units.push(poisson(rand, Math.max(0, lambda)));
    }

    out.push({
      skuId: sku.id,
      storeId,
      dates,
      units,
      onPromo: promoOn,
      discount,
      priceIndex,
    });
  }

  itemCache.set(storeId, out);
  return out;
}

export function getFuelSeries(storeId: StoreId): FuelSeries[] {
  const hit = fuelCache.get(storeId);
  if (hit) return hit;

  const cal = getCalendar();
  const store = STORE_BY_ID.get(storeId)!;
  const prices = getFuelPrices();
  const out: FuelSeries[] = [];

  for (const grade of FUEL_GRADES) {
    const rand = mulberry32(hashSeed(`fuel:${grade.id}:${storeId}`));
    const price = prices.get(grade.id)!;

    // Price index = price vs its own trailing 90-day mean. Volume responds to
    // a *change* in price, not its level, so this is the right feature.
    const priceIndex: number[] = [];
    for (let i = 0; i < price.length; i++) {
      const from = Math.max(0, i - 90);
      let sum = 0;
      for (let j = from; j <= i; j++) sum += price[j];
      priceIndex.push(price[i] / (sum / (i - from + 1)));
    }

    const gallons: number[] = [];
    const dates: string[] = [];

    for (let i = 0; i < cal.length; i++) {
      const d = cal[i];
      dates.push(d.date);
      if (d.isFuture) continue;

      const years = i / 365;
      const trend = Math.pow(1 + grade.shape.trend, years);
      const season = 1 + grade.shape.yearAmp * yearWave(d.doy, grade.shape.yearPeak);
      const weekday = grade.shape.dow[d.dow];
      const holiday =
        d.holidayWeight > 0
          ? 1 + (grade.shape.holidayLift - 1) * d.holidayWeight
          : d.preHoliday
            ? 1 + (grade.shape.holidayLift - 1) * 0.6
            : 1;
      const weather = 1 + (grade.shape.tempCoef * d.tempAnomaly) / 1000;
      // Constant-elasticity response to the price index.
      const priceEffect = Math.pow(priceIndex[i], grade.priceElasticity * 6);
      const { mult: evMult } = eventMultiplier(d.date, "fuel", null);

      const mean =
        grade.base *
        store.traffic *
        store.fuelSkew *
        trend *
        Math.max(0.1, season) *
        weekday *
        holiday *
        Math.max(0.5, weather) *
        priceEffect *
        evMult;

      // Gallons are continuous; noise is proportional.
      const noise = 1 + gaussian(rand) * 0.062;
      gallons.push(Math.max(0, Math.round(mean * Math.max(0.35, noise))));
    }

    out.push({
      gradeId: grade.id,
      storeId,
      dates,
      gallons,
      price,
      priceIndex: priceIndex.map((v) => Math.round(v * 10000) / 10000),
    });
  }

  fuelCache.set(storeId, out);
  return out;
}

/** Category totals for a store — the mix chart's source. */
export function categoryTotals(
  storeId: StoreId,
  fromIdx: number,
  toIdx: number,
): { id: CategoryId; name: string; short: string; units: number; revenue: number }[] {
  const series = getItemSeries(storeId);
  const bySku = new Map(series.map((s) => [s.skuId, s]));
  return CATEGORIES.map((c) => {
    let units = 0;
    let revenue = 0;
    for (const sku of SKUS) {
      if (sku.category !== c.id) continue;
      const s = bySku.get(sku.id);
      if (!s) continue;
      for (let i = fromIdx; i <= Math.min(toIdx, s.units.length - 1); i++) {
        units += s.units[i];
        revenue += s.units[i] * sku.unitPrice * s.priceIndex[i];
      }
    }
    return { id: c.id, name: c.name, short: c.short, units, revenue };
  });
}
