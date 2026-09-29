/**
 * Item Forecasting workspace — everything the page needs, computed once.
 *
 * Per-store SKU fits are memoised because they are the expensive part (~300ms
 * for the full catalogue) and they do not depend on the horizon, the category
 * filter, or the visible history window. Changing those re-slices a cached
 * result instead of refitting.
 */

import {
  AS_OF,
  CATEGORIES,
  CATEGORY_BY_ID,
  SKUS,
  SKU_BY_ID,
  type CategoryId,
  type Sku,
  type StoreId,
} from "../data/catalog";
import {
  eventsOn,
  forecastOriginIndex,
  getCalendar,
  getItemSeries,
  type ItemSeries,
} from "../data/generate";
import { hashSeed, mulberry32 } from "../rng";
import { forecast, type Accuracy, type ForecastPoint } from "../forecast/holt-winters";
import { detectAnomalies, groupAnomalies, type Anomaly } from "../forecast/anomalies";
import { fitDrivers, type DriverModel } from "../forecast/drivers";
import type { Filters } from "./types";
import { SERVICE_Z } from "./types";

const MAX_HORIZON = 30;

export type SkuFit = {
  sku: Sku;
  series: ItemSeries;
  points: ForecastPoint[];
  accuracy: Accuracy;
  /** Units currently on hand at the store. */
  onHand: number;
};

const fitCache = new Map<StoreId, SkuFit[]>();

function onHandFor(sku: Sku, storeId: StoreId, avgDaily: number): number {
  // A plausible current position: somewhere between half a week and five
  // weeks of cover, quantised to whole cases the way a real count would be.
  const rand = mulberry32(hashSeed(`onhand:${sku.id}:${storeId}`));
  const coverDays = 0.5 + rand() * 24;
  const units = avgDaily * coverDays;
  return Math.max(0, Math.round(units / sku.caseSize) * sku.caseSize);
}

