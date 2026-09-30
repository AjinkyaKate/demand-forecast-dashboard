/**
 * Item Forecasting workspace — everything the page needs, computed once.
 *
 * Every SKU is forecast from its own history and its own known future: its
 * planned promotions and price, the store's weather forecast, public
 * holidays, NWS weather alerts, and events near the store
 * (driver-forecast.ts). Per-store SKU fits are memoised because they are the
 * expensive part and don't depend on the horizon or the category filter.
 */

import type { CategoryId, ItemSeries, Sku, StoreId } from "../data/types";
import {
  getAsOf,
  getCalendar,
  getCategories,
  getItemSeries,
  getLocalEventDays,
  getNamedEvents,
  getOnHand,
  getSkus,
  memo,
  type LocalEventDay,
} from "../db/repository";
import type { Accuracy } from "../forecast/backtest";
import type { FeatureRow } from "../forecast/design";
import { forecastSeries, type ModelChoice, type OptionalGroup } from "../forecast/driver-forecast";
import type { ForecastPoint } from "../forecast/holt-winters";
import { detectAnomalies, groupAnomalies, type Anomaly } from "../forecast/anomalies";
import { fitDriversDetailed, type DriverModel } from "../forecast/drivers";
import { factorsFor, type ChartRowFactors } from "./factors";
import type { Filters } from "./types";
import { SERVICE_Z } from "./types";

const MAX_HORIZON = 30;

export type SkuFit = {
  sku: Sku;
  series: ItemSeries;
  points: ForecastPoint[];
  accuracy: Accuracy;
  /** Which model forecasts this SKU, chosen by backtest. */
  model: ModelChoice;
  /** Optional inputs its driver model kept (null when it couldn't be tested). */
  inputs: Record<OptionalGroup, boolean> | null;
  /** Units on hand at the latest count (inventory_on_hand). */
  onHand: number;
};

/**
 * log of a SKU's shelf price index on day i — the price with any promo
 * discount taken back out. Discounts already enter the model through the
 * promo columns; leaving them in the price too would count every promotion
 * twice and blur both effects.
 *
 * The index is snapped to whole-percent steps. The stored price index and
 * discount are each rounded, so dividing one by the other leaves ±0.1%
 * noise; a series whose only "price change" is that noise would otherwise
 * earn an enormous coefficient for it.
 */
export function shelfLogPrice(s: ItemSeries, i: number): number {
  const shelf = s.priceIndex[i] / Math.max(0.01, 1 - s.discount[i]);
  return Math.log(Math.round(shelf * 100) / 100);
}

/** The API event columns of a feature row: nearby attendance and NWS alerts. */
export function localFeatures(d: LocalEventDay | undefined) {
  return {
    localAttendance: Math.log1p((d?.attendance ?? 0) / 1000),
    schoolBreak: d?.schoolBreaks.length ? 1 : 0,
    alertWinter: d?.alerts.winter ? 1 : 0,
    alertHeat: d?.alerts.heat ? 1 : 0,
    alertStorm: d?.alerts.storm ? 1 : 0,
  };
}

export function getSkuFits(storeId: StoreId): SkuFit[] {
  return memo(`skufits:${storeId}`, () => {
    const cal = getCalendar(storeId, "items");
    const local = getLocalEventDays(storeId, cal);
    const skuById = new Map(getSkus().map((k) => [k.id, k]));
    const onHand = getOnHand(storeId);
    const out: SkuFit[] = [];
    for (const s of getItemSeries(storeId)) {
      const sku = skuById.get(s.skuId);
      if (!sku) continue;
      // This SKU's own known inputs, every day of history and the future.
      const feats: FeatureRow[] = cal.map((_, i) => ({
        promo: s.onPromo[i] ? 1 : 0,
        discount: s.discount[i],
        logPriceIndex: shelfLogPrice(s, i),
        ...localFeatures(local[i]),
      }));
      const r = forecastSeries(cal, feats, s.units, MAX_HORIZON);
      out.push({
        sku,
        series: s,
        points: r.points,
        accuracy: r.accuracy,
        model: r.model,
        inputs: r.inputs,
        onHand: onHand.get(sku.id) ?? 0,
      });
    }
    return out;
  });
}

/* -------------------------------------------------------------------------- */
/* Replenishment plan                                                         */
/* -------------------------------------------------------------------------- */

export type PlanStatus = "order-now" | "order-soon" | "healthy" | "overstocked";

