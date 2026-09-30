/**
 * Open-Meteo client — free, no API key.
 *
 * Everything is fetched for one location (a store's coordinates):
 *   - observed daily history (archive API)
 *   - the 16-day forecast, plus the last week, which the archive lags on
 *   - climate normals: the day-of-year average over ten full years
 *
 * Temperature anomaly — the weather signal the model reads — is the departure
 * from that location's own normal, not from an assumed curve.
 */

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const DAILY = "temperature_2m_mean,precipitation_sum";

export type Location = { latitude: number; longitude: number; timezone: string };

export type RawDay = { date: string; tempF: number; precipMm: number };

export type Normals = {
  /** Index 1..366 → normal °F and mm for that day of year. */
  tempF: number[];
  precipMm: number[];
  years: string;
};

const cToF = (c: number) => c * 1.8 + 32;

function url(base: string, loc: Location, extra: Record<string, string>) {
  const u = new URL(base);
  u.searchParams.set("latitude", String(loc.latitude));
  u.searchParams.set("longitude", String(loc.longitude));
  u.searchParams.set("timezone", loc.timezone);
  u.searchParams.set("daily", DAILY);
  u.searchParams.set("temperature_unit", "celsius");
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

async function getDaily(u: string): Promise<RawDay[]> {
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as {
    daily: { time: string[]; temperature_2m_mean: (number | null)[]; precipitation_sum: (number | null)[] };
  };
  const out: RawDay[] = [];
  const d = json.daily;
  for (let i = 0; i < d.time.length; i++) {
    const t = d.temperature_2m_mean[i];
    if (t == null) continue; // the archive leaves the most recent days empty
    out.push({
      date: d.time[i],
      tempF: Math.round(cToF(t) * 10) / 10,
      precipMm: Math.round((d.precipitation_sum[i] ?? 0) * 10) / 10,
    });
  }
  return out;
}

export function fetchObserved(loc: Location, from: string, to: string) {
  return getDaily(url(ARCHIVE, loc, { start_date: from, end_date: to }));
}

export function fetchForecast(loc: Location) {
  return getDaily(url(FORECAST, loc, { forecast_days: "16", past_days: "7" }));
}

export function dayOfYear(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

/**
 * Day-of-year normals over the ten full years before `beforeYear`, smoothed
 * with a ±7-day circular window so a single freak week doesn't bend the curve.
 */
export async function fetchNormals(loc: Location, beforeYear: number): Promise<Normals> {
  const first = beforeYear - 10;
  const last = beforeYear - 1;
  const days = await fetchObserved(loc, `${first}-01-01`, `${last}-12-31`);

  const tSum = new Array<number>(367).fill(0);
  const pSum = new Array<number>(367).fill(0);
  const n = new Array<number>(367).fill(0);
  for (const d of days) {
    const k = dayOfYear(d.date);
    tSum[k] += d.tempF;
    pSum[k] += d.precipMm;
    n[k]++;
  }
  // Day 366 only occurs in leap years; borrow day 365's sample.
  if (n[366] === 0) {
    tSum[366] = tSum[365];
    pSum[366] = pSum[365];
    n[366] = n[365];
  }

  const tempF = new Array<number>(367).fill(NaN);
  const precipMm = new Array<number>(367).fill(NaN);
  for (let k = 1; k <= 366; k++) {
    let t = 0;
    let p = 0;
    let c = 0;
    for (let off = -7; off <= 7; off++) {
      const j = ((k - 1 + off + 366) % 366) + 1;
      t += tSum[j];
      p += pSum[j];
      c += n[j];
    }
    tempF[k] = c ? Math.round((t / c) * 10) / 10 : NaN;
    precipMm[k] = c ? Math.round((p / c) * 100) / 100 : NaN;
  }
  return { tempF, precipMm, years: `${first}–${last}` };
}
