/**
 * Fuel Forecasting workspace.
 *
 * Fuel differs from inside sales in two ways that shape this module: volume
 * responds to street price, and the constraint is tank capacity rather than
 * shelf space. So the plan here is a delivery schedule — when the tank runs
 * dry, when to drop, and how many gallons will fit.
 *
 * Each grade is forecast from its history and its known future — the street
 * price, the store's weather forecast, holidays, NWS weather alerts and
 * events near the store (driver-forecast.ts).
 */

import type { FuelGrade, FuelGradeId, FuelSeries, StoreId } from "../data/types";
import {
  getAsOf,
  getCalendar,
  getFuelGrades,
  getFuelSeries,
  getLocalEventDays,
  getNamedEvents,
  getTankLevels,
  memo,
} from "../db/repository";
import { addDays } from "../format";
import type { Accuracy } from "../forecast/backtest";
import type { FeatureRow } from "../forecast/design";
import { forecastSeries, type ModelChoice, type OptionalGroup } from "../forecast/driver-forecast";
import type { ForecastPoint } from "../forecast/holt-winters";
import { detectAnomalies, groupAnomalies, type Anomaly } from "../forecast/anomalies";
import { fitDriversDetailed, type DriverModel } from "../forecast/drivers";
import { factorsFor } from "./factors";
import { countInputs, localFeatures, type ChartRow, type ModelInfo } from "./items";
import type { Filters } from "./types";

const MAX_HORIZON = 30;

/** Tanker compartments drop in 500-gallon steps; orders are quantised to that. */
const LOAD_STEP = 500;
/** Order this many days before the tank would actually run dry. */
const SAFETY_DAYS = 2;

export type GradeFit = {
  grade: FuelGrade;
  series: FuelSeries;
  points: ForecastPoint[];
  accuracy: Accuracy;
  model: ModelChoice;
  inputs: Record<OptionalGroup, boolean> | null;
  /** Latest tank gauge reading (tank_levels). */
  currentGallons: number;
};

export function getGradeFits(storeId: StoreId): GradeFit[] {
  return memo(`gradefits:${storeId}`, () => {
    const cal = getCalendar(storeId, "fuel");
    const local = getLocalEventDays(storeId, cal);
    const gradeById = new Map(getFuelGrades().map((g) => [g.id, g]));
    const tanks = getTankLevels(storeId);
    const out: GradeFit[] = [];
    for (const s of getFuelSeries(storeId)) {
      const grade = gradeById.get(s.gradeId);
      if (!grade) continue;
      // Fuel has no promo calendar; price does that job.
      const feats: FeatureRow[] = cal.map((_, i) => ({
        promo: 0,
        discount: 0,
        logPriceIndex: Math.log(s.priceIndex[i]),
        ...localFeatures(local[i]),
      }));
      const r = forecastSeries(cal, feats, s.gallons, MAX_HORIZON);
      out.push({
        grade,
        series: s,
        points: r.points,
        accuracy: r.accuracy,
        model: r.model,
        inputs: r.inputs,
        currentGallons: tanks.get(grade.id) ?? 0,
      });
    }
    return out;
  });
}

/* -------------------------------------------------------------------------- */
/* Delivery plan                                                              */
/* -------------------------------------------------------------------------- */

export type TankStatus = "order-now" | "schedule" | "healthy";

export type TankPlanRow = {
  grade: FuelGrade;
  capacity: number;
  reserve: number;
  usable: number;
  currentGallons: number;
  fillPct: number;
  avgDailyDraw: number;
  /** Days until the tank hits its reserve level, at the forecast draw. */
  daysToReserve: number;
  /** ISO date the tank hits reserve. */
  dryDate: string | null;
  /** Recommended delivery date, SAFETY_DAYS before dry. */
  deliverBy: string | null;
  /** Gallons that will fit on that date, quantised to LOAD_STEP. */
  recommendedLoad: number;
  status: TankStatus;
  horizonGallons: number;
  marginDollars: number;
  wape: number;
  currentPrice: number;
};

