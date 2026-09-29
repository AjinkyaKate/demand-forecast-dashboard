/**
 * Model smoke test. Run: npx tsx scripts/smoke.ts
 *
 * Verifies the data in SQLite and the forecaster produce sane,
 * non-degenerate numbers before any of it is wired to a chart.
 */

import {
  getAsOf,
  getCalendar,
  getEvents,
  getFuelGrades,
  getFuelSeries,
  getItemSeries,
  getSkus,
  getStores,
} from "../src/lib/db/repository";
import { forecast } from "../src/lib/forecast/holt-winters";
import { detectAnomalies, groupAnomalies } from "../src/lib/forecast/anomalies";
import { fitDrivers } from "../src/lib/forecast/drivers";

const pct = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "n/a");
const num = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d });

const t0 = Date.now();
const STORE = getStores()[0].id;
const cal = getCalendar(STORE);
const origin = cal.filter((d) => !d.isFuture).length;
const FUEL_GRADES = getFuelGrades();
const SKU_BY_ID = new Map(getSkus().map((s) => [s.id, s]));

console.log(`store ${STORE} · as-of ${getAsOf()} · calendar ${cal.length} days · history ${origin}`);
console.log(`first ${cal[0].date} · last history ${cal[origin - 1].date} · last future ${cal[cal.length - 1].date}`);
console.log(`skus ${SKU_BY_ID.size} · fuel grades ${FUEL_GRADES.length}\n`);

/* --- Items ---------------------------------------------------------------- */

const items = getItemSeries(STORE);
console.log(`items generated in ${Date.now() - t0}ms · ${items.length} series × ${items[0].units.length} days\n`);

// Store-level total (the headline series)
const total = new Array(items[0].units.length).fill(0);
for (const s of items) for (let i = 0; i < s.units.length; i++) total[i] += s.units[i];

const tf = Date.now();
const r = forecast(total, 30);
console.log("STORE TOTAL UNITS/DAY");
console.log(`  history mean ${num(total.reduce((a, b) => a + b, 0) / total.length)} · last 7d mean ${num(total.slice(-7).reduce((a, b) => a + b, 0) / 7)}`);
console.log(`  params a=${r.fit.params.alpha} b=${r.fit.params.beta} g=${r.fit.params.gamma} phi=${r.fit.params.phi}`);
console.log(`  accuracy  WAPE ${pct(r.accuracy.wape)} · MAPE ${pct(r.accuracy.mape)} · bias ${pct(r.accuracy.bias)} · MASE ${r.accuracy.mase.toFixed(2)} (naive WAPE ${pct(r.accuracy.naiveWape)}) · ${r.accuracy.points} pts`);
console.log(`  h=1  ${num(r.points[0].mean)}  [80% ${num(r.points[0].lo80)}–${num(r.points[0].hi80)}]`);
console.log(`  h=7  ${num(r.points[6].mean)}  [80% ${num(r.points[6].lo80)}–${num(r.points[6].hi80)}]`);
console.log(`  h=30 ${num(r.points[29].mean)}  [80% ${num(r.points[29].lo80)}–${num(r.points[29].hi80)}]`);
console.log(`  forecast in ${Date.now() - tf}ms\n`);

// Band must widen with the horizon, and contain the point forecast.
const w1 = r.points[0].hi80 - r.points[0].lo80;
const w30 = r.points[29].hi80 - r.points[29].lo80;
console.log(`  CHECK band widens: ${num(w1)} -> ${num(w30)} ... ${w30 > w1 ? "OK" : "FAIL"}`);
console.log(`  CHECK 95% ⊃ 80%: ${r.points[9].lo95 < r.points[9].lo80 && r.points[9].hi95 > r.points[9].hi80 ? "OK" : "FAIL"}`);
console.log(`  CHECK all means > 0: ${r.points.every((p) => p.mean > 0) ? "OK" : "FAIL"}`);
console.log(`  CHECK beats seasonal naive: MASE ${r.accuracy.mase.toFixed(2)} ${r.accuracy.mase < 1 ? "OK" : "FAIL"}\n`);

/* --- Anomalies ------------------------------------------------------------ */

const an = detectAnomalies(items[0].dates, total, r.fit, { threshold: 3, events: getEvents() });
const groups = groupAnomalies(an);
console.log(`ANOMALIES: ${an.length} days in ${groups.length} incidents`);
for (const g of groups.slice(0, 6)) {
  const head = g[0];
  const span = g.length > 1 ? `${g[0].date}…${g[g.length - 1].date}` : head.date;
  const cause = head.causes[0]?.label ?? (head.context[0] ? `(context: ${head.context[0].label})` : "— no logged event");
  console.log(`  ${span.padEnd(24)} ${head.direction.padEnd(5)} ${pct(head.deviation).padStart(8)} z=${head.z.toFixed(1).padStart(5)} ${head.severity.padEnd(8)} ${cause}`);
}
console.log();

/* --- Drivers -------------------------------------------------------------- */

const feats = items.map(() => null); // placeholder to keep shapes obvious
void feats;
const first = items[0];
const dr = fitDrivers(
  cal,
  cal.map((_, i) => ({
    promo: first.onPromo[i] ? 1 : 0,
    discount: first.discount[i],
    logPriceIndex: Math.log(first.priceIndex[i]),
    eventLog: 0,
    localAttendance: 0,
    severeWeather: 0,
  })),
  first.units,
  origin,
  origin + 13,
);
console.log(`DRIVERS for ${SKU_BY_ID.get(first.skuId)!.name} (next 14 days)`);
console.log(`  R² ${pct(dr.r2)} · baseline ${num(dr.baselinePerDay, 1)}/day -> expected ${num(dr.expectedPerDay, 1)}/day`);
for (const e of dr.effects) {
  console.log(`  ${e.label.padEnd(20)} ${(e.effect >= 0 ? "+" : "") + pct(e.effect)} (${e.units >= 0 ? "+" : ""}${num(e.units, 1)} u/day)`);
}
const recon = dr.baselinePerDay + dr.effects.reduce((a, e) => a + e.units, 0);
console.log(`  CHECK bridge reconciles: ${num(recon, 2)} vs expected ${num(dr.expectedPerDay, 2)} ... ${Math.abs(recon - dr.expectedPerDay) < 0.01 ? "OK" : "FAIL"}\n`);

/* --- Fuel ----------------------------------------------------------------- */

const fuel = getFuelSeries(STORE);
console.log("FUEL");
for (const f of fuel) {
  const g = FUEL_GRADES.find((x) => x.id === f.gradeId)!;
  const fr = forecast(f.gallons, 14);
  const next7 = fr.points.slice(0, 7).reduce((a, p) => a + p.mean, 0);
  const hist7 = f.gallons.slice(-7).reduce((a, b) => a + b, 0);
  console.log(
    `  ${g.short.padEnd(9)} hist7 ${num(hist7).padStart(7)} gal · fcst7 ${num(next7).padStart(7)} gal · WAPE ${pct(fr.accuracy.wape).padStart(6)} · MASE ${fr.accuracy.mase.toFixed(2)} · price $${f.price[origin - 1].toFixed(2)}`,
  );
}

const mix = fuel.map((f) => f.gallons.slice(-30).reduce((a, b) => a + b, 0));
const mixTotal = mix.reduce((a, b) => a + b, 0);
console.log(`  30d mix: ${fuel.map((f, i) => `${FUEL_GRADES.find((x) => x.id === f.gradeId)!.short} ${pct(mix[i] / mixTotal)}`).join(" · ")}`);
console.log(`\ntotal ${Date.now() - t0}ms`);
