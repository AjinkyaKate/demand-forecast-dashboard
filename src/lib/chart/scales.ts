/** Scale and tick helpers shared by every chart. */

export type Scale = (v: number) => number;

/**
 * Round to 1/100 of a pixel.
 *
 * Sub-pixel precision past two decimals is invisible, and carrying full
 * float precision into SVG attributes is actively harmful here: `Math.log`,
 * `Math.exp` and `Math.pow` are permitted to differ by an ULP between
 * implementations, so the same forecast computed in Node and in the browser
 * produced coordinates like 207.51056022249875 vs 207.51056022249725 — enough
 * for React to report a hydration mismatch on every chart. Rounding here
 * makes the rendered geometry insensitive to that noise.
 */
export const px = (v: number): number => Math.round(v * 100) / 100;

export function linearScale(
  domain: [number, number],
  range: [number, number],
): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => px(r0 + ((v - d0) / span) * (r1 - r0));
}

/**
 * Axis ticks on round numbers (0 / 1,000 / 2,000), never on raw data extremes.
 * Returns the tick values plus the padded domain they imply.
 */
export function niceTicks(
  min: number,
  max: number,
  target = 5,
): { ticks: number[]; domain: [number, number] } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const base = Number.isFinite(max) && max !== 0 ? Math.abs(max) : 1;
    min = 0;
    max = base * 1.2;
  }
  const span = max - min;
  const rawStep = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;

  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  // Accumulate by index, not by repeated addition — repeated += step drifts
  // on non-representable steps and yields ticks like 0.30000000000000004.
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) {
    ticks.push(Math.round((lo + i * step) * 1e6) / 1e6);
  }
  return { ticks, domain: [lo, hi] };
}

/** Evenly spaced indices for a categorical/date axis, always including the last. */
export function tickIndices(length: number, target = 6): number[] {
  if (length <= target) return Array.from({ length }, (_, i) => i);
  const step = (length - 1) / (target - 1);
  const out = new Set<number>();
  for (let i = 0; i < target; i++) out.add(Math.round(i * step));
  return [...out].sort((a, b) => a - b);
}

/** Build an SVG path from points, skipping null gaps. */
export function linePath(
  points: ({ x: number; y: number } | null)[],
): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p || !Number.isFinite(p.y)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    pen = true;
  }
  return d;
}

/** Closed band path between an upper and lower edge. */
export function bandPath(
  upper: ({ x: number; y: number } | null)[],
  lower: ({ x: number; y: number } | null)[],
): string {
  const up = upper.filter(Boolean) as { x: number; y: number }[];
  const lo = (lower.filter(Boolean) as { x: number; y: number }[]).reverse();
  if (up.length === 0) return "";
  let d = `M${up[0].x.toFixed(2)} ${up[0].y.toFixed(2)}`;
  for (let i = 1; i < up.length; i++) d += `L${up[i].x.toFixed(2)} ${up[i].y.toFixed(2)}`;
  for (const p of lo) d += `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  return `${d}Z`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
