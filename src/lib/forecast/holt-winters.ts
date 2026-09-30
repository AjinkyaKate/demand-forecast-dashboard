/**
 * Holt-Winters exponential smoothing with a damped trend and weekly
 * seasonality, fitted on log1p(y).
 *
 * Why log space: C-store demand is count data with multiplicative seasonality
 * — a Saturday is +40 % of whatever the level is, not +40 units. Smoothing
 * additively on log1p gives multiplicative behaviour, guarantees a
 * non-negative forecast, and produces the asymmetric prediction intervals that
 * count data actually has.
 *
 * Two honesty notes, because these numbers are shown to people who will order
 * inventory against them:
 *
 *  1. Back-transforming exp(mean of logs) yields a *median*, not a mean. For a
 *     right-skewed demand distribution the median is the better single number
 *     to stock against, so this is deliberate — but it is a median.
 *  2. Prediction intervals are NOT from a closed-form variance formula. They
 *     come from the rolling-origin backtest's own h-step errors, so they
 *     reflect how this model actually missed on this series.
 */

import { firstCut, scoreForecaster, unscored, type Accuracy, type BacktestOptions } from "./backtest";

const LOG = (y: number) => Math.log1p(Math.max(0, y));
const UNLOG = (z: number) => Math.max(0, Math.expm1(z));

export type HWParams = {
  alpha: number;
  beta: number;
  gamma: number;
  phi: number;
};

export type HWState = {
  level: number;
  trend: number;
  /** Seasonal indices in log space, indexed by `t % m`. */
  seasonal: number[];
  /** Number of observations consumed. */
  n: number;
  m: number;
};

export type HWFit = {
  params: HWParams;
  state: HWState;
  /** One-step-ahead fitted values, original units. */
  fitted: number[];
  /** One-step-ahead residuals in LOG space. */
  residuals: number[];
  /** Residual standard deviation in log space. */
  sigma: number;
  sse: number;
};

/* -------------------------------------------------------------------------- */
/* Core recursion                                                             */
/* -------------------------------------------------------------------------- */

function initialState(z: number[], m: number): HWState {
  const seasons = Math.max(1, Math.floor(z.length / m));

  // Season means are precomputed once. Recomputing them per observation makes
  // initialisation O(n·m), which dominates the grid search once this runs for
  // every SKU on the page.
  const means = new Array<number>(seasons);
  for (let k = 0; k < seasons; k++) {
    let sum = 0;
    for (let i = k * m; i < (k + 1) * m; i++) sum += z[i];
    means[k] = sum / m;
  }

  const l0 = means[0];
  const b0 = seasons >= 2 ? (means[1] - l0) / m : 0;

  // Average the detrended deviations across every available season, then
  // centre them so they carry no level.
  const seasonal = new Array<number>(m).fill(0);
  const counts = new Array<number>(m).fill(0);
  for (let i = 0; i < seasons * m && i < z.length; i++) {
    seasonal[i % m] += z[i] - (means[Math.floor(i / m)] || l0);
    counts[i % m]++;
  }
  for (let j = 0; j < m; j++) seasonal[j] /= Math.max(1, counts[j]);
  const mean = seasonal.reduce((a, b) => a + b, 0) / m;
  for (let j = 0; j < m; j++) seasonal[j] -= mean;

  return { level: l0, trend: b0, seasonal, n: 0, m };
}

/** Run the recursion over `z` (log space) and return the terminal state. */
function run(
  z: number[],
  m: number,
  p: HWParams,
  collect: boolean,
  init?: HWState,
): { state: HWState; residuals: number[]; fitted: number[]; sse: number } {
  const st = init ?? initialState(z, m);
  const s = st.seasonal.slice();
  let l = st.level;
  let b = st.trend;

  const residuals: number[] = [];
  const fitted: number[] = [];
  let sse = 0;

  // The first season is consumed by initialisation; scoring from there avoids
  // rewarding a fit for its own starting values.
  const scoreFrom = Math.min(m, z.length);

  for (let t = 0; t < z.length; t++) {
    const idx = t % m;
    const pred = l + p.phi * b + s[idx];
    const err = z[t] - pred;

    if (collect) {
      fitted.push(UNLOG(pred));
      residuals.push(err);
    }
    if (t >= scoreFrom) sse += err * err;

    const lPrev = l;
    l = p.alpha * (z[t] - s[idx]) + (1 - p.alpha) * (lPrev + p.phi * b);
    b = p.beta * (l - lPrev) + (1 - p.beta) * p.phi * b;
    s[idx] = p.gamma * (z[t] - l) + (1 - p.gamma) * s[idx];
  }

  return {
    state: { level: l, trend: b, seasonal: s, n: z.length, m },
    residuals,
    fitted,
    sse,
  };
}

