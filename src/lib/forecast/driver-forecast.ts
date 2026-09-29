/**
 * The production forecast.
 *
 * Driver model: a ridge regression of log1p(demand) on calendar shape, the
 * promo plan, price, public holidays, the store's weather, NWS weather
 * alerts and events nearby
 * (design.ts). Every coefficient is learned from this series' own history,
 * then applied to the forecast window's KNOWN inputs — the promotions already
 * planned, the 16-day weather forecast, active weather alerts, upcoming
 * holidays and events.
 *
 * Recent-level correction: whatever the inputs don't explain (a competitor
 * opening, a slow drift) shows up as persistent residuals. An exponentially
 * smoothed level of those residuals is carried into the forecast and decays
 * back toward the model, so a step change is followed without being assumed
 * permanent.
 *
 * Input choice: weather and events come from outside APIs, so each has to
 * earn its place — the backtest runs with and without them, and a family is
 * kept only when it lowers this series' error (selectInputs).
 *
 * Model choice: the driver model and Holt-Winters (sales history only) are
 * scored on the identical rolling-origin backtest, and the one with the lower
 * error on this series is used. A series too short to backtest uses
 * Holt-Winters, since the driver model's gain can't be shown there.
 */

import type { DayCtx } from "../data/types";
import { firstCut, scoreForecaster, type Accuracy } from "./backtest";
import { ALL_GROUPS, buildColumns, fitRidge, predictLog, type FeatureRow, type Group, type RidgeFit } from "./design";
import { dayEffects, type DayEffects } from "./drivers";
import {
  backtest as hwBacktest,
  fitHoltWinters,
  forecastFrom,
  type ForecastPoint,
  type HWFit,
} from "./holt-winters";

export type ModelChoice = "driver" | "holt-winters";

/** Residual level decays by this factor per day ahead. */
const PHI = 0.9;
/** Smoothing weights tried for the residual level; 0 = no correction. */
const ALPHAS = [0, 0.05, 0.1, 0.2, 0.35];
/** Lead used to choose the smoothing weight — a mid-horizon, not one step. */
const TUNE_LEAD = 7;
/** Fewest training days before the first backtest origin. */
export const MIN_TRAIN = 42;

export type DriverModelFit = {
  ridge: RidgeFit;
  /** Residual level (log space) at the end of training. */
  level: number;
  alpha: number;
};

/** Fit the driver model on rows [0, n), using the given input groups. */
export function fitDriverModel(
  cal: DayCtx[],
  feats: FeatureRow[],
  y: number[],
  n: number,
  groups: Group[] = ALL_GROUPS,
): DriverModelFit | null {
  const cols = buildColumns(cal, feats, cal.length, groups);
  const ridge = fitRidge(cols, y, n);
  if (!ridge) return null;

  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = Math.log1p(Math.max(0, y[i])) - predictLog(ridge, i);

  // Pick the residual smoothing weight by how well its level, decayed
  // TUNE_LEAD days, predicts the residual that far ahead.
  let best = { alpha: 0, sse: Infinity, level: 0 };
  const decay = Math.pow(PHI, TUNE_LEAD);
  for (const alpha of ALPHAS) {
    let l = 0;
    let sse = 0;
    const levels = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      l = alpha * r[i] + (1 - alpha) * l;
      levels[i] = l;
    }
    for (let i = 28; i + TUNE_LEAD < n; i++) sse += (r[i + TUNE_LEAD] - levels[i] * decay) ** 2;
    if (sse < best.sse) best = { alpha, sse, level: levels[n - 1] ?? 0 };
  }
  return { ridge, level: best.level, alpha: best.alpha };
}

/** Log-space forecast for index i, h days (1-based) past the end of training. */
function forecastLog(fit: DriverModelFit, i: number, h: number): number {
  return predictLog(fit.ridge, i) + fit.level * Math.pow(PHI, h);
}

export function driverForecaster(
  cal: DayCtx[],
  feats: FeatureRow[],
  y: number[],
  groups: Group[] = ALL_GROUPS,
) {
  return (cut: number, H: number): number[] => {
    const fit = fitDriverModel(cal, feats, y, cut, groups);
    const mean = y.slice(Math.max(0, cut - 28), cut).reduce((a, b) => a + b, 0) / Math.min(28, cut);
    return Array.from({ length: H }, (_, h) =>
      fit ? Math.max(0, Math.expm1(forecastLog(fit, cut + h, h + 1))) : mean,
    );
  };
}

/* -------------------------------------------------------------------------- */
/* Which inputs earn their place                                              */
/* -------------------------------------------------------------------------- */

/** Input families that come from external APIs and must prove themselves. */
export const OPTIONAL_GROUPS = ["weather", "alerts", "events"] as const;
export type OptionalGroup = (typeof OPTIONAL_GROUPS)[number];

/** Keep an optional input only if it improves backtest error by at least this. */
const MIN_GAIN = 0.001;

export type InputSelection = {
  groups: Group[];
  accuracy: Accuracy;
  /** Whether each optional input family is in the model. */
  uses: Record<OptionalGroup, boolean>;
};

