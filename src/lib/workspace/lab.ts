/**
 * Model Lab workspace — assembles the ablation inputs for one store and one
 * demand stream from the database, then runs the ladder.
 */

import type { StoreId } from "../data/types";
import {
  getCalendar,
  getDataInventory,
  getEvents,
  getFuelSeries,
  getItemSeries,
  getLocalEventDays,
  getSkus,
  getStore,
  memo,
  type DataInventory,
} from "../db/repository";
import { runLab, type LabInputs, type LabResult } from "../forecast/ablation";
import type { FeatureRow } from "../forecast/design";
import { eventApplies, eventLengthDays, STRUCTURAL_DAYS } from "../forecast/events";
import { itemEventExposure, localFeatures } from "./items";

export type LabStream = "items" | "fuel";

export type LabWorkspace = {
  storeId: StoreId;
  storeName: string;
  stream: LabStream;
  unit: string;
  historyDays: number;
  lab: LabResult | null;
  data: DataInventory;
};

/** Acute events first; a months-long condition is labelled as ongoing. */
function labelsFor(
  date: string,
  target: "inside" | "fuel",
  categories: Set<string> | null,
  nearby?: string,
) {
  const live = getEvents().filter(
    (ev) =>
      date >= ev.start &&
      date <= ev.end &&
      (target === "fuel"
        ? eventApplies(ev, "fuel", null)
        : [...(categories ?? [])].some((c) => eventApplies(ev, "inside", c))),
  );
  const labels = live
    .map((ev) => ({ ev, long: eventLengthDays(ev) > STRUCTURAL_DAYS }))
    .sort((a, b) => Number(a.long) - Number(b.long))
    .map(({ ev, long }) => (long ? `${ev.label} (ongoing)` : ev.label));
  if (nearby) labels.unshift(`Nearby: ${nearby}`);
  return labels.length ? labels.join(" · ") : null;
}

function buildInputs(storeId: StoreId, stream: LabStream): LabInputs | null {
  const cal = getCalendar(storeId, stream);
  if (!cal.length) return null;

  if (stream === "items") {
    const series = getItemSeries(storeId);
    if (!series.length) return null;
    const categoryOf = new Map(getSkus().map((s) => [s.id, s.category]));
    const n = series[0].units.length;
    const y = new Array<number>(n).fill(0);
    for (const s of series) for (let i = 0; i < n; i++) y[i] += s.units[i];

    // Volume shares over the whole history weight every per-SKU column.
    const vol = series.map((s) => Math.max(1e-6, s.units.reduce((a, b) => a + b, 0)));
    const total = vol.reduce((a, b) => a + b, 0);
    const w = vol.map((v) => v / total);
    const exposure = itemEventExposure(
      cal,
      series.map((s, k) => ({ category: categoryOf.get(s.skuId) ?? "", weight: w[k] })),
      getEvents(),
    );
    const cats = new Set(series.map((s) => categoryOf.get(s.skuId) ?? ""));

    const local = getLocalEventDays(storeId, cal);
    const feats: FeatureRow[] = cal.map((_, i) => {
      let promo = 0;
      let discount = 0;
      let logPrice = 0;
      for (let k = 0; k < series.length; k++) {
        promo += (series[k].onPromo[i] ? 1 : 0) * w[k];
        discount += series[k].discount[i] * w[k];
        logPrice += Math.log(series[k].priceIndex[i]) * w[k];
      }
      return { promo, discount, logPriceIndex: logPrice, eventLog: exposure.total[i], ...localFeatures(local[i]) };
    });
    return {
      y,
      cal,
      feats,
      eventLabel: cal.map((d, i) => labelsFor(d.date, "inside", cats, local[i]?.top[0]?.title)),
    };
  }

  const series = getFuelSeries(storeId);
  if (!series.length) return null;
  const n = series[0].gallons.length;
  const y = new Array<number>(n).fill(0);
  for (const s of series) for (let i = 0; i < n; i++) y[i] += s.gallons[i];
  const vol = series.map((s) => Math.max(1e-6, s.gallons.reduce((a, b) => a + b, 0)));
  const total = vol.reduce((a, b) => a + b, 0);
  const events = getEvents();

  const local = getLocalEventDays(storeId, cal);
  const feats: FeatureRow[] = cal.map((d, i) => ({
    promo: 0,
    discount: 0,
    logPriceIndex: series.reduce((a, s, k) => a + Math.log(s.priceIndex[i]) * (vol[k] / total), 0),
    eventLog: events
      .filter((ev) => d.date >= ev.start && d.date <= ev.end && eventApplies(ev, "fuel", null))
      .reduce((a, ev) => a + Math.log(ev.effect), 0),
    ...localFeatures(local[i]),
  }));
  return {
    y,
    cal,
    feats,
    eventLabel: cal.map((d, i) => labelsFor(d.date, "fuel", null, local[i]?.top[0]?.title)),
  };
}

export function buildLabWorkspace(storeId: StoreId, stream: LabStream): LabWorkspace {
  return memo(`lab:${storeId}:${stream}`, () => {
    const inputs = buildInputs(storeId, stream);
    return {
      storeId,
      storeName: getStore(storeId)?.name ?? storeId,
      stream,
      unit: stream === "items" ? "units" : "gallons",
      historyDays: inputs?.y.length ?? 0,
      lab: inputs ? runLab(inputs) : null,
      data: getDataInventory(storeId, stream),
    };
  });
}
