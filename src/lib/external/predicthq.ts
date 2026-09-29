/**
 * PredictHQ events client. Needs an access token in PREDICTHQ_API_TOKEN
 * (.env.local — never committed). https://docs.predicthq.com/api/events/search-events
 *
 * Fetches events within a radius of a store: attendance-based categories
 * (concerts, sports, festivals…) carry a predicted attendance, which is what
 * moves foot traffic; severe weather and school holidays are day flags.
 */

const BASE = "https://api.predicthq.com/v1/events/";

/**
 * Categories that plausibly move c-store traffic. Observances are left out:
 * PredictHQ ranks them by general prominence, not by footfall.
 */
export const PHQ_CATEGORIES = [
  "concerts",
  "festivals",
  "sports",
  "performing-arts",
  "community",
  "expos",
  "conferences",
  "school-holidays",
  "severe-weather",
];

export type PhqEvent = {
  id: string;
  title: string;
  category: string;
  start: string;
  end: string;
  attendance: number | null;
  rank: number | null;
  localRank: number | null;
  distanceKm: number | null;
};

type PhqRaw = {
  id: string;
  title: string;
  category: string;
  start?: string;
  end?: string;
  start_local?: string;
  end_local?: string;
  phq_attendance?: number | null;
  rank?: number | null;
  local_rank?: number | null;
  location?: [number, number];
};

export class PredictHQError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function predictHqToken(): string | null {
  const t = process.env.PREDICTHQ_API_TOKEN?.trim();
  return t ? t : null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export async function fetchEventsNear(opts: {
  token: string;
  latitude: number;
  longitude: number;
  timezone: string;
  radiusKm: number;
  from: string;
  to: string;
}): Promise<PhqEvent[]> {
  const u = new URL(BASE);
  u.searchParams.set("within", `${opts.radiusKm}km@${opts.latitude},${opts.longitude}`);
  u.searchParams.set("active.gte", opts.from);
  u.searchParams.set("active.lte", opts.to);
  u.searchParams.set("active.tz", opts.timezone);
  u.searchParams.set("category", PHQ_CATEGORIES.join(","));
  u.searchParams.set("sort", "start");
  u.searchParams.set("limit", "200");

  const out: PhqEvent[] = [];
  let next: string | null = u.toString();
  for (let page = 0; next && page < 100; page++) {
    const res: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      const why =
        res.status === 401 ? "the token was rejected" :
        res.status === 402 || res.status === 403 ? "the plan doesn't allow this request" :
        res.status === 429 ? "rate limited" : body;
      throw new PredictHQError(`PredictHQ ${res.status}: ${why}`, res.status);
    }
    const json = (await res.json()) as { results: PhqRaw[]; next: string | null };
    for (const e of json.results) {
      const start = (e.start_local ?? e.start ?? "").slice(0, 10);
      const end = (e.end_local ?? e.end ?? e.start_local ?? e.start ?? "").slice(0, 10);
      if (!start) continue;
      out.push({
        id: e.id,
        title: e.title,
        category: e.category,
        start,
        end: end || start,
        attendance: e.phq_attendance ?? null,
        rank: e.rank ?? null,
        localRank: e.local_rank ?? null,
        distanceKm: e.location
          ? Math.round(haversineKm(opts.latitude, opts.longitude, e.location[1], e.location[0]) * 10) / 10
          : null,
      });
    }
    next = json.next;
  }
  return out;
}
