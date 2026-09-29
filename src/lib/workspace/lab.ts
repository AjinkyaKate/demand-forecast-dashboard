/**
 * Model Lab workspace — assembles the ablation inputs for one store and one
 * demand stream from the database, then runs the ladder.
 */

import type { StoreId } from "../data/types";
import {
  getCalendar,
  getDataInventory,
  getFuelSeries,
  getItemSeries,
  getLocalEventDays,
  getStore,
  memo,
  type DataInventory,
  type LocalEventDay,
} from "../db/repository";
import { runLab, type LabInputs, type LabResult } from "../forecast/ablation";
import type { FeatureRow } from "../forecast/design";
import { localFeatures, shelfLogPrice } from "./items";

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

/** What was going on near the store that day, for the miss table. */
function labelFor(d: LocalEventDay | undefined): string | null {
  if (!d) return null;
  const labels = [
    ...d.alertTitles,
    ...d.top.slice(0, 1).map((e) => `Nearby: ${e.title}`),
    ...(d.schoolBreaks.length ? [`School break (${d.schoolBreaks.length} district${d.schoolBreaks.length > 1 ? "s" : ""})`] : []),
  ];
  return labels.length ? labels.join(" · ") : null;
}

function buildInputs(storeId: StoreId, stream: LabStream): LabInputs | null {
  const cal = getCalendar(storeId, stream);
  if (!cal.length) return null;
  const local = getLocalEventDays(storeId, cal);
  const eventLabel = cal.map((_, i) => labelFor(local[i]));

  if (stream === "items") {
    const series = getItemSeries(storeId);
    if (!series.length) return null;
    const n = series[0].units.length;
    const y = new Array<number>(n).fill(0);
    for (const s of series) for (let i = 0; i < n; i++) y[i] += s.units[i];

    // Volume shares over the whole history weight every per-SKU column.
    const vol = series.map((s) => Math.max(1e-6, s.units.reduce((a, b) => a + b, 0)));
    const total = vol.reduce((a, b) => a + b, 0);
    const w = vol.map((v) => v / total);
    const feats: FeatureRow[] = cal.map((_, i) => {
      let promo = 0;
      let discount = 0;
      let logPrice = 0;
      for (let k = 0; k < series.length; k++) {
        promo += (series[k].onPromo[i] ? 1 : 0) * w[k];
        discount += series[k].discount[i] * w[k];
        logPrice += shelfLogPrice(series[k], i) * w[k];
      }
      return { promo, discount, logPriceIndex: logPrice, ...localFeatures(local[i]) };
    });
    return { y, cal, feats, eventLabel };
  }

  const series = getFuelSeries(storeId);
  if (!series.length) return null;
  const n = series[0].gallons.length;
  const y = new Array<number>(n).fill(0);
  for (const s of series) for (let i = 0; i < n; i++) y[i] += s.gallons[i];
  const vol = series.map((s) => Math.max(1e-6, s.gallons.reduce((a, b) => a + b, 0)));
  const total = vol.reduce((a, b) => a + b, 0);
  const feats: FeatureRow[] = cal.map((_, i) => ({
    promo: 0,
    discount: 0,
    logPriceIndex: series.reduce((a, s, k) => a + Math.log(s.priceIndex[i]) * (vol[k] / total), 0),
    ...localFeatures(local[i]),
  }));
  return { y, cal, feats, eventLabel };
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
