/**
 * Open-Meteo weather API client.
 *
 * Fetches historical daily temperatures and 16-day forecasts for the store
 * region. Free, no API key required. We compute `temp_anomaly` as the
 * departure from the same cosine seasonal-normal curve the synthetic
 * generator used, so the driver model's weather coefficient stays calibrated.
 */

const BASE_HISTORY = "https://archive-api.open-meteo.com/v1/archive";
const BASE_FORECAST = "https://api.open-meteo.com/v1/forecast";

/** Central NJ — representative location for the store cluster. */
export const REGION_LAT = 40.52;
export const REGION_LON = -74.35;

export type WeatherDay = {
  date: string;
  tempF: number;
  tempAnomaly: number;
};

/** Seasonal-normal temperature (°F) — same curve as generate.ts. */
function tempNormal(doy: number): number {
  return 54 - 24 * Math.cos((2 * Math.PI * (doy - 15)) / 365);
}

function dayOfYear(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86400000) + 1;
}

function celsiusToF(c: number): number {
  return c * 1.8 + 32;
}

function parseRows(dates: string[], tempMeanC: number[]): WeatherDay[] {
  const rows: WeatherDay[] = [];
  for (let i = 0; i < dates.length; i++) {
    if (tempMeanC[i] == null) continue;
    const tempF = Math.round(celsiusToF(tempMeanC[i]) * 10) / 10;
    const normal = tempNormal(dayOfYear(dates[i]));
    rows.push({
      date: dates[i],
      tempF,
      tempAnomaly: Math.round((tempF - normal) * 10) / 10,
    });
  }
  return rows;
}

/** Fetch historical daily mean temperature for a date range. */
export async function fetchHistoricalWeather(
  from: string,
  to: string,
): Promise<WeatherDay[]> {
  const url = new URL(BASE_HISTORY);
  url.searchParams.set("latitude", String(REGION_LAT));
  url.searchParams.set("longitude", String(REGION_LON));
  url.searchParams.set("start_date", from);
  url.searchParams.set("end_date", to);
  url.searchParams.set("daily", "temperature_2m_mean");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("timezone", "America/New_York");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo history ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return parseRows(json.daily.time, json.daily.temperature_2m_mean);
}

/** Fetch the 16-day daily temperature forecast. */
export async function fetchForecastWeather(): Promise<WeatherDay[]> {
  const url = new URL(BASE_FORECAST);
  url.searchParams.set("latitude", String(REGION_LAT));
  url.searchParams.set("longitude", String(REGION_LON));
  url.searchParams.set("daily", "temperature_2m_mean");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("timezone", "America/New_York");
  url.searchParams.set("forecast_days", "16");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo forecast ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return parseRows(json.daily.time, json.daily.temperature_2m_mean);
}
