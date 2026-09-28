import { px } from "./scales";

/**
 * Bar geometry.
 *
 * Mark spec: a bar is rounded 4px at the data end and square where it meets
 * the baseline, so the baseline stays a straight edge across the whole chart
 * and the rounded end reads as "this is where the value stops".
 */

export type RoundSide = "right" | "left" | "top" | "bottom" | "none";

export function roundedBarPath(
  rawX: number,
  rawY: number,
  rawW: number,
  rawH: number,
  radius: number,
  side: RoundSide,
): string {
  // Rounded for the same reason the scales are — see `px` in scales.ts.
  const x = px(rawX);
  const y = px(rawY);
  const w = px(rawW);
  const h = px(rawH);
  const r = Math.max(0, Math.min(radius, side === "top" || side === "bottom" ? w / 2 : h / 2, side === "top" || side === "bottom" ? h : w));
  if (w <= 0 || h <= 0) return "";
  if (r < 0.5 || side === "none") {
    return `M${x} ${y}h${w}v${h}h${-w}Z`;
  }

  switch (side) {
    case "right":
      return `M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - r)}Z`;
    case "left":
      return `M${x + r} ${y}h${w - r}v${h}h${-(w - r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
    case "top":
      return `M${x} ${y + h}v${-(h - r)}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - r}Z`;
    case "bottom":
      return `M${x} ${y}h${w}v${h - r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}Z`;
    default:
      return `M${x} ${y}h${w}v${h}h${-w}Z`;
  }
}

/** Bars are capped at 24px — never fill the band; the leftover is air. */
export const MAX_BAR = 24;

export function barThickness(band: number, max = MAX_BAR): number {
  return Math.min(max, Math.max(6, band * 0.62));
}

/**
 * Rough text width for deciding whether a direct label fits inside a mark.
 * Measuring for real would need a canvas; this errs on the wide side so a
 * label is dropped rather than clipped.
 */
export function approxTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62;
}
