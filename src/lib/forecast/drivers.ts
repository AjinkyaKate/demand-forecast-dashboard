/**
 * Driver attribution — "why is demand moving?"
 *
 * A ridge regression of log1p(demand) on the inputs an operator can actually
 * observe (design.ts): calendar position, weekday, promo calendar, price,
 * holidays, weather at the store, logged events and events nearby. Each
 * driver's reported effect is the fitted coefficient applied to that driver's
 * values over the forecast window, relative to the series' own historical
 * average.
 *
 * Because the model is fitted in log space, effects are naturally
 * multiplicative and are reported that way — "weekday pattern: +8 %" means the
 * forecast window's mix of weekdays lifts demand 8 % above an average week.
 * The units column in the table view is a bridge computed in a fixed,
 * disclosed order.
 *
 * Ridge rather than OLS because the harmonic and dummy columns are correlated;
 * the penalty keeps a driver from borrowing another's effect and flipping sign.
 */

import type { DayCtx } from "../data/types";
import {
  buildColumns,
  columnValue,
  fitRidge,
  rawBeta,
  type FeatureRow,
  type Group,
  type RidgeFit,
} from "./design";

export type { FeatureRow } from "./design";

export type DriverGroupId = Group;

export type DriverGroup = {
  id: DriverGroupId;
  label: string;
  /** What the operator should do with it. */
  hint: string;
};

export const DRIVER_GROUPS: DriverGroup[] = [
  { id: "trend", label: "Underlying trend", hint: "Long-run direction of the base rate" },
  { id: "season", label: "Season of year", hint: "Where the window sits in the annual cycle" },
  { id: "weekday", label: "Day-of-week mix", hint: "Which weekdays the window contains" },
  { id: "promo", label: "Promotions", hint: "Planned promo windows and depth" },
  { id: "holiday", label: "Holidays", hint: "Public holidays and the day before" },
  { id: "weather", label: "Weather", hint: "Temperature vs normal and rain, at the store" },
  { id: "price", label: "Price", hint: "Effective price vs its reference" },
  { id: "events", label: "Events", hint: "Logged events and events near the store" },
];

/** Fixed bridge order for the additive units decomposition. Disclosed in the UI. */
const BRIDGE_ORDER: DriverGroupId[] = [
  "trend", "season", "weekday", "promo", "holiday", "weather", "price", "events",
];

export type DriverEffect = {
  id: DriverGroupId;
  label: string;
  hint: string;
  /** Multiplicative effect over the window, e.g. 0.08 = +8 %. */
  effect: number;
  /** Incremental units attributed in the fixed bridge order. */
  units: number;
};

export type DriverModel = {
  effects: DriverEffect[];
  /** Share of log-demand variance explained. */
  r2: number;
  /** Baseline units/day before any driver — the bridge's starting point. */
  baselinePerDay: number;
  /** Model's own expected units/day over the window (baseline × all effects). */
  expectedPerDay: number;
  /** True when the fit was too weak to attribute honestly. */
  degenerate: boolean;
};

/**
 * A day's effects in log space, each measured against that input being "off":
 * no promo, no holiday, normal temperature and no rain, price at its
 * reference, no event. Calendar shape (trend, season, weekday) is the
 * baseline these sit on top of.
 */
export type DayEffects = {
  promo: number;
  holiday: number;
  weather: number;
  price: number;
  /** Logged operational events (events table). */
  events: number;
  /** Events near the store (PredictHQ): attendance and severe weather. */
  local: number;
};

export const OFF_EFFECTS: DayEffects = { promo: 0, holiday: 0, weather: 0, price: 0, events: 0, local: 0 };

/** Per-day effects from any fit that used the shared design. */
export function dayEffects(fit: RidgeFit, i: number): DayEffects {
  const e = (name: string) => rawBeta(fit, name) * columnValue(fit, name, i);
  return {
    promo: e("promo") + e("discount"),
    holiday: e("holiday") + e("pre_holiday"),
    weather: e("temp_anom") + e("rain"),
    price: e("log_price"),
    events: e("event_log"),
    local: e("local_attendance") + e("severe_weather"),
  };
}

