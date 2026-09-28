/**
 * Driver attribution — "why is demand moving?"
 *
 * A ridge regression of log1p(demand) on the features an operator can actually
 * observe: calendar position, weekday, promo calendar, holidays, temperature
 * departure and price index. Each driver's reported effect is the model's
 * fitted coefficient applied to that driver's values over the forecast window,
 * relative to the series' own historical average.
 *
 * Because the model is fitted in log space, effects are naturally
 * multiplicative and are reported that way — "weekday pattern: +8 %" means the
 * forecast window's mix of weekdays lifts demand 8 % above an average week.
 * That is the honest native unit; the units column in the table view is a
 * bridge computed in a fixed, disclosed order (see `bridgeUnits`).
 *
 * Ridge rather than OLS because the harmonic and dummy columns are correlated;
 * the penalty keeps a driver from borrowing another's effect and flipping sign.
 */

import type { DayCtx } from "../data/generate";

export type DriverGroupId =
  | "trend"
  | "season"
  | "weekday"
  | "promo"
  | "holiday"
  | "weather"
  | "price";

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
  { id: "holiday", label: "Holidays", hint: "Holiday traffic and the stock-up day before" },
  { id: "weather", label: "Weather", hint: "Temperature departure from seasonal normal" },
  { id: "price", label: "Price", hint: "Effective price vs its trailing average" },
];

/** Fixed bridge order for the additive units decomposition. Disclosed in the UI. */
const BRIDGE_ORDER: DriverGroupId[] = [
  "trend",
  "season",
  "weekday",
  "promo",
  "holiday",
  "weather",
  "price",
];

export type FeatureRow = {
  promo: number;
  discount: number;
  logPriceIndex: number;
};

type Column = { name: string; group: DriverGroupId; values: number[] };

/* -------------------------------------------------------------------------- */
/* Design matrix                                                              */
/* -------------------------------------------------------------------------- */

function buildColumns(cal: DayCtx[], feats: FeatureRow[], n: number): Column[] {
  const cols: Column[] = [];
  const push = (name: string, group: DriverGroupId, fn: (i: number) => number) =>
    cols.push({ name, group, values: Array.from({ length: n }, (_, i) => fn(i)) });

  // Trend, scaled to years so the coefficient reads as "per year".
  push("trend", "trend", (i) => cal[i].t / 365);

  // Two annual harmonics — smoother and far fewer columns than 11 month dummies.
  for (const k of [1, 2]) {
    push(`year_sin${k}`, "season", (i) => Math.sin((2 * Math.PI * k * cal[i].doy) / 365));
    push(`year_cos${k}`, "season", (i) => Math.cos((2 * Math.PI * k * cal[i].doy) / 365));
  }

  // Weekday dummies, Sunday as the reference level.
  for (let d = 1; d <= 6; d++) {
    push(`dow_${d}`, "weekday", (i) => (cal[i].dow === d ? 1 : 0));
  }

  push("promo", "promo", (i) => feats[i].promo);
  push("discount", "promo", (i) => feats[i].discount);
  push("holiday", "holiday", (i) => cal[i].holidayWeight);
  push("pre_holiday", "holiday", (i) => (cal[i].preHoliday ? 1 : 0));
  push("temp_anom", "weather", (i) => cal[i].tempAnomaly);
  push("log_price", "price", (i) => feats[i].logPriceIndex);

  return cols;
}

/* -------------------------------------------------------------------------- */
/* Ridge solve                                                                */
/* -------------------------------------------------------------------------- */

/** Solve Ax = b by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    }
    if (Math.abs(M[pivot][c]) < 1e-12) return null;
    [M[c], M[pivot]] = [M[pivot], M[c]];

    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
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

const LAMBDA = 2.5; // on standardised columns; modest, keeps signs stable

/**
 * Fit the driver model on history and evaluate it over a forward window.
 *
 * @param cal        calendar rows covering history AND the forecast window
 * @param feats      observable feature rows, same length as `cal`
 * @param y          historical demand; its length defines the training range
 * @param windowFrom first index of the forecast window
 * @param windowTo   last index of the forecast window, inclusive
 */
