/**
 * Model Lab — what does each input actually buy us?
 *
 * An ablation ladder: the same demand series is forecast by a sequence of
 * models, each adding one family of inputs to the one before it, and every
 * rung is scored on the identical rolling-origin backtest. The difference in
 * error between two adjacent rungs is what that input family contributes.
 *
 *   Seasonal naive          last week, repeated — the bar any model must clear
 *   Holt-Winters            sales history only
 *   Calendar regression     trend + season + weekday
 *   + Promotions & price
 *   + Holidays              public holidays (Nager.Date)
 *   + Weather               temperature vs the store's normal, and rain (Open-Meteo)
 *   + Events                logged events, and events near the store (PredictHQ)
 *   + Recent-level correction   = the driver model used in production
 *
 * The regression rungs share their design with the production forecast
 * (design.ts), refitted at every origin on that origin's past only. Two
 * foresight caveats, both shown in the UI: backtest weather uses the observed
 * temperature (live, the forecast uses Open-Meteo's forecast, which is worse),
 * and logged events use their logged window (a festival is known ahead; a
 * cooler failure is not). So those two rungs are upper bounds.
 */

import type { DayCtx } from "../data/types";
import { buildColumns, fitRidge, predictLog, rawBeta, type FeatureRow, type Group } from "./design";
import { driverForecaster } from "./driver-forecast";
import { fitHoltWinters, forecastFrom, stateFor } from "./holt-winters";

export type StepId =
  | "naive"
  | "hw"
  | "calendar"
  | "promo"
  | "holiday"
  | "weather"
  | "events"
  | "production";

type StepDef = {
  id: StepId;
  label: string;
  /** What this rung adds over the one before it. */
  adds: string;
  groups: Group[] | null;
};

const BASE: Group[] = ["trend", "season", "weekday"];
const STEPS: StepDef[] = [
  { id: "naive", label: "Seasonal naive", adds: "Repeats last week", groups: null },
  { id: "hw", label: "Holt-Winters", adds: "Sales history only", groups: null },
  { id: "calendar", label: "Calendar", adds: "Trend, season of year, day of week", groups: BASE },
  { id: "promo", label: "+ Promotions & price", adds: "Promo plan, discount depth, price index", groups: [...BASE, "promo", "price"] },
  { id: "holiday", label: "+ Holidays", adds: "Public holidays and the day before", groups: [...BASE, "promo", "price", "holiday"] },
  { id: "weather", label: "+ Weather", adds: "Temperature vs the store's normal, and rain", groups: [...BASE, "promo", "price", "holiday", "weather"] },
  { id: "events", label: "+ Events", adds: "Logged events and events near the store", groups: [...BASE, "promo", "price", "holiday", "weather", "events"] },
  { id: "production", label: "+ Recent-level correction", adds: "Follows level shifts the inputs don't explain", groups: null },
];

/** Per-day inputs, spanning at least the history. */
export type LabInputs = {
  y: number[];
  cal: DayCtx[];
  feats: FeatureRow[];
  /** Label of the event(s) active on a day, for the miss table. */
  eventLabel: (string | null)[];
};

export type Metrics = {
  wape: number;
  bias: number;
  mape: number;
  /** Error of the single worst day, as a fraction of that day's actual. */
  worstDay: number;
};

export type StepResult = {
  id: StepId;
  label: string;
  adds: string;
  metrics: Metrics;
  /** WAPE change vs the rung before, in fraction points. Negative = better. */
  deltaWape: number | null;
  /** One WAPE per origin window. */
  windowWape: number[];
  /** Stitched backtest forecasts, aligned to `backtest.dates`. */
  predictions: number[];
  /** Number of regression inputs. Null for the time-series models. */
  inputs: number | null;
};

export type Learned = {
  id: string;
  label: string;
  value: string;
  meaning: string;
};

export type LabResult = {
  horizon: number;
  windows: { start: string; end: string }[];
  backtest: { dates: string[]; actual: number[] };
  steps: StepResult[];
  /** The rung the live forecast uses: the lower-error of Holt-Winters and production. */
  inProduction: StepId;
  learned: Learned[];
  misses: {
    date: string;
    actual: number;
    hw: number;
    full: number;
    context: string[];
  }[];
  trainDays: number;
};

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

function score(actual: number[], pred: number[]): Metrics {
  let abs = 0;
  let signedErr = 0;
  let sum = 0;
  let mape = 0;
  let mapeN = 0;
  let worst = 0;
  for (let i = 0; i < actual.length; i++) {
    const e = pred[i] - actual[i];
    abs += Math.abs(e);
    signedErr += e;
    sum += actual[i];
    if (actual[i] > 0) {
      const pe = Math.abs(e) / actual[i];
      mape += pe;
      mapeN++;
      worst = Math.max(worst, pe);
    }
  }
  return {
    wape: sum > 0 ? abs / sum : NaN,
    bias: sum > 0 ? signedErr / sum : NaN,
    mape: mapeN > 0 ? mape / mapeN : NaN,
    worstDay: worst,
  };
}