export type SkuPlanRow = {
  sku: Sku;
  categoryName: string;
  /** Forecast units over the selected horizon. */
  horizonUnits: number;
  avgDaily: number;
  onHand: number;
  /** On hand ÷ average forecast daily demand. */
  daysOfSupply: number;
  /** Demand over the lead time plus safety stock. */
  reorderPoint: number;
  /** Order-up-to level: lead time + review period + safety stock. */
  targetStock: number;
  suggestedCases: number;
  suggestedUnits: number;
  /** Retail value of the suggested order. */
  orderCost: number;
  status: PlanStatus;
  /** Set when the SKU perishes before the suggested cover is sold through. */
  spoilageRisk: boolean;
  wape: number;
};

const REVIEW_DAYS = 7;

function planFor(fit: SkuFit, horizon: number, categoryShort: Map<string, string>): SkuPlanRow {
  const { sku, points, onHand } = fit;
  const lt = sku.leadTimeDays;

  const horizonUnits = points.slice(0, horizon).reduce((a, p) => a + p.mean, 0);
  const avgDaily = horizonUnits / horizon;

  // Demand over lead time, and over lead time + review period.
  const ltDemand = points.slice(0, lt).reduce((a, p) => a + p.mean, 0);
  const cover = Math.min(points.length, lt + REVIEW_DAYS);
  const coverDemand = points.slice(0, cover).reduce((a, p) => a + p.mean, 0);

  // Safety stock from the model's own interval width: (hi80 − mean) is
  // 1.2816σ, so σ per day falls straight out. Variances add over the lead
  // time, hence the root-sum-of-squares rather than a sum.
  const sigmaOf = (p: ForecastPoint) => Math.max(0, (p.hi80 - p.mean) / SERVICE_Z);
  const ltVar = points.slice(0, lt).reduce((a, p) => a + Math.pow(sigmaOf(p), 2), 0);
  const safety = SERVICE_Z * Math.sqrt(ltVar);

  const reorderPoint = ltDemand + safety;
  const targetStock = coverDemand + safety;
  const daysOfSupply = avgDaily > 0 ? onHand / avgDaily : Infinity;

  const shortfall = Math.max(0, targetStock - onHand);
  const suggestedCases = shortfall > 0 ? Math.ceil(shortfall / sku.caseSize) : 0;
  const suggestedUnits = suggestedCases * sku.caseSize;

  const status: PlanStatus =
    onHand <= reorderPoint
      ? daysOfSupply <= lt
        ? "order-now"
        : "order-soon"
      : daysOfSupply > (sku.shelfLifeDays ?? 60) || daysOfSupply > 35
        ? "overstocked"
        : "healthy";

  // A fresh SKU ordered to a cover longer than its shelf life will spoil.
  const totalCover = avgDaily > 0 ? (onHand + suggestedUnits) / avgDaily : Infinity;
  const spoilageRisk =
    sku.shelfLifeDays != null && Number.isFinite(totalCover) && totalCover > sku.shelfLifeDays;

  return {
    sku,
    categoryName: categoryShort.get(sku.category) ?? sku.category,
    horizonUnits,
    avgDaily,
    onHand,
    daysOfSupply,
    reorderPoint,
    targetStock,
    suggestedCases,
    suggestedUnits,
    orderCost: suggestedUnits * sku.unitCost,
    status,
    spoilageRisk,
    wape: fit.accuracy.wape,
  };
}

/* -------------------------------------------------------------------------- */
/* Workspace assembly                                                         */
/* -------------------------------------------------------------------------- */

export type { ChartRowFactors } from "./factors";

export type ChartRow = {
  date: string;
  actual: number | null;
  mean: number | null;
  lo80: number | null;
  hi80: number | null;
  lo95: number | null;
  hi95: number | null;
  anomaly?: {
    direction: "spike" | "drop";
    severity: "critical" | "serious" | "warning";
    deviation: number;
    cause: string | null;
  } | null;
  factors?: ChartRowFactors | null;
};

export type CategoryRow = {
  id: CategoryId;
  label: string;
  horizonUnits: number;
  priorUnits: number;
  delta: number;
  revenue: number;
};

/** Which model the headline forecast uses, and why. */
export type ModelInfo = {
  used: ModelChoice;
  /** Backtest error of each candidate on the headline series. */
  driverWape: number | null;
  hwWape: number | null;
  /** How many of the scoped series (SKUs / grades) use the driver model. */
  seriesOnDriver: number;
  seriesTotal: number;
  /** Optional inputs the headline driver model kept, when it could be tested. */
  inputs: Record<OptionalGroup, boolean> | null;
  /** How many scoped series (SKUs / grades) kept each optional input. */
  seriesUsing: Record<OptionalGroup, number>;
};

