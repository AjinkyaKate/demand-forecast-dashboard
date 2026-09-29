/**
 * The shared regression design: which columns each input family contributes,
 * and a ridge fit on log1p(demand).
 *
 * One definition used by the production forecast (driver-forecast.ts), the
 * driver attribution (drivers.ts) and the Model Lab ladder (ablation.ts), so
 * the three can never disagree about what "weather" or "events" means.
 */

import type { DayCtx } from "../data/types";

export type Group =
  | "trend"
  | "season"
  | "weekday"
  | "promo"
  | "price"
  | "holiday"
  | "weather"
  | "events";

export const ALL_GROUPS: Group[] = [
  "trend", "season", "weekday", "promo", "price", "holiday", "weather", "events",
];

/** Per-day observable inputs that aren't on the calendar row itself. */
export type FeatureRow = {
  /** Share of volume on promo, 0–1. */
  promo: number;
  /** Volume-weighted discount depth, 0–1. */
  discount: number;
  /** log of the price index (price vs its reference). */
  logPriceIndex: number;
  /** log of the logged-event multiplier in force (events table); 0 = none. */
  eventLog: number;
  /** log1p(predicted attendance / 1000) of events near the store (PredictHQ). */
  localAttendance: number;
  /** 1 on a day with a severe-weather event near the store (PredictHQ). */
  severeWeather: number;
};

export type Column = { name: string; group: Group; values: Float64Array };

export function buildColumns(
  cal: DayCtx[],
  feats: FeatureRow[],
  len: number,
  groups: Group[] = ALL_GROUPS,
): Column[] {
  const want = new Set(groups);
  const cols: Column[] = [];
  const push = (name: string, group: Group, fn: (i: number) => number) => {
    if (!want.has(group)) return;
    const v = new Float64Array(len);
    for (let i = 0; i < len; i++) v[i] = fn(i);
    cols.push({ name, group, values: v });
  };
  const c = cal;

  // Trend in years, so its coefficient reads "per year".
  push("trend", "trend", (i) => c[i].t / 365);
  // Two annual harmonics — smoother and far fewer columns than month dummies.
  for (const k of [1, 2]) {
    push(`year_sin${k}`, "season", (i) => Math.sin((2 * Math.PI * k * c[i].doy) / 365));
    push(`year_cos${k}`, "season", (i) => Math.cos((2 * Math.PI * k * c[i].doy) / 365));
  }
  // Weekday dummies, Sunday as the reference level.
  for (let d = 1; d <= 6; d++) push(`dow_${d}`, "weekday", (i) => (c[i].dow === d ? 1 : 0));

  push("promo", "promo", (i) => feats[i].promo);
  push("discount", "promo", (i) => feats[i].discount);
  push("log_price", "price", (i) => feats[i].logPriceIndex);
  push("holiday", "holiday", (i) => c[i].holidayWeight);
  push("pre_holiday", "holiday", (i) => (c[i].preHoliday ? 1 : 0));
  push("temp_anom", "weather", (i) => c[i].tempAnomaly);
  push("rain", "weather", (i) => Math.log1p(Math.max(0, c[i].precipMm)));
  push("event_log", "events", (i) => feats[i].eventLog);
  push("local_attendance", "events", (i) => feats[i].localAttendance);
  push("severe_weather", "events", (i) => feats[i].severeWeather);
  return cols;
}

/* -------------------------------------------------------------------------- */
/* Ridge                                                                      */
/* -------------------------------------------------------------------------- */

/** Solve Ax = b by Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Penalty on standardised columns: modest, keeps correlated columns' signs stable. */
export const LAMBDA = 2.5;

export type RidgeFit = {
  cols: Column[];
  mean: number[];
  sd: number[];
  beta: number[];
  /** Mean of log1p(y) over the training range — the intercept. */
  yMean: number;
  /** Training rows used. */
  n: number;
};

/** Fit on rows [0, n), standardising on that range only; dead columns dropped. */
export function fitRidge(cols: Column[], y: number[], n: number): RidgeFit | null {
  const stats = cols.map((c) => {
    let m = 0;
    for (let i = 0; i < n; i++) m += c.values[i];
    m /= n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (c.values[i] - m) ** 2;
    return { mean: m, sd: Math.sqrt(v / Math.max(1, n - 1)) };
  });
  const keep = stats.map((s) => s.sd > 1e-9);
  const active = cols.filter((_, j) => keep[j]);
  const st = stats.filter((_, j) => keep[j]);
  const p = active.length;
  if (n < p + 10) return null;

  const z = new Float64Array(n);
  let yMean = 0;
  for (let i = 0; i < n; i++) {
    z[i] = Math.log1p(Math.max(0, y[i]));
    yMean += z[i];
  }
  yMean /= n;

  const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  const row = new Array<number>(p);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) row[a] = (active[a].values[i] - st[a].mean) / st[a].sd;
    const yc = z[i] - yMean;
    for (let a = 0; a < p; a++) {
      Xty[a] += row[a] * yc;
      for (let b = a; b < p; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    XtX[a][a] += LAMBDA;
  }
  const beta = solve(XtX, Xty);
  if (!beta) return null;
  return { cols: active, mean: st.map((s) => s.mean), sd: st.map((s) => s.sd), beta, yMean, n };
}

/** Prediction in log space for row i. */
export function predictLog(fit: RidgeFit, i: number): number {
  let s = fit.yMean;
  for (let a = 0; a < fit.cols.length; a++) {
    s += fit.beta[a] * ((fit.cols[a].values[i] - fit.mean[a]) / fit.sd[a]);
  }
  return s;
}

/** Coefficient per raw unit of a column (log space), or 0 when not in the fit. */
export function rawBeta(fit: RidgeFit, name: string): number {
  const j = fit.cols.findIndex((c) => c.name === name);
  return j < 0 ? 0 : fit.beta[j] / fit.sd[j];
}

/** A day's value of a named column, or 0 when the column isn't in the fit. */
export function columnValue(fit: RidgeFit, name: string, i: number): number {
  const c = fit.cols.find((col) => col.name === name);
  return c ? c.values[i] : 0;
}