export function getSkuFits(storeId: StoreId): SkuFit[] {
  const hit = fitCache.get(storeId);
  if (hit) return hit;

  const series = getItemSeries(storeId);
  const out: SkuFit[] = [];
  for (const s of series) {
    const sku = SKU_BY_ID.get(s.skuId);
    if (!sku) continue;
    const r = forecast(s.units, MAX_HORIZON);
    const avgDaily = s.units.slice(-28).reduce((a, b) => a + b, 0) / 28;
    out.push({
      sku,
      series: s,
      points: r.points,
      accuracy: r.accuracy,
      onHand: onHandFor(sku, storeId, avgDaily),
    });
  }
  fitCache.set(storeId, out);
  return out;
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

function planFor(fit: SkuFit, horizon: number): SkuPlanRow {
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
    categoryName: CATEGORY_BY_ID.get(sku.category)?.short ?? sku.category,
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

export type ChartRowEvent = {
  label: string;
  kind: string;
  pct: number;
  units: number;
};

export type ChartRowFactors = {
  tempF: number;
  tempAnomaly: number;
  weatherUnits: number;
  weatherPct: number;
  promoUnits: number;
  promoPct: number;
  holiday: string | null;
  holidayPct: number;
  holidayUnits: number;
  events: ChartRowEvent[];
  baseline: number;
};

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
  const cal = getCalendar();
  const origin = forecastOriginIndex();
  const fits = getSkuFits(filters.storeId);
  const horizon = filters.horizon;

  const inScope =
    filters.categoryId === "all"
      ? fits
      : fits.filter((f) => f.sku.category === filters.categoryId);

  const histLen = inScope[0]?.series.units.length ?? 0;

  // Aggregate actuals across the scoped SKUs.
  const actual = new Array<number>(histLen).fill(0);
  for (const f of inScope) {
    for (let i = 0; i < histLen; i++) actual[i] += f.series.units[i];
  }

  // Aggregating point forecasts is exact for the mean. Aggregating the bands
  // is not — summing interval endpoints assumes the SKUs miss in lockstep, so
  // the store-level band is built from a fresh fit on the aggregate series.
  const aggregate = forecast(actual, horizon);

  const chartRows: ChartRow[] = [];
  const from = Math.max(0, histLen - filters.horizon);

  const anomalies = detectAnomalies(
    inScope[0]?.series.dates ?? [],
    actual,
    aggregate.fit,
    { threshold: 3 },
  );
  const anomalyByDate = new Map(anomalies.map((a) => [a.date, a]));

  // Promo/price columns weighted by volume share — used for factor decomposition
  // and later for the driver model.
  const weights = inScope.map((f) => {
    const v = f.series.units.slice(-90).reduce((a, b) => a + b, 0);
    return Math.max(1e-6, v);
  });
  const wSum = weights.reduce((a, b) => a + b, 0);
  const feats = cal.map((_, i) => {
    let promo = 0;
    let discount = 0;
    let logPrice = 0;
    for (let k = 0; k < inScope.length; k++) {
      const w = weights[k] / wSum;
      promo += (inScope[k].series.onPromo[i] ? 1 : 0) * w;
      discount += inScope[k].series.discount[i] * w;
      logPrice += Math.log(inScope[k].series.priceIndex[i]) * w;
    }
    return { promo, discount, logPriceIndex: logPrice };
  });

  for (let i = from; i < histLen; i++) {
    const date = cal[i].date;
    const a = anomalyByDate.get(date);
    const d = actual[i];
    const wPct = cal[i].tempAnomaly * 0.003;
    const pPct = feats[i].promo > 0 ? feats[i].promo * feats[i].discount : 0;
    const hPct = cal[i].holidayWeight > 0 ? cal[i].holidayWeight - 1 : 0;
    const dayEv = eventsOn(date);
    const allEv = [...dayEv.causes, ...dayEv.context];
    const evPcts = allEv.map((e) => e.effect - 1);
    const totPct = wPct + pPct + hPct + evPcts.reduce((s, v) => s + v, 0);
    const base = totPct !== 0 ? d / (1 + totPct) : d;
    chartRows.push({
      date,
      actual: d,
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
      factors: {
        tempF: cal[i].tempF,
        tempAnomaly: cal[i].tempAnomaly,
        weatherUnits: Math.round(base * wPct),
        weatherPct: wPct,
        promoUnits: Math.round(base * pPct),
        promoPct: pPct,
        holiday: cal[i].holiday,
        holidayPct: hPct,
        holidayUnits: Math.round(base * hPct),
        events: allEv.map((e, j) => ({
          label: e.label,
          kind: e.kind,
          pct: evPcts[j],
          units: Math.round(base * evPcts[j]),
        })),
        baseline: Math.round(base),
      },
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

  for (let h = 0; h < horizon; h++) {
    const p = aggregate.points[h];
    const fIdx = origin + h;
    const m = p.mean;
    const wPct = cal[fIdx].tempAnomaly * 0.003;
    const pPct = feats[fIdx].promo > 0 ? feats[fIdx].promo * feats[fIdx].discount : 0;
    const hPct = cal[fIdx].holidayWeight > 0 ? cal[fIdx].holidayWeight - 1 : 0;
    const dayEv = eventsOn(cal[fIdx].date);
    const allEv = [...dayEv.causes, ...dayEv.context];
    const evPcts = allEv.map((e) => e.effect - 1);
    const totPct = wPct + pPct + hPct + evPcts.reduce((s, v) => s + v, 0);
    const base = totPct !== 0 ? m / (1 + totPct) : m;
    chartRows.push({
      date: cal[fIdx].date,
      actual: null,
      mean: m,
      lo80: p.lo80, hi80: p.hi80,
      lo95: p.lo95, hi95: p.hi95,
      anomaly: null,
      factors: {
        tempF: cal[fIdx].tempF,
        tempAnomaly: cal[fIdx].tempAnomaly,
        weatherUnits: Math.round(base * wPct),
        weatherPct: wPct,
        promoUnits: Math.round(base * pPct),
        promoPct: pPct,
        holiday: cal[fIdx].holiday,
        holidayPct: hPct,
        holidayUnits: Math.round(base * hPct),
        events: allEv.map((e, j) => ({
          label: e.label,
          kind: e.kind,
          pct: evPcts[j],
          units: Math.round(base * evPcts[j]),
        })),
        baseline: Math.round(base),
      },
    });
  }

  const horizonTotal = aggregate.points.slice(0, horizon).reduce((a, p) => a + p.mean, 0);
  const horizonLo = aggregate.points.slice(0, horizon).reduce((a, p) => a + p.lo80, 0);
  const horizonHi = aggregate.points.slice(0, horizon).reduce((a, p) => a + p.hi80, 0);
  const priorTotal = actual.slice(histLen - horizon).reduce((a, b) => a + b, 0);

  const drivers = fitDrivers(cal, feats, actual, origin, origin + horizon - 1);

  // Category rollup — forecast horizon vs the same-length prior window.
  const categories: CategoryRow[] = CATEGORIES.map((c) => {
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
    .map((f) => planFor(f, horizon))
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
      : (CATEGORY_BY_ID.get(filters.categoryId)?.name ?? "Category");

  return {
    asOf: AS_OF,
    scopeLabel,
    unit: "units",
    horizonTotal,
    horizonLo,
    horizonHi,
    priorTotal,
    deltaVsPrior: priorTotal > 0 ? (horizonTotal - priorTotal) / priorTotal : 0,
    accuracy: aggregate.accuracy,
    chartRows,
    sparkline,
    drivers,
    categories,
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

/** Category options for the scope filter. */
export const CATEGORY_OPTIONS = [
  { value: "all" as const, label: "All categories" },
  ...CATEGORIES.map((c) => ({ value: c.id, label: c.name })),
];

export const TOTAL_SKUS = SKUS.length;
