/**
 * Nager.Date public holidays — free, no API key.
 * https://date.nager.at/api/v3/PublicHolidays/{year}/{country}
 */

const BASE = "https://date.nager.at/api/v3/PublicHolidays";

export type Holiday = {
  date: string;
  name: string;
  /** "US" for national holidays, or the subdivision code, e.g. "US-NJ". */
  region: string;
  kind: "public" | "observance";
};

type NagerHoliday = {
  date: string;
  name: string;
  global: boolean;
  counties: string[] | null;
  types: string[];
};

/**
 * National holidays plus those observed in the given subdivisions (e.g. a
 * state-only holiday like Good Friday in NJ).
 */
export async function fetchHolidays(
  country: string,
  years: number[],
  regions: string[],
): Promise<Holiday[]> {
  const out: Holiday[] = [];
  for (const year of years) {
    const res = await fetch(`${BASE}/${year}/${country}`);
    if (!res.ok) throw new Error(`Nager.Date ${res.status} for ${year}`);
    const rows = (await res.json()) as NagerHoliday[];
    for (const h of rows) {
      const kind = h.types.includes("Public") ? "public" : "observance";
      if (h.global) {
        out.push({ date: h.date, name: h.name, region: country, kind });
      } else {
        for (const r of h.counties ?? []) {
          if (regions.includes(r)) out.push({ date: h.date, name: h.name, region: r, kind });
        }
      }
    }
  }
  return out;
}
