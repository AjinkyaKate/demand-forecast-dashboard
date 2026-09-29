/**
 * Rolling-origin backtest for any forecaster.
 *
 * The forecaster is handed a training cut and a horizon and must forecast
 * from data before the cut only. Origins walk forward in fixed steps; every
 * (origin, horizon) prediction is scored against what actually happened.
 * Prediction-interval widths come from the same errors, so a band reflects how
 * this model actually missed on this series.
 */

export type Accuracy = {
  /** Weighted absolute percentage error — the headline. Robust to zero-demand
   *  days, which MAPE is not, so this is what "accuracy" is derived from. */
  wape: number;
  /** Mean absolute percentage error over non-zero actuals only. */
  mape: number;
  /** Signed error / actual. Positive = the model runs high (over-forecasts). */
  bias: number;
  /** Mean absolute scaled error vs a seasonal-naive baseline. < 1 beats it. */
  mase: number;
  /** Absolute error of the seasonal-naive baseline, for the comparison row. */
  naiveWape: number;
  /** Number of (origin, horizon) predictions scored. */
  points: number;
  /** Residual sd in log space per horizon, h = 1..H. */
  sigmaByHorizon: number[];
};

export type BacktestOptions = {
  m?: number;
  /** Horizon scored at each origin. */
  horizon?: number;
  /** Number of rolling origins. */
  origins?: number;
  /** Days between origins. */
  step?: number;
  /** Fewest training days the first origin may have. */
  minTrain?: number;
};

/** Forecast `H` days starting at index `cut`, using data before `cut` only. */
export type Forecaster = (cut: number, H: number) => number[];

const LOG = (y: number) => Math.log1p(Math.max(0, y));

export function unscored(H: number): Accuracy {
  return {
    wape: NaN, mape: NaN, bias: NaN, mase: NaN, naiveWape: NaN,
    points: 0, sigmaByHorizon: new Array(H).fill(0.25),
  };
}

/**
 * The origins a series of length n can support: up to `origins` of them, but
 * a short series gets fewer (never fewer than two) rather than none, so a
 * young store is still scored — on fewer days, which `points` reports.
 */
export function backtestPlan(
  n: number,
  opts: BacktestOptions = {},
): { first: number; origins: number } | null {
  const m = opts.m ?? 7;
  const H = opts.horizon ?? 14;
  const step = opts.step ?? 14;
  const minTrain = Math.max(m * 4, opts.minTrain ?? 0);
  const fit = Math.floor((n - H - minTrain) / step) + 1;
  const origins = Math.min(opts.origins ?? 8, fit);
  if (origins < 2) return null;
  return { first: n - (origins - 1) * step - H, origins };
}

/** First training cut for these options, or null when history is too short. */
export function firstCut(n: number, opts: BacktestOptions = {}): number | null {
  return backtestPlan(n, opts)?.first ?? null;
}

export function scoreForecaster(y: number[], predict: Forecaster, opts: BacktestOptions = {}): Accuracy {
  const m = opts.m ?? 7;
  const H = opts.horizon ?? 14;
  const step = opts.step ?? 14;
  const plan = backtestPlan(y.length, opts);
  // Not enough history to evaluate honestly — say so rather than invent it.
  if (plan == null) return unscored(H);
  const { first, origins } = plan;

  let absErr = 0;
  let signedErr = 0;
  let actualSum = 0;
  let mapeSum = 0;
  let mapeN = 0;
  let naiveAbs = 0;
  let points = 0;
  const logErr: number[][] = Array.from({ length: H }, () => []);

  for (let o = 0; o < origins; o++) {
    const cut = first + o * step;
    if (cut + H > y.length) break;
    const pred = predict(cut, H);
    for (let h = 0; h < H; h++) {
      const actual = y[cut + h];
      const p = pred[h];
      absErr += Math.abs(actual - p);
      signedErr += p - actual;
      actualSum += actual;
      if (actual > 0) {
        mapeSum += Math.abs(actual - p) / actual;
        mapeN++;
      }
      // Seasonal naive: same weekday, one week before the origin.
      naiveAbs += Math.abs(actual - y[cut - m + (h % m)]);
      logErr[h].push(LOG(actual) - LOG(p));
      points++;
    }
  }

  // Interval widths: empirical variance per horizon, then a least-squares line
  // var(h) = a + b·h. Error variance accumulates roughly linearly with the
  // horizon, so the line is the right shape and smooths the small sample.
  const vars = logErr.map((errs) => {
    if (errs.length < 2) return NaN;
    const mu = errs.reduce((a, b) => a + b, 0) / errs.length;
    return errs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (errs.length - 1);
  });
  const usable = vars.map((v, i) => [i + 1, v] as const).filter(([, v]) => Number.isFinite(v));
  let a = 0.02;
  let b = 0.004;
  if (usable.length >= 2) {
    const n = usable.length;
    const sx = usable.reduce((s, [h]) => s + h, 0);
    const sy = usable.reduce((s, [, v]) => s + v, 0);
    const sxx = usable.reduce((s, [h]) => s + h * h, 0);
    const sxy = usable.reduce((s, [h, v]) => s + h * v, 0);
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) > 1e-9) {
      b = (n * sxy - sx * sy) / denom;
      a = (sy - b * sx) / n;
    }
  }
  const floor = Math.max(1e-4, Math.min(...usable.map(([, v]) => v)) * 0.5);
  const sigmaByHorizon = Array.from({ length: H }, (_, i) =>
    Math.sqrt(Math.max(floor, a + b * (i + 1))),
  );

  return {
    wape: actualSum > 0 ? absErr / actualSum : NaN,
    mape: mapeN > 0 ? mapeSum / mapeN : NaN,
    bias: actualSum > 0 ? signedErr / actualSum : NaN,
    mase: naiveAbs > 0 ? absErr / naiveAbs : NaN,
    naiveWape: actualSum > 0 ? naiveAbs / actualSum : NaN,
    points,
    sigmaByHorizon,
  };
}
