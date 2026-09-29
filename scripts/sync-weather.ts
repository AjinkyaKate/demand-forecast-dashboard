/**
 * Sync real weather data from Open-Meteo into the local SQLite DB.
 *
 * Fetches:
 *   1. Historical daily temperatures for the last N days (default 90)
 *   2. The 16-day weather forecast
 *
 * Both are upserted into daily_weather, overwriting any synthetic values
 * for those dates while preserving holiday columns.
 *
 * Usage: npx tsx scripts/sync-weather.ts [--days 90]
 */

import { fetchHistoricalWeather, fetchForecastWeather } from "../src/lib/external/weather";
import { upsertWeather } from "../src/lib/db/ingest";

const days = Number(process.argv.find((_, i, a) => a[i - 1] === "--days") ?? 90);

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  console.log(`Fetching historical weather: ${from} → ${today}`);
  const history = await fetchHistoricalWeather(from, today);
  console.log(`  Got ${history.length} historical days`);

  console.log("Fetching 16-day forecast...");
  const forecast = await fetchForecastWeather();
  console.log(`  Got ${forecast.length} forecast days`);

  const all = [...history, ...forecast];
  const result = upsertWeather(all);
  console.log(`Upserted ${result.rows} weather rows into daily_weather`);
  console.log(`  Range: ${result.dateFrom} → ${result.dateTo}`);
}

main().catch((err) => {
  console.error("Weather sync failed:", err);
  process.exit(1);
});