export type DriverFit = {
  model: DriverModel;
  /** Per-day effects for any index of `cal`. */
  effectsAt: (i: number) => DayEffects;
  /** Log-space coefficient on an event's log multiplier (1 = exactly as logged). */
  eventCoef: number;
};

export function fitDrivers(
  cal: DayCtx[],
  feats: FeatureRow[],
  y: number[],
  windowFrom: number,
  windowTo: number,
): DriverModel {
  return fitDriversDetailed(cal, feats, y, windowFrom, windowTo).model;
}

/**
 * Fit the driver model on history and evaluate it over a forward window.
 *
 * @param cal        calendar rows covering history AND the forecast window
 * @param feats      observable feature rows, same length as `cal`
 * @param y          historical demand; its length defines the training range
 * @param windowFrom first index of the forecast window
 * @param windowTo   last index of the forecast window, inclusive
 */
export function fitDriversDetailed(
  cal: DayCtx[],
  feats: FeatureRow[],
  y: number[],
  windowFrom: number,
  windowTo: number,
): DriverFit {
  const n = y.length;
  const mean = y.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const degenerate: DriverFit = {
    model: {
      effects: DRIVER_GROUPS.map((g) => ({ id: g.id, label: g.label, hint: g.hint, effect: 0, units: 0 })),
      r2: 0,
      baselinePerDay: mean,
      expectedPerDay: mean,
      degenerate: true,
    },
    effectsAt: () => OFF_EFFECTS,
    eventCoef: 0,
  };

  const cols = buildColumns(cal, feats, cal.length);
  const fit = n > 0 ? fitRidge(cols, y, n) : null;
  if (!fit) return degenerate;

  // R² on the training range, in log space.
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const z = Math.log1p(Math.max(0, y[i]));
    let pred = 0;
    for (let a = 0; a < fit.cols.length; a++) {
      pred += fit.beta[a] * ((fit.cols[a].values[i] - fit.mean[a]) / fit.sd[a]);
    }
    const yc = z - fit.yMean;
    ssRes += (yc - pred) ** 2;
    ssTot += yc ** 2;
  }
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  // Each group's log contribution over the window, against the historical
  // mean of its features (so "0" means "an average stretch of this series").
  const wLen = Math.max(1, windowTo - windowFrom + 1);
  const logContrib = new Map<DriverGroupId, number>(DRIVER_GROUPS.map((g) => [g.id, 0]));
  for (let a = 0; a < fit.cols.length; a++) {
    const col = fit.cols[a];
    let sum = 0;
    for (let i = windowFrom; i <= windowTo && i < cal.length; i++) {
      sum += (col.values[i] - fit.mean[a]) / fit.sd[a];
    }
    logContrib.set(col.group, (logContrib.get(col.group) ?? 0) + (fit.beta[a] * sum) / wLen);
  }

  // Baseline = geometric mean of historical demand: the level the log model
  // regresses toward once every driver sits at its historical average.
  const baselinePerDay = Math.expm1(fit.yMean);
  const totalLog = [...logContrib.values()].reduce((a, b) => a + b, 0);
  const expectedPerDay = Math.expm1(fit.yMean + totalLog);

  // Units bridge: walk the fixed order, multiplying one driver in at a time.
  const units = new Map<DriverGroupId, number>();
  let running = fit.yMean;
  let prevUnits = Math.expm1(running);
  for (const id of BRIDGE_ORDER) {
    running += logContrib.get(id) ?? 0;
    const nowUnits = Math.expm1(running);
    units.set(id, nowUnits - prevUnits);
    prevUnits = nowUnits;
  }

  const effects: DriverEffect[] = DRIVER_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    hint: g.hint,
    effect: Math.expm1(logContrib.get(g.id) ?? 0),
    units: units.get(g.id) ?? 0,
  }))
    // Biggest absolute mover first — the reader's question is "what moved it".
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));

  return {
    model: { effects, r2, baselinePerDay, expectedPerDay, degenerate: false },
    effectsAt: (i) => dayEffects(fit, i),
    eventCoef: rawBeta(fit, "event_log"),
  };
}

/** The fixed bridge order, for disclosure in the UI. */
export const BRIDGE_ORDER_LABELS = BRIDGE_ORDER.map(
  (id) => DRIVER_GROUPS.find((g) => g.id === id)!.label,
);
