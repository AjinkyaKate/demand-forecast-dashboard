/**
 * Per-day factor breakdown for the chart tooltip.
 *
 * Every percentage comes from a model fitted on this store's sales in the
 * database — none is a hand-set constant. When the driver model is the
 * forecast in use, these are exactly the effects it multiplied into the
 * forecast; otherwise they come from the attribution model and explain the
 * number without having produced it (`mode`).
 *
 * The model works in log space, so effects multiply; the units column splits
 * the day's gap between baseline and value in proportion to each effect's log
 * share, so baseline plus the rows adds up to the value shown (less any
 * effect too small to list).
 */

import type { DayCtx } from "../data/types";
import type { LocalEventDay } from "../db/repository";
import type { DayEffects } from "../forecast/drivers";

export type FactorRow = {
  id: string;
  type: "weather" | "promo" | "holiday" | "price" | "alert" | "local" | "school" | "level";
  label: string;
  pct: number;
  units: number;
};

export type ChartRowFactors = {
  tempF: number | null;
  tempAnomaly: number;
  precipMm: number;
  weatherSource: DayCtx["weatherSource"];
  /** What the day would be with every factor below switched off. */
  baseline: number;
  rows: FactorRow[];
  /** "model": these effects produced the forecast. "explanation": they explain it. */
  mode: "model" | "explanation";
};

/** Effects under half a percent are noise at daily resolution; left out. */
const MIN_PCT = 0.005;

const fmtAttendance = (n: number) =>
  n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(Math.round(n));

export function factorsFor(opts: {
  day: DayCtx;
  /** The day's actual (history) or forecast (future). */
  value: number;
  effects: DayEffects;
  /** Weather alerts and nearby events that day (NWS, PredictHQ). */
  local: LocalEventDay | null;
  /** Log-space recent-level correction; 0 on history days. */
  correction?: number;
  mode: ChartRowFactors["mode"];
}): ChartRowFactors {
  const { day, value, effects, local } = opts;
  const parts: { row: Omit<FactorRow, "pct" | "units">; log: number }[] = [];

  const rain = day.precipMm >= 1 ? ` · ${day.precipMm.toFixed(0)} mm rain` : "";
  parts.push({
    row: {
      id: "weather",
      type: "weather",
      label: `Weather ${day.tempAnomaly >= 0 ? "+" : ""}${day.tempAnomaly.toFixed(0)}°F vs normal${rain}`,
    },
    log: effects.weather,
  });
  parts.push({ row: { id: "promo", type: "promo", label: "Promotions" }, log: effects.promo });
  parts.push({
    row: {
      id: "holiday",
      type: "holiday",
      label: day.holiday ?? (day.nextHoliday ? `Eve of ${day.nextHoliday}` : "Holiday"),
    },
    log: effects.holiday,
  });
  parts.push({ row: { id: "price", type: "price", label: "Price" }, log: effects.price });

  if (Math.abs(effects.alerts) > 0) {
    const titles = local?.alertTitles ?? [];
    const label = titles.length
      ? `${titles[0]}${titles.length > 1 ? ` +${titles.length - 1} more` : ""}`
      : "Weather alert";
    parts.push({ row: { id: "alert", type: "alert", label }, log: effects.alerts });
  }

  if (local && Math.abs(effects.local) > 0) {
    const lead = local.top[0];
    const more = local.top.length > 1 ? ` +${local.top.length - 1} more` : "";
    const label = lead
      ? `${lead.title}${lead.attendance ? ` (${fmtAttendance(lead.attendance)})` : ""}${more}`
      : "Events nearby";
    parts.push({ row: { id: "local", type: "local", label }, log: effects.local });
  }

  if (local && Math.abs(effects.school) > 0) {
    const n = local.schoolBreaks;
    const label = n.length
      ? `School break · ${n[0]}${n.length > 1 ? ` +${n.length - 1} more` : ""}`
      : "School break";
    parts.push({ row: { id: "school", type: "school", label }, log: effects.school });
  }

  if (opts.correction) {
    parts.push({ row: { id: "level", type: "level", label: "Recent-level adjustment" }, log: opts.correction });
  }

  const total = parts.reduce((a, p) => a + p.log, 0);
  const baseline = value / Math.exp(total);
  const gap = value - baseline;

  const rows = parts
    .map((p) => ({
      ...p.row,
      pct: Math.expm1(p.log),
      units: Math.abs(total) > 1e-9 ? (gap * p.log) / total : 0,
    }))
    .filter((r) => Math.abs(r.pct) >= MIN_PCT)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  return {
    tempF: Number.isFinite(day.tempF) ? day.tempF : null,
    tempAnomaly: day.tempAnomaly,
    precipMm: day.precipMm,
    weatherSource: day.weatherSource,
    baseline,
    rows,
    mode: opts.mode,
  };
}