/**
 * Forward selection over the optional input families: start from the core
 * model, add whichever family lowers backtest error most, repeat until no
 * family helps by at least MIN_GAIN. A family that merely adds noise — real
 * events against sales they can't explain — stays out, and one that helps
 * switches on by itself.
 */
export function selectInputs(
  cal: DayCtx[],
  feats: FeatureRow[],
  y: number[],
  opts: { m: number; horizon: number; minTrain: number },
): InputSelection | null {
  if (firstCut(y.length, opts) == null) return null;
  const core = ALL_GROUPS.filter((g) => !(OPTIONAL_GROUPS as readonly string[]).includes(g));
  const score = (extra: OptionalGroup[]) =>
    scoreForecaster(y, driverForecaster(cal, feats, y, [...core, ...extra]), opts);

  let chosen: OptionalGroup[] = [];
  let accuracy = score(chosen);
  if (!Number.isFinite(accuracy.wape)) return null;

  for (;;) {
    let step: { g: OptionalGroup; acc: Accuracy } | null = null;
    for (const g of OPTIONAL_GROUPS) {
      if (chosen.includes(g)) continue;
      const acc = score([...chosen, g]);
      if (Number.isFinite(acc.wape) && acc.wape < (step?.acc.wape ?? accuracy.wape - MIN_GAIN)) {
        step = { g, acc };
      }
    }
    if (!step) break;
    chosen = [...chosen, step.g];
    accuracy = step.acc;
  }

  return {
    groups: [...core, ...chosen],
    accuracy,
    uses: {
      weather: chosen.includes("weather"),
      alerts: chosen.includes("alerts"),
      events: chosen.includes("events"),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The public call                                                            */
/* -------------------------------------------------------------------------- */

export type SeriesForecast = {
  model: ModelChoice;
  points: ForecastPoint[];
  /** Backtest of the model in use. */
  accuracy: Accuracy;
  /** Both candidates on the same backtest, for the comparison shown in the UI. */
  candidates: { driver: Accuracy | null; hw: Accuracy };
  /** Which optional inputs the driver model kept, when it could be tested. */
  inputs: Record<OptionalGroup, boolean> | null;
  /** Holt-Winters fit — anomaly detection reads its one-step residuals. */
  hwFit: HWFit;
  /**
   * The driver model fitted on all history, when it is the model in use:
   * the effects it applies each day, and its residual-level correction.
   */
  driver: {
    effectsAt: (i: number) => DayEffects;
    /** Log-space recent-level correction h days ahead (1-based). */
    correction: (h: number) => number;
  } | null;
};

const Z80 = 1.2816;
const Z95 = 1.96;
const LOG = (v: number) => Math.log1p(Math.max(0, v));
const UNLOG = (z: number) => Math.max(0, Math.expm1(z));

/**
 * Forecast `horizon` days past the end of `y`.
 *
 * @param cal   calendar covering history and at least `horizon` future days
 * @param feats feature rows aligned to `cal`
 * @param y     history; its length is the forecast origin
 */
export function forecastSeries(
  cal: DayCtx[],
  feats: FeatureRow[],
  y: number[],
  horizon: number,
): SeriesForecast {
  const n = y.length;
  const H = Math.max(horizon, 14);
  // Both candidates are scored on the same origins. Six weeks is the least
  // training the driver model is allowed before its first backtest origin.
  const opts = { m: 7, horizon: H, minTrain: MIN_TRAIN };

  const hwFit = fitHoltWinters(y, 7);
  const hwAcc = hwBacktest(y, opts);
  const selection = selectInputs(cal, feats, y, opts);
  const driverAcc = selection?.accuracy ?? null;

  const full = selection ? fitDriverModel(cal, feats, y, n, selection.groups) : null;
  const useDriver =
    full != null &&
    driverAcc != null &&
    Number.isFinite(driverAcc.wape) &&
    (!Number.isFinite(hwAcc.wape) || driverAcc.wape < hwAcc.wape);

  const accuracy = useDriver ? driverAcc! : hwAcc;
  const avail = Math.min(horizon, cal.length - n);
  const means = useDriver
    ? Array.from({ length: avail }, (_, h) => UNLOG(forecastLog(full!, n + h, h + 1)))
    : forecastFrom(hwFit.state, hwFit.params, avail);

  const points: ForecastPoint[] = means.map((mean, i) => {
    const sigma = accuracy.sigmaByHorizon[Math.min(i, accuracy.sigmaByHorizon.length - 1)] || hwFit.sigma;
    const z = LOG(mean);
    return {
      h: i + 1,
      mean,
      lo80: UNLOG(z - Z80 * sigma),
      hi80: UNLOG(z + Z80 * sigma),
      lo95: UNLOG(z - Z95 * sigma),
      hi95: UNLOG(z + Z95 * sigma),
    };
  });

  return {
    model: useDriver ? "driver" : "holt-winters",
    points,
    accuracy,
    candidates: { driver: driverAcc, hw: hwAcc },
    inputs: selection?.uses ?? null,
    hwFit,
    driver: useDriver
      ? {
          effectsAt: (i) => dayEffects(full!.ridge, i),
          correction: (h) => full!.level * Math.pow(PHI, h),
        }
      : null,
  };
}
