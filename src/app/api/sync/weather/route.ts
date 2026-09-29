import { NextResponse } from "next/server";
import { fetchHistoricalWeather, fetchForecastWeather } from "@/lib/external/weather";
import { upsertWeather } from "@/lib/db/ingest";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

    const [history, forecast] = await Promise.all([
      fetchHistoricalWeather(from, today),
      fetchForecastWeather(),
    ]);

    const all = [...history, ...forecast];
    const result = upsertWeather(all);

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
