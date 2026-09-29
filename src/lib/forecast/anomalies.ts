/**
 * Anomaly detection on forecast residuals.
 *
 * The detector is deliberately blind to the ops-event log: it scores the
 * model's own one-step residuals and nothing else. The UI then *joins* a
 * detected date against the ops log to suggest a cause. That separation is the
 * point — an operator can trust that an anomaly was found, not assumed, and
 * an anomaly with no matching event is a genuine "we don't know why yet".
 */

import type { OpsEvent } from "../data/types";
import { eventsOn } from "./events";
import type { HWFit } from "./holt-winters";

export type Anomaly = {
  date: string;
  /** Index into the source series. */
  index: number;
  actual: number;
  expected: number;
  /** Robust z-score of the log residual. */
  z: number;
  direction: "spike" | "drop";
  /** Actual vs expected, as a signed fraction. */
  deviation: number;
  /** Units (or gallons) above/below expectation. */
  delta: number;
  severity: "critical" | "serious" | "warning";
  /** Short, dated ops-log entries that plausibly explain this day. */
  causes: OpsEvent[];
  /** Standing conditions in force on this date (competitor opening, etc.). */
  context: OpsEvent[];
};

/** Median of a copy — the input is not mutated. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Robust scale via the median absolute deviation.
 *
 * A plain standard deviation is inflated by the very outliers we are hunting,
 * which is how a detector ends up missing the biggest event in the series.
 * 1.4826 rescales MAD to be a consistent estimator of sigma under normality.
 */
function mad(xs: number[], center: number): number {
  return 1.4826 * median(xs.map((x) => Math.abs(x - center)));
}

export type DetectOptions = {
  /** |z| above this is an anomaly. */
  threshold?: number;
  /** Ignore the model's burn-in period. */
  warmup?: number;
  /** Only consider the trailing N observations. */
  lookback?: number;
  /** The event log to name likely causes from. */
  events?: OpsEvent[];
};

export function detectAnomalies(
  dates: string[],
  actuals: number[],
  fit: HWFit,
  opts: DetectOptions = {},
): Anomaly[] {
  const threshold = opts.threshold ?? 3;
  const warmup = opts.warmup ?? 28;

  const res = fit.residuals;
  const scored = res.slice(warmup);
  const center = median(scored);
  const scale = mad(scored, center);
  if (!Number.isFinite(scale) || scale < 1e-6) return [];

  const from = opts.lookback
    ? Math.max(warmup, actuals.length - opts.lookback)
    : warmup;

  const out: Anomaly[] = [];
  for (let i = from; i < actuals.length; i++) {
    const z = (res[i] - center) / scale;
    if (Math.abs(z) < threshold) continue;

    const expected = fit.fitted[i];
    const actual = actuals[i];
    const deviation = expected > 0 ? (actual - expected) / expected : 0;

    out.push({
      date: dates[i],
      index: i,
      actual,
      expected,
      z,
      direction: z > 0 ? "spike" : "drop",
      deviation,
      delta: actual - expected,
      severity:
        Math.abs(z) >= 5 ? "critical" : Math.abs(z) >= 4 ? "serious" : "warning",
      ...eventsOn(dates[i], opts.events ?? []),
    });
  }

  // Most recent first — an operator cares about last week before last year.
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Collapse consecutive daily anomalies into one incident.
 *
 * A four-day cooler outage is one thing that happened, not four findings. The
 * list is for humans deciding what to act on, so it counts incidents.
 */
export function groupAnomalies(anomalies: Anomaly[]): Anomaly[][] {
  const asc = [...anomalies].sort((a, b) => (a.date < b.date ? -1 : 1));
  const groups: Anomaly[][] = [];
  for (const a of asc) {
    const last = groups[groups.length - 1];
    if (last && a.index - last[last.length - 1].index <= 2) last.push(a);
    else groups.push([a]);
  }
  return groups.reverse();
}