export function fitDrivers(
  cal: DayCtx[],
  feats: FeatureRow[],
  y: number[],
  windowFrom: number,
  windowTo: number,
): DriverModel {
  const n = y.length;
  const cols = buildColumns(cal, feats, cal.length);
  const target = y.map((v) => Math.log1p(Math.max(0, v)));

  // Standardise on the TRAINING range only, then drop dead columns.
  const stats = cols.map((c) => {
    const hist = c.values.slice(0, n);
    const mean = hist.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(
      hist.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1),
    );
    return { mean, sd };
  });

  const keep = cols.map((_, j) => stats[j].sd > 1e-9);
  const active = cols.filter((_, j) => keep[j]);
  const activeStats = stats.filter((_, j) => keep[j]);
  const p = active.length;

  const degenerateResult = (): DriverModel => ({
    effects: DRIVER_GROUPS.map((g) => ({
      id: g.id, label: g.label, hint: g.hint, effect: 0, units: 0,
    })),
    r2: 0,
    baselinePerDay: y.reduce((a, b) => a + b, 0) / Math.max(1, n),
    expectedPerDay: y.reduce((a, b) => a + b, 0) / Math.max(1, n),
    degenerate: true,
  });

  if (p === 0 || n < p + 10) return degenerateResult();

  const X: number[][] = Array.from({ length: n }, (_, i) =>
    active.map((c, j) => (c.values[i] - activeStats[j].mean) / activeStats[j].sd),
  );
  const yMean = target.reduce((a, b) => a + b, 0) / n;
  const yc = target.map((v) => v - yMean);

  // Normal equations with a ridge penalty: (X'X + λI)β = X'y
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = X[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += row[a] * yc[i];
      for (let b = a; b < p; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    XtX[a][a] += LAMBDA;
  }

  const beta = solve(XtX, Xty);
  if (!beta) return degenerateResult();

  // R² on the training range.
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    let pred = 0;
    for (let a = 0; a < p; a++) pred += X[i][a] * beta[a];
    ssRes += (yc[i] - pred) * (yc[i] - pred);
    ssTot += yc[i] * yc[i];
  }
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  // Log-space contribution of each group over the forecast window, measured
  // against the historical mean of each feature (so "0" means "an average
  // stretch of this series", which is the comparison a buyer has in mind).
  const wLen = windowTo - windowFrom + 1;
  const logContrib = new Map<DriverGroupId, number>();
  for (const g of DRIVER_GROUPS) logContrib.set(g.id, 0);

  for (let a = 0; a < p; a++) {
    const col = active[a];
    const st = activeStats[a];
    let sum = 0;
    for (let i = windowFrom; i <= windowTo; i++) {
      sum += (col.values[i] - st.mean) / st.sd;
    }
    const contribution = (beta[a] * sum) / wLen;
    logContrib.set(col.group, (logContrib.get(col.group) ?? 0) + contribution);
  }

  // Baseline = geometric mean of historical demand, i.e. the level the log
  // model regresses toward once every driver sits at its historical average.
  const baselinePerDay = Math.expm1(yMean);
  const totalLog = [...logContrib.values()].reduce((a, b) => a + b, 0);
  const expectedPerDay = Math.expm1(yMean + totalLog);

  // Units bridge: walk the fixed order, multiplying one driver in at a time.
  // Ordering-dependent by nature, which is why the order is fixed and shown.
  const units = new Map<DriverGroupId, number>();
  let running = yMean;
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

  return { effects, r2, baselinePerDay, expectedPerDay, degenerate: false };
}

/** The fixed bridge order, for disclosure in the UI. */
export const BRIDGE_ORDER_LABELS = BRIDGE_ORDER.map(
  (id) => DRIVER_GROUPS.find((g) => g.id === id)!.label,
);