function planFor(fit: GradeFit, horizon: number, origin: number, asOf: string): TankPlanRow {
  const { grade, points, currentGallons } = fit;
  const capacity = grade.tankGallons;
  const reserve = capacity * grade.reserveFraction;
  const usable = capacity - reserve;

  // Walk the forecast draw down from today's level until we reach reserve.
  let level = currentGallons;
  let daysToReserve = points.length;
  for (let h = 0; h < points.length; h++) {
    level -= points[h].mean;
    if (level <= reserve) {
      // Interpolate within the day for a fractional figure.
      const over = reserve - level;
      daysToReserve = h + 1 - (points[h].mean > 0 ? over / points[h].mean : 0);
      break;
    }
  }

  const reachesReserve = daysToReserve < points.length;
  const dryDate = reachesReserve ? addDays(asOf, Math.floor(daysToReserve)) : null;
  const deliverDays = Math.max(0, Math.floor(daysToReserve) - SAFETY_DAYS);
  const deliverBy = reachesReserve ? addDays(asOf, deliverDays) : null;

  // Level at the delivery date determines how much will actually fit.
  let levelAtDelivery = currentGallons;
  for (let h = 0; h < deliverDays && h < points.length; h++) {
    levelAtDelivery -= points[h].mean;
  }
  const headroom = Math.max(0, capacity - levelAtDelivery);
  const recommendedLoad = reachesReserve
    ? Math.floor(headroom / LOAD_STEP) * LOAD_STEP
    : 0;

  const horizonGallons = points.slice(0, horizon).reduce((a, p) => a + p.mean, 0);

  return {
    grade,
    capacity,
    reserve,
    usable,
    currentGallons,
    fillPct: currentGallons / capacity,
    avgDailyDraw: horizonGallons / horizon,
    daysToReserve,
    dryDate,
    deliverBy,
    recommendedLoad,
    status:
      daysToReserve <= SAFETY_DAYS ? "order-now" : daysToReserve <= 6 ? "schedule" : "healthy",
    horizonGallons,
    marginDollars: horizonGallons * grade.marginPerGallon,
    wape: fit.accuracy.wape,
    currentPrice: fit.series.price[origin - 1],
  };
}

/* -------------------------------------------------------------------------- */
/* Workspace assembly                                                         */
/* -------------------------------------------------------------------------- */

export type GradeSeriesRow = {
  id: FuelGradeId;
  label: string;
  color: string;
  values: (number | null)[];
};

export type FuelWorkspace = {
  asOf: string;
  scopeLabel: string;
  unit: string;
  horizonTotal: number;
  horizonLo: number;
  horizonHi: number;
  priorTotal: number;
  deltaVsPrior: number;
  accuracy: Accuracy;
  model: ModelInfo;
  chartRows: ChartRow[];
  sparkline: number[];
  drivers: DriverModel;
  /** Per-grade daily gallons over the visible window, for the mix chart. */
  gradeDates: string[];
  gradeSeries: GradeSeriesRow[];
  mix: { id: FuelGradeId; label: string; value: number; color: string }[];
  priceDates: string[];
  priceSeries: GradeSeriesRow[];
  plan: TankPlanRow[];
  incidents: Anomaly[][];
  marginTotal: number;
  counts: { orderNow: number; schedule: number };
};

/** Categorical slots in the grades' fixed table order — never reassigned by
 *  rank or filter, so a grade keeps its colour when others are filtered out. */
function gradeColor(id: FuelGradeId): string {
  const i = getFuelGrades().findIndex((g) => g.id === id);
  return `var(--series-${Math.min(8, Math.max(0, i) + 1)})`;
}

