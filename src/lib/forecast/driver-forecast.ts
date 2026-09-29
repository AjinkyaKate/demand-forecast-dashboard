/**
 * The production forecast.
 *
 * Driver model: a ridge regression of log1p(demand) on calendar shape, the
 * promo plan, price, public holidays, the store's weather and events
 * (design.ts). Every coefficient is learned from this series' own history,
 * then applied to the forecast window's KNOWN inputs — the promotions already
 * planned, the 16-day weather forecast, upcoming holidays and events.
 *
 * Recent-level correction: whatever the inputs don't explain (a competitor
 * opening, a slow drift) shows up as persistent residuals. An exponentially
 * smoothed level of those residuals is carried into the forecast and decays
 * back toward the model, so a step change is followed without being assumed
 * permanent.
 *
 * Model choice: the driver model and Holt-Winters (sales history only) are
 * scored on the identical rolling-origin backtest, and the one with the lower
 * error on this series is used. A series too short to backtest uses
 * Holt-Winters, since the driver model's gain can't be shown there.
 */

import type { DayCtx } from "../data/types";
import { firstCut, scoreForecaster, type Accuracy } from "./backtest";
import { buildColumns, fitRidge, predictLog, rawBeta, type FeatureRow, type RidgeFit } from "./design";
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
const MIN_TRAIN = 42;

export type DriverModelFit = {
  ridge: RidgeFit;
  /** Residual level (log space) at the end of training. */
  level: number;
  alpha: number;
};

/** Fit the driver model on rows [0, n). */
export function fitDriverModel(
  cal: DayCtx[],
  feats: FeatureRow[],
  y: number[],
  n: number,
): DriverModelFit | null {
  const cols = buildColumns(cal, feats, cal.length);
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

export function driverForecaster(cal: DayCtx[], feats: FeatureRow[], y: number[]) {
  return (cut: number, H: number): number[] => {
    const fit = fitDriverModel(cal, feats, y, cut);
    const mean = y.slice(Math.max(0, cut - 28), cut).reduce((a, b) => a + b, 0) / Math.min(28, cut);
    return Array.from({ length: H }, (_, h) =>
      fit ? Math.max(0, Math.expm1(forecastLog(fit, cut + h, h + 1))) : mean,
    );
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
  /** Holt-Winters fit — anomaly detection reads its one-step residuals. */
  hwFit: HWFit;
  /**
   * The driver model fitted on all history, when it is the model in use:
   * the effects it applies each day, and its residual-level correction.
   */
  driver: {
    effectsAt: (i: number) => DayEffects;
    eventCoef: number;
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
  const driverAcc =
    firstCut(n, opts) != null ? scoreForecaster(y, driverForecaster(cal, feats, y), opts) : null;

  const full = driverAcc ? fitDriverModel(cal, feats, y, n) : null;
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
    hwFit,
    driver: useDriver
      ? {
          effectsAt: (i) => dayEffects(full!.ridge, i),
          eventCoef: rawBeta(full!.ridge, "event_log"),
          correction: (h) => full!.level * Math.pow(PHI, h),
        }
      : null,
  };
}