const ALPHAS = [0.04, 0.08, 0.14, 0.22, 0.32, 0.45];
const BETAS = [0.0, 0.02, 0.06, 0.12];
const GAMMAS = [0.02, 0.06, 0.12, 0.22, 0.35];
const PHI = 0.94; // damping: long-horizon trend flattens instead of exploding

/**
 * Fit by grid search on one-step SSE in log space.
 *
 * A grid rather than a gradient optimiser on purpose: the surface is shallow
 * and multi-modal, the grid is fast enough at this data size, and — the part
 * that matters operationally — it is deterministic, so the same series always
 * yields the same parameters and the dashboard never shifts under a user.
 */
export function fitHoltWinters(y: number[], m = 7): HWFit {
  const z = y.map(LOG);
  const init = initialState(z, m);

  let best: HWParams = { alpha: 0.14, beta: 0.02, gamma: 0.12, phi: PHI };
  let bestSse = Infinity;

  for (const alpha of ALPHAS) {
    for (const beta of BETAS) {
      for (const gamma of GAMMAS) {
        const p = { alpha, beta, gamma, phi: PHI };
        const { sse } = run(z, m, p, false, init);
        if (sse < bestSse) {
          bestSse = sse;
          best = p;
        }
      }
    }
  }

  const final = run(z, m, best, true, init);
  const scoreFrom = Math.min(m, z.length);
  const scored = final.residuals.slice(scoreFrom);
  const mean = scored.reduce((a, b) => a + b, 0) / Math.max(1, scored.length);
  const variance =
    scored.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
    Math.max(1, scored.length - 1);

  return {
    params: best,
    state: final.state,
    fitted: final.fitted,
    residuals: final.residuals,
    sigma: Math.sqrt(Math.max(1e-9, variance)),
    sse: final.sse,
  };
}

/** Advance an existing parameterisation over a longer prefix without refitting. */
export function stateFor(y: number[], m: number, p: HWParams): HWState {
  return run(y.map(LOG), m, p, false).state;
}

/** Point forecasts, original units, for h = 1..H. */
export function forecastFrom(state: HWState, p: HWParams, H: number): number[] {
  const out: number[] = [];
  let phiSum = 0;
  for (let h = 1; h <= H; h++) {
    phiSum += Math.pow(p.phi, h);
    const idx = (state.n + h - 1) % state.m;
    out.push(UNLOG(state.level + phiSum * state.trend + state.seasonal[idx]));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Rolling-origin backtest                                                    */
/* -------------------------------------------------------------------------- */

export type { Accuracy, BacktestOptions } from "./backtest";

/**
 * Rolling-origin evaluation. Parameters are fitted ONCE on the earliest
 * training window and then held fixed while the origin walks forward, so no
 * origin is ever scored using information from its own future.
 */
export function backtest(y: number[], opts: BacktestOptions = {}): Accuracy {
  const m = opts.m ?? 7;
  const first = firstCut(y.length, opts);
  if (first == null) return unscored(opts.horizon ?? 14);
  const { params } = fitHoltWinters(y.slice(0, first), m);
  return scoreForecaster(
    y,
    (cut, H) => forecastFrom(stateFor(y.slice(0, cut), m, params), params, H),
    opts,
  );
}

/* -------------------------------------------------------------------------- */
/* The public call                                                            */
/* -------------------------------------------------------------------------- */

export type ForecastPoint = {
  /** Steps ahead, 1-based. */
  h: number;
  mean: number;
  lo80: number;
  hi80: number;
  lo95: number;
  hi95: number;
};

export type ForecastResult = {
  fit: HWFit;
  accuracy: Accuracy;
  points: ForecastPoint[];
  /** In-sample one-step fitted values, aligned to the input series. */
  fitted: number[];
};

const Z80 = 1.2816;
const Z95 = 1.96;

export function forecast(
  y: number[],
  horizon: number,
  opts: BacktestOptions = {},
): ForecastResult {
  const m = opts.m ?? 7;
  const fit = fitHoltWinters(y, m);
  const acc = backtest(y, { ...opts, m, horizon: Math.max(horizon, 14) });
  const means = forecastFrom(fit.state, fit.params, horizon);

  const points: ForecastPoint[] = means.map((mean, i) => {
    const sigma =
      acc.sigmaByHorizon[Math.min(i, acc.sigmaByHorizon.length - 1)] || fit.sigma;
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

  return { fit, accuracy: acc, points, fitted: fit.fitted };
}