export function buildFuelWorkspace(filters: Filters): FuelWorkspace {
  const cal = getCalendar(filters.storeId, "fuel");
  const fits = getGradeFits(filters.storeId);
  const events = getNamedEvents(filters.storeId);
  const asOf = getAsOf();
  const horizon = filters.horizon;

  const inScope =
    filters.gradeId === "all" ? fits : fits.filter((f) => f.grade.id === filters.gradeId);

  const histLen = fits[0]?.series.gallons.length ?? 0;
  const origin = histLen;

  const actual = new Array<number>(histLen).fill(0);
  for (const f of inScope) {
    for (let i = 0; i < histLen; i++) actual[i] += f.series.gallons[i];
  }

  // Volume-weighted price index across the scoped grades, plus weather
  // alerts and events near the store.
  const weights = inScope.map((f) =>
    Math.max(1e-6, f.series.gallons.slice(-90).reduce((a, b) => a + b, 0)),
  );
  const wSum = weights.reduce((a, b) => a + b, 0);
  const local = getLocalEventDays(filters.storeId, cal);
  const feats: FeatureRow[] = cal.map((_, i) => {
    let logPrice = 0;
    for (let k = 0; k < inScope.length; k++) {
      logPrice += Math.log(inScope[k].series.priceIndex[i]) * (weights[k] / wSum);
    }
    return {
      promo: 0,
      discount: 0,
      logPriceIndex: logPrice,
      ...localFeatures(local[i]),
    };
  });

  const aggregate = forecastSeries(cal, feats, actual, horizon);

  const anomalies = detectAnomalies(cal.slice(0, histLen).map((d) => d.date), actual, aggregate.hwFit, {
    threshold: 3,
    events,
  });

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
  const anomalyByDate = new Map(anomalies.map((a) => [a.date, a]));

  const from = Math.max(0, histLen - filters.horizon);
  const chartRows: ChartRow[] = [];
  for (let i = from; i < histLen; i++) {
    const date = cal[i].date;
    const a = anomalyByDate.get(date);
    chartRows.push({
      date,
      actual: actual[i],
      mean: null, lo80: null, hi80: null, lo95: null, hi95: null,
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
    chartRows.push({
      date: cal[origin + h].date,
      actual: null,
      mean: p.mean, lo80: p.lo80, hi80: p.hi80, lo95: p.lo95, hi95: p.hi95,
      anomaly: null,
      factors: factors(origin + h, p.mean),
    });
  }

  const drivers = driverFit.model;

  // Per-grade panels span the same window the filter selects, so the grade
  // chart and the headline chart always show the same stretch of time.
  const winFrom = Math.max(0, histLen - filters.horizon);
  const gradeDates = cal.slice(winFrom, histLen).map((d) => d.date);
  const gradeSeries: GradeSeriesRow[] = fits.map((f) => ({
    id: f.grade.id,
    label: f.grade.short,
    color: gradeColor(f.grade.id),
    values: f.series.gallons.slice(winFrom, histLen),
  }));

  const mix = fits.map((f) => ({
    id: f.grade.id,
    label: f.grade.short,
    value: f.points.slice(0, horizon).reduce((a, p) => a + p.mean, 0),
    color: gradeColor(f.grade.id),
  }));

  // Street price is its own chart on its own axis. Putting it on the volume
  // plot as a second y-scale would manufacture a correlation.
  const priceFrom = Math.max(0, histLen - Math.min(filters.horizon, 180));
  const priceDates = cal.slice(priceFrom, histLen).map((d) => d.date);
  const priceSeries: GradeSeriesRow[] = fits.map((f) => ({
    id: f.grade.id,
    label: f.grade.short,
    color: gradeColor(f.grade.id),
    values: f.series.price.slice(priceFrom, histLen),
  }));

  const plan = fits
    .map((f) => planFor(f, horizon, origin, asOf))
    .sort((a, b) => a.daysToReserve - b.daysToReserve);

  const sparkline: number[] = [];
  for (let w = 11; w >= 0; w--) {
    const end = histLen - w * 7;
    sparkline.push(actual.slice(Math.max(0, end - 7), end).reduce((a, b) => a + b, 0));
  }

  const horizonTotal = aggregate.points.slice(0, horizon).reduce((a, p) => a + p.mean, 0);

  return {
    asOf,
    scopeLabel:
      filters.gradeId === "all"
        ? "All grades"
        : (fits.find((f) => f.grade.id === filters.gradeId)?.grade.name ?? "Grade"),
    unit: "gallons",
    horizonTotal,
    horizonLo: aggregate.points.slice(0, horizon).reduce((a, p) => a + p.lo80, 0),
    horizonHi: aggregate.points.slice(0, horizon).reduce((a, p) => a + p.hi80, 0),
    priorTotal: actual.slice(histLen - horizon).reduce((a, b) => a + b, 0),
    deltaVsPrior: (() => {
      const prior = actual.slice(histLen - horizon).reduce((a, b) => a + b, 0);
      return prior > 0 ? (horizonTotal - prior) / prior : 0;
    })(),
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
    gradeDates,
    gradeSeries,
    mix,
    priceDates,
    priceSeries,
    plan,
    incidents: groupAnomalies(anomalies).slice(0, 6),
    marginTotal: plan
      .filter((p) => filters.gradeId === "all" || p.grade.id === filters.gradeId)
      .reduce((a, p) => a + p.marginDollars, 0),
    counts: {
      orderNow: plan.filter((p) => p.status === "order-now").length,
      schedule: plan.filter((p) => p.status === "schedule").length,
    },
  };
}