/* -------------------------------------------------------------------------- */
/* The ladder                                                                 */
/* -------------------------------------------------------------------------- */

export type LabOptions = {
  horizon?: number;
  windows?: number;
  /** Minimum training days before the first origin. */
  minTrain?: number;
};

/** Backtest one regression rung; returns stitched predictions. */
function runRegression(inp: LabInputs, groups: Group[], cuts: number[], H: number) {
  const n = inp.y.length;
  const cols = buildColumns(inp.cal, inp.feats, n, groups);
  const out: number[] = [];
  let inputs = 0;
  for (const cut of cuts) {
    const fit = fitRidge(cols, inp.y, cut);
    inputs = fit?.cols.length ?? 0;
    const mean = inp.y.slice(0, cut).reduce((a, b) => a + b, 0) / cut;
    for (let h = 0; h < H; h++) {
      // An under-determined fit falls back to the training mean rather than
      // pretending — it shows up as a bad rung, which is the honest outcome.
      out.push(fit ? Math.max(0, Math.expm1(predictLog(fit, cut + h))) : mean);
    }
  }
  return { predictions: out, inputs };
}

export function runLab(inp: LabInputs, opts: LabOptions = {}): LabResult | null {
  const H = opts.horizon ?? 14;
  const n = inp.y.length;
  const minTrain = opts.minTrain ?? 120;
  const windows = Math.min(opts.windows ?? 8, Math.floor((n - minTrain) / H));
  if (windows < 2) return null;

  // Eight 14-day windows match the production backtest in holt-winters.ts, so
  // the Holt-Winters rung reproduces the accuracy shown on the workspace pages.
  // Non-overlapping windows that tile the last `windows × H` days, so the
  // stitched forecast reads as one continuous line.
  const cuts = Array.from({ length: windows }, (_, o) => n - (windows - o) * H);
  const btDates: string[] = [];
  const btActual: number[] = [];
  for (const cut of cuts) {
    for (let h = 0; h < H; h++) {
      btDates.push(inp.cal[cut + h].date);
      btActual.push(inp.y[cut + h]);
    }
  }

  const preds = new Map<StepId, { predictions: number[]; inputs: number | null }>();

  // Seasonal naive.
  preds.set("naive", {
    inputs: null,
    predictions: cuts.flatMap((cut) =>
      Array.from({ length: H }, (_, h) => inp.y[cut - 7 + (h % 7)]),
    ),
  });

  // Holt-Winters, parameters fitted once on the earliest window, as in production.
  {
    const { params } = fitHoltWinters(inp.y.slice(0, cuts[0]), 7);
    const p: number[] = [];
    for (const cut of cuts) {
      const state = stateFor(inp.y.slice(0, cut), 7, params);
      p.push(...forecastFrom(state, params, H));
    }
    preds.set("hw", { predictions: p, inputs: null });
  }

  for (const s of STEPS) {
    if (s.groups) preds.set(s.id, runRegression(inp, s.groups, cuts, H));
  }

  // The production driver model: every input plus the recent-level correction.
  {
    const f = driverForecaster(inp.cal, inp.feats, inp.y);
    preds.set("production", {
      predictions: cuts.flatMap((cut) => f(cut, H)),
      inputs: preds.get("events")!.inputs,
    });
  }

  const steps: StepResult[] = [];
  let prevWape: number | null = null;
  for (const s of STEPS) {
    const r = preds.get(s.id)!;
    const metrics = score(btActual, r.predictions);
    const windowWape = cuts.map((_, o) =>
      score(btActual.slice(o * H, o * H + H), r.predictions.slice(o * H, o * H + H)).wape,
    );
    // Holt-Winters and naive are separate baselines, not rungs on the ladder;
    // the ladder's first step is measured against Holt-Winters.
    const delta = s.id === "naive" || prevWape == null ? null : metrics.wape - prevWape;
    steps.push({
      id: s.id,
      label: s.label,
      adds: s.adds,
      metrics,
      deltaWape: delta,
      windowWape,
      predictions: r.predictions,
      inputs: r.inputs,
    });
    if (s.id !== "naive") prevWape = metrics.wape;
  }

  // What the full model learned, fitted on the whole history.
  const fullCols = buildColumns(inp.cal, inp.feats, n);
  const full = fitRidge(fullCols, inp.y, n);
  const learned: Learned[] = [];
  if (full) {
    const used = new Set(full.cols.map((c) => c.name));
    const b = (name: string) => (used.has(name) ? rawBeta(full, name) : null);
    const pct = (v: number | null, scale = 1) => (v == null ? null : Math.expm1(v * scale));
    const fmt = (v: number | null, d = 1) => {
      if (v == null) return "not used";
      const s = (v * 100).toFixed(d);
      // Never print "-0%": a value that rounds to zero reads as flat.
      if (Number(s) === 0) return `${(0).toFixed(d)}%`;
      return `${v > 0 ? "+" : ""}${s}%`;
    };

    const trend = pct(b("trend"));
    learned.push({ id: "trend", label: "Underlying trend", value: fmt(trend), meaning: "Change in demand per year, all else equal" });

    // Sunday is the reference level (effect 0), so it competes for busiest
    // and quietest like every other day.
    const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dowFx = dows.map((_, d) => (d === 0 ? 0 : (pct(b(`dow_${d}`)) ?? 0)));
    const hi = dowFx.indexOf(Math.max(...dowFx));
    const lo = dowFx.indexOf(Math.min(...dowFx));
    learned.push({
      id: "weekday",
      label: "Day of week",
      value: `${dows[hi]} ${fmt(dowFx[hi], 0)} · ${dows[lo]} ${fmt(dowFx[lo], 0)}`,
      meaning: "Busiest and quietest day, relative to Sunday",
    });

    const promo = pct(b("promo"), 0.1);
    learned.push({ id: "promo", label: "Promotions", value: fmt(promo), meaning: "Lift for every 10% of volume on promo" });

    const price = b("log_price");
    learned.push({
      id: "price",
      label: "Price",
      value: price == null ? "not used" : fmt(Math.expm1(price * Math.log(1.01)), 2),
      meaning: "Demand change for a 1% price increase",
    });

    const hol = pct(b("holiday"));
    const pre = pct(b("pre_holiday"));
    learned.push({ id: "holiday", label: "Holidays", value: `${fmt(hol, 0)} · eve ${fmt(pre, 0)}`, meaning: "A public holiday, and the day before it" });

    const temp = pct(b("temp_anom"), 1);
    learned.push({ id: "weather", label: "Temperature", value: `${fmt(temp, 2)} per °F`, meaning: "Demand change per °F above this store's normal" });

    // log1p(10 mm) — a properly wet day.
    const rain = pct(b("rain"), Math.log1p(10));
    learned.push({ id: "rain", label: "Rain", value: fmt(rain, 1), meaning: "Demand change on a 10 mm rain day" });

    // log1p(10) — 10,000 people at events nearby.
    const att = pct(b("local_attendance"), Math.log1p(10));
    learned.push({ id: "local", label: "Events nearby", value: fmt(att, 1), meaning: "Demand change with 10,000 people at events within 10 km (PredictHQ)" });

    const ev = b("event_log");
    learned.push({
      id: "events",
      label: "Events",
      value: ev == null ? "not used" : `${(ev * 100).toFixed(0)}% of logged effect`,
      meaning: "How much of each event's logged impact shows up in sales (100% = exactly as logged)",
    });
  }

  // Where the production model misses most, and whether the full model fixes it.
  const hw = preds.get("hw")!.predictions;
  const fullPred = preds.get("production")!.predictions;
  const idx0 = cuts[0];
  const misses = btActual
    .map((a, k) => ({ k, err: Math.abs(hw[k] - a) }))
    .sort((a, b) => b.err - a.err)
    .slice(0, 8)
    .map(({ k }) => {
      const i = idx0 + k;
      const c = inp.cal[i];
      const context: string[] = [];
      if (inp.eventLabel[i]) context.push(inp.eventLabel[i]!);
      if (c.holiday) context.push(c.holiday);
      else if (c.preHoliday) context.push("Day before a holiday");
      if (Math.abs(c.tempAnomaly) >= 8) {
        context.push(`${c.tempAnomaly > 0 ? "+" : ""}${c.tempAnomaly.toFixed(0)}°F vs normal`);
      }
      if (c.precipMm >= 10) context.push(`${c.precipMm.toFixed(0)} mm rain`);
      if (inp.feats[i].promo >= 0.25) context.push(`${Math.round(inp.feats[i].promo * 100)}% of volume on promo`);
      return { date: c.date, actual: btActual[k], hw: hw[k], full: fullPred[k], context };
    });

  const hwWape = steps.find((x) => x.id === "hw")!.metrics.wape;
  const prodWape = steps.find((x) => x.id === "production")!.metrics.wape;

  return {
    horizon: H,
    inProduction: Number.isFinite(prodWape) && prodWape < hwWape ? "production" : "hw",
    windows: cuts.map((cut) => ({ start: inp.cal[cut].date, end: inp.cal[cut + H - 1].date })),
    backtest: { dates: btDates, actual: btActual },
    steps,
    learned,
    misses,
    trainDays: cuts[0],
  };
}
