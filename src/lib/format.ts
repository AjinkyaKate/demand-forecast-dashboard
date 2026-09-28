/**
 * Number & date formatting.
 *
 * Stat-tile and hero values use `compact`, which keeps the default
 * proportional figures. `tabular-nums` is applied via CSS only to columns
 * that must align vertically (table rows, axis ticks).
 */

export function compact(n: number, digits = 1): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000, digits)}M`;
  if (abs >= 10_000) return `${trim(n / 1_000, 0)}K`;
  if (abs >= 1_000) return `${trim(n / 1_000, digits)}K`;
  return trim(n, abs < 10 && !Number.isInteger(n) ? 1 : 0);
}

function trim(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return s.replace(/\.0+$/, "");
}

export function thousands(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function currency(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function percent(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

/** Signed percent for deltas — the sign is part of the meaning. */
export function signedPercent(n: number, digits = 1): string {
  const v = (n * 100).toFixed(digits);
  return `${n >= 0 ? "+" : ""}${v}%`;
}

export function signed(n: number, digits = 0): string {
  return `${n >= 0 ? "+" : "−"}${thousands(Math.abs(n), digits)}`;
}

/* --- Dates ---------------------------------------------------------------- */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Parse an ISO `YYYY-MM-DD` as a UTC date — never local, never Date.parse. */
export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

export function dayOfWeek(iso: string): number {
  return parseISO(iso).getUTCDay();
}

export function dowLabel(iso: string): string {
  return DOW[dayOfWeek(iso)];
}

/** "Mar 14" */
export function shortDate(iso: string): string {
  const d = parseISO(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Mar 14, 2026" */
export function longDate(iso: string): string {
  const d = parseISO(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Sat, Mar 14" — weekday matters for C-store demand, so keep it visible. */
export function dowDate(iso: string): string {
  return `${dowLabel(iso)}, ${shortDate(iso)}`;
}

export function monthLabel(iso: string): string {
  const d = parseISO(iso);
  return MONTHS[d.getUTCMonth()];
}
