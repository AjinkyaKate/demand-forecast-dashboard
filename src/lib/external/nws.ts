/**
 * National Weather Service watches, warnings and advisories for a point —
 * free, no API key. History and currently active alerts both come from the
 * Iowa Environmental Mesonet's archive of NWS VTEC products:
 * https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py
 *
 * Only warnings and advisories are kept (a watch is a maybe), grouped into
 * the three kinds that move c-store traffic.
 */

const BASE = "https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py";

export type AlertKind = "winter" | "heat" | "storm";

/** NWS phenomena codes → the kind of day they make. */
const PHENOMENA: Record<string, AlertKind> = {
  // Winter
  WS: "winter", BZ: "winter", IS: "winter", WW: "winter", LE: "winter",
  SQ: "winter", WC: "winter", EC: "winter", CW: "winter",
  // Heat
  HT: "heat", EH: "heat", XH: "heat",
  // Severe storms, flooding, wind, tropical
  SV: "storm", TO: "storm", FF: "storm", FA: "storm", FL: "storm",
  HW: "storm", WI: "storm", TR: "storm", HU: "storm", SS: "storm",
};

export type NwsAlert = {
  id: string;
  title: string;
  kind: AlertKind;
  /** Local dates the alert was in force, inclusive. */
  start: string;
  end: string;
};

type Raw = {
  issue: string;
  expire: string;
  eventid: number;
  phenomena: string;
  significance: string;
  wfo: string;
  name: string;
};

/** A UTC instant as a local calendar date. */
function localDate(isoUtc: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoUtc));
}

export async function fetchAlertsAt(opts: {
  latitude: number;
  longitude: number;
  timezone: string;
  from: string;
  to: string;
}): Promise<NwsAlert[]> {
  const u = new URL(BASE);
  u.searchParams.set("lat", String(opts.latitude));
  u.searchParams.set("lon", String(opts.longitude));
  u.searchParams.set("sdate", opts.from);
  u.searchParams.set("edate", opts.to);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`NWS alert archive ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { events: Raw[] };

  const out = new Map<string, NwsAlert>();
  for (const e of json.events ?? []) {
    const kind = PHENOMENA[e.phenomena];
    if (!kind || (e.significance !== "W" && e.significance !== "Y")) continue;
    // One product can cover several zones; the VTEC id identifies it once.
    const id = `${e.wfo}-${e.issue.slice(0, 4)}-${e.phenomena}.${e.significance}-${e.eventid}`;
    const start = localDate(e.issue, opts.timezone);
    const end = localDate(e.expire, opts.timezone);
    const prev = out.get(id);
    out.set(id, {
      id,
      title: e.name,
      kind,
      start: prev && prev.start < start ? prev.start : start,
      end: prev && prev.end > end ? prev.end : end,
    });
  }
  return [...out.values()];
}
