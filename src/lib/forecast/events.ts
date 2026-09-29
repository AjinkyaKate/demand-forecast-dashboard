/**
 * Joining API events (NWS alerts, PredictHQ) to dates, to name the likely
 * cause of an anomaly.
 */

import { daysBetween } from "../format";
import type { OpsEvent } from "../data/types";

/** An event running longer than this is a standing condition, not an incident. */
export const STRUCTURAL_DAYS = 30;

export function eventLengthDays(ev: OpsEvent): number {
  return daysBetween(ev.start, ev.end) + 1;
}

/**
 * Events overlapping a date, split into acute causes and standing context.
 *
 * A months-long condition overlaps every anomaly in its window, so date
 * overlap alone would name it as the cause of all of them. Short windows
 * explain a single bad Tuesday; long ones are background, surfaced separately.
 * Acute events are returned shortest-first.
 */
export function eventsOn(
  date: string,
  events: OpsEvent[],
): { causes: OpsEvent[]; context: OpsEvent[] } {
  const hits = events.filter((ev) => date >= ev.start && date <= ev.end);
  const causes = hits
    .filter((ev) => eventLengthDays(ev) <= STRUCTURAL_DAYS)
    .sort((a, b) => eventLengthDays(a) - eventLengthDays(b));
  const context = hits.filter((ev) => eventLengthDays(ev) > STRUCTURAL_DAYS);
  return { causes, context };
}