/** Count the scoped series whose driver model kept each optional input. */
export function countInputs(fits: { model: ModelChoice; inputs: Record<OptionalGroup, boolean> | null }[]) {
  const on = fits.filter((f) => f.model === "driver" && f.inputs);
  return {
    weather: on.filter((f) => f.inputs!.weather).length,
    alerts: on.filter((f) => f.inputs!.alerts).length,
    events: on.filter((f) => f.inputs!.events).length,
  };
}

export type ItemWorkspace = {
  asOf: string;
  scopeLabel: string;
  unit: string;
  /** Headline: forecast units over the horizon. */
  horizonTotal: number;
  horizonLo: number;
  horizonHi: number;
  /** Same-length prior window of actuals. */
  priorTotal: number;
  deltaVsPrior: number;
  accuracy: Accuracy;
  model: ModelInfo;
  chartRows: ChartRow[];
  /** 12 weekly buckets for the headline sparkline. */
  sparkline: number[];
  drivers: DriverModel;
  categories: CategoryRow[];
  plan: SkuPlanRow[];
  incidents: Anomaly[][];
  counts: { orderNow: number; orderSoon: number; overstocked: number; spoilage: number };
  orderValue: number;
  skuCount: number;
};

export function buildItemWorkspace(filters: Filters): ItemWorkspace {
  const cal = getCalendar(filters.storeId, "items");
  const fits = getSkuFits(filters.storeId);
  const events = getNamedEvents(filters.storeId);
  const categories = getCategories();
  const horizon = filters.horizon;

  const inScope =
    filters.categoryId === "all"
      ? fits
      : fits.filter((f) => f.sku.category === filters.categoryId);

  const histLen = inScope[0]?.series.units.length ?? fits[0]?.series.units.length ?? 0;
  const origin = histLen;

  // Aggregate actuals across the scoped SKUs.
  const actual = new Array<number>(histLen).fill(0);
  for (const f of inScope) {
    for (let i = 0; i < histLen; i++) actual[i] += f.series.units[i];
  }

  // Promo and shelf-price columns weighted by recent volume share.
  const weights = inScope.map((f) => {
    const v = f.series.units.slice(-90).reduce((a, b) => a + b, 0);
    return Math.max(1e-6, v);
  });
  const wSum = weights.reduce((a, b) => a + b, 0);
  const local = getLocalEventDays(filters.storeId, cal);
  const feats: FeatureRow[] = cal.map((_, i) => {
    let promo = 0;
    let discount = 0;
    let logPrice = 0;
    for (let k = 0; k < inScope.length; k++) {
      const w = weights[k] / wSum;
      promo += (inScope[k].series.onPromo[i] ? 1 : 0) * w;
      discount += inScope[k].series.discount[i] * w;
      logPrice += shelfLogPrice(inScope[k].series, i) * w;
    }
    return { promo, discount, logPriceIndex: logPrice, ...localFeatures(local[i]) };
  });

  // The headline series gets its own fit rather than a sum of SKU bands:
  // summing interval endpoints assumes every SKU misses in lockstep.
  const aggregate = forecastSeries(cal, feats, actual, horizon);

  const anomalies = detectAnomalies(cal.slice(0, histLen).map((d) => d.date), actual, aggregate.hwFit, {
    threshold: 3,
    events,
  });
  const anomalyByDate = new Map(anomalies.map((a) => [a.date, a]));

  // Tooltip effects: the forecast's own when the driver model is in use,
  // otherwise the attribution model's explanation of the number.
  const driverFit = fitDriversDetailed(cal, feats, actual, origin, origin + horizon - 1);
  const source = aggregate.driver ?? driverFit;
  const mode = aggregate.driver ? "model" : "explanation";
  const factors = (i: number, value: number) =>
    factorsFor({
      day: cal[i],
      value,
      effects: source.effectsAt(i),
      local: local[i] ?? null,
      correction: i >= origin && aggregate.driver ? aggregate.driver.correction(i - origin + 1) : 0,
      mode,
    });

  const chartRows: ChartRow[] = [];
  const from = Math.max(0, histLen - filters.horizon);

  for (let i = from; i < histLen; i++) {
    const a = anomalyByDate.get(cal[i].date);
    chartRows.push({
      date: cal[i].date,
      actual: actual[i],
      mean: null,
      lo80: null, hi80: null, lo95: null, hi95: null,
      anomaly: a
        ? {
            direction: a.direction,
            severity: a.severity,
            deviation: a.deviation,
            cause: a.causes[0]?.label ?? a.context[0]?.label ?? null,
          }
        : null,
      factors: factors(i, actual[i]),
    });
  }

  // Join history to forecast: repeat the last actual as the forecast's first
  // anchor so the two lines meet instead of leaving a visual gap.
  if (chartRows.length) {
    const last = chartRows[chartRows.length - 1];
    last.mean = last.actual;
    last.lo80 = last.actual;
    last.hi80 = last.actual;
    last.lo95 = last.actual;
    last.hi95 = last.actual;
  }

  for (let h = 0; h < horizon && origin + h < cal.length; h++) {
    const p = aggregate.points[h];
    const i = origin + h;
    chartRows.push({
      date: cal[i].date,
      actual: null,
      mean: p.mean,
      lo80: p.lo80, hi80: p.hi80,
      lo95: p.lo95, hi95: p.hi95,
      anomaly: null,
      factors: factors(i, p.mean),
    });
  }

  const horizonTotal = aggregate.points.slice(0, horizon).reduce((a, p) => a + p.mean, 0);
  const horizonLo = aggregate.points.slice(0, horizon).reduce((a, p) => a + p.lo80, 0);
  const horizonHi = aggregate.points.slice(0, horizon).reduce((a, p) => a + p.hi80, 0);
  const priorTotal = actual.slice(histLen - horizon).reduce((a, b) => a + b, 0);

  const drivers = driverFit.model;

  // Category rollup — forecast horizon vs the same-length prior window.
  const categoryRows: CategoryRow[] = categories.map((c) => {
    const members = fits.filter((f) => f.sku.category === c.id);
    let horizonUnits = 0;
    let priorUnits = 0;
    let revenue = 0;
    for (const f of members) {
      const fh = f.points.slice(0, horizon).reduce((a, p) => a + p.mean, 0);
      horizonUnits += fh;
      priorUnits += f.series.units.slice(histLen - horizon).reduce((a, b) => a + b, 0);
      revenue += fh * f.sku.unitPrice;
    }
    return {
      id: c.id,
      label: c.short,
      horizonUnits,
      priorUnits,
      delta: priorUnits > 0 ? (horizonUnits - priorUnits) / priorUnits : 0,
      revenue,
    };
  }).sort((a, b) => b.horizonUnits - a.horizonUnits);

  const plan = inScope
    .map((f) => planFor(f, horizon, new Map(categories.map((c) => [c.id, c.short]))))
    .sort((a, b) => {
      const rank: Record<PlanStatus, number> = {
        "order-now": 0, "order-soon": 1, overstocked: 2, healthy: 3,
      };
      const d = rank[a.status] - rank[b.status];
      return d !== 0 ? d : a.daysOfSupply - b.daysOfSupply;
    });

  // 12 weekly buckets ending at the last full week of history.
  const sparkline: number[] = [];
  for (let w = 11; w >= 0; w--) {
    const end = histLen - w * 7;
    sparkline.push(actual.slice(Math.max(0, end - 7), end).reduce((a, b) => a + b, 0));
  }

  const scopeLabel =
    filters.categoryId === "all"
      ? "All categories"
      : (categories.find((c) => c.id === filters.categoryId)?.name ?? "Category");

  return {
    asOf: getAsOf(),
    scopeLabel,
    unit: "units",
    horizonTotal,
    horizonLo,
    horizonHi,
    priorTotal,
    deltaVsPrior: priorTotal > 0 ? (horizonTotal - priorTotal) / priorTotal : 0,
    accuracy: aggregate.accuracy,
    model: {
      used: aggregate.model,
      driverWape: aggregate.candidates.driver?.wape ?? null,
      hwWape: aggregate.candidates.hw.wape,
      seriesOnDriver: inScope.filter((f) => f.model === "driver").length,
      seriesTotal: inScope.length,
      inputs: aggregate.model === "driver" ? aggregate.inputs : null,
      seriesUsing: countInputs(inScope),
    },
    chartRows,
    sparkline,
    drivers,
    categories: categoryRows,
    plan,
    incidents: groupAnomalies(anomalies).slice(0, 6),
    counts: {
      orderNow: plan.filter((p) => p.status === "order-now").length,
      orderSoon: plan.filter((p) => p.status === "order-soon").length,
      overstocked: plan.filter((p) => p.status === "overstocked").length,
      spoilage: plan.filter((p) => p.spoilageRisk).length,
    },
    orderValue: plan.reduce((a, p) => a + p.orderCost, 0),
    skuCount: inScope.length,
  };
}
