"use client";

/**
 * Figures — when the form is a number rather than a chart.
 *
 * Stat-tile contract: label (sentence case) · value (compact, large, light) ·
 * delta (signed, vs a named period, coloured by direction × whether up is
 * good) · trend (12-point sparkline, de-emphasis hue with the current period
 * in the accent) · an optional caption line carrying the comparison figures.
 *
 * Big standalone numbers use the font's proportional figures — `tabular-nums`
 * gives every digit the width of a zero, which makes a value like 121 look
 * loose at display sizes.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { linePath, linearScale, px } from "@/lib/chart/scales";

/* -------------------------------------------------------------------------- */
/* Sparkline                                                                  */
/* -------------------------------------------------------------------------- */

export function Sparkline({
  values,
  width = 84,
  height = 28,
  accentFrom,
  color = "var(--series-1)",
}: {
  values: number[];
  width?: number;
  height?: number;
  /** Index from which the line switches to the accent hue. */
  accentFrom?: number;
  color?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = linearScale([0, values.length - 1], [1, width - 1]);
  const y = linearScale([min, max], [height - 2, 2]);
  const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
  const split = accentFrom ?? values.length - 1;

  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <path
        d={linePath(pts.slice(0, split + 1))}
        fill="none"
        stroke="var(--series-other)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.55}
      />
      <path
        d={linePath(pts.slice(split))}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r={2.5}
        fill={color}
        stroke="var(--surface-1)"
        strokeWidth={2}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Delta                                                                      */
/* -------------------------------------------------------------------------- */

function Delta({
  value,
  label,
  upIsGood = true,
}: {
  value: number;
  label?: string;
  upIsGood?: boolean;
}) {
  const good = (value >= 0) === upIsGood;
  const color = good ? "var(--delta-good)" : "var(--delta-bad)";
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      {/* Direction is carried by an arrow as well as by colour. */}
      <span aria-hidden style={{ color }}>{value >= 0 ? "▲" : "▼"}</span>
      <span className="tabular font-medium" style={{ color }}>
        {`${Math.abs(value * 100).toFixed(1)}%`}
      </span>
      {label ? <span className="text-ink-muted">{label}</span> : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat tile                                                                  */
/* -------------------------------------------------------------------------- */

export type StatTileProps = {
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  upIsGood?: boolean;
  trend?: number[];
  trendAccentFrom?: number;
  /** Left-hand caption under the value, e.g. "Of 125 total". */
  caption?: ReactNode;
  /** Right-hand figure on the same line, e.g. "24/125". */
  captionRight?: ReactNode;
  footnote?: ReactNode;
  className?: string;
};

export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  upIsGood = true,
  trend,
  trendAccentFrom,
  caption,
  captionRight,
  footnote,
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        "surface-card surface-card-interactive flex flex-col gap-3 rounded-card p-5",
        className,
      )}
    >
      <p className="text-ink-primary text-[15px] leading-none font-medium">
        {label}
      </p>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink-primary figure text-[2.5rem] leading-[1.05]">
            {value}
          </p>
          {delta != null && Number.isFinite(delta) ? (
            <p className="mt-1.5">
              <Delta value={delta} label={deltaLabel} upIsGood={upIsGood} />
            </p>
          ) : null}
        </div>
        {trend && trend.length > 1 ? (
          <Sparkline values={trend} accentFrom={trendAccentFrom} />
        ) : null}
      </div>

      {caption || captionRight ? (
        <div className="mt-auto flex items-baseline justify-between gap-3">
          <span className="text-ink-muted text-xs">{caption}</span>
          <span className="text-ink-secondary tabular text-xs font-medium">
            {captionRight}
          </span>
        </div>
      ) : null}

      {footnote ? (
        <p className="text-ink-muted mt-auto text-[11px] leading-snug">{footnote}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero figure                                                                */
/* -------------------------------------------------------------------------- */

/** The single number a view leads with. Exactly one per workspace. */
export function HeroFigure({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  range,
  className,
}: {
  label: string;
  value: string;
  unit: string;
  delta?: number | null;
  deltaLabel?: string;
  /** The prediction interval behind the point estimate. */
  range?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-ink-primary text-[15px] leading-none font-medium">
        {label}
      </p>
      <p className="text-ink-primary figure flex items-baseline gap-2 leading-[1]">
        {/* Same system sans as everything else — a display face here reads as
            off-brand decoration. */}
        <span className="text-[3.25rem] sm:text-[3.75rem]">{value}</span>
        <span className="text-ink-secondary text-base font-medium tracking-normal">
          {unit}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {delta != null && Number.isFinite(delta) ? (
          <Delta value={delta} label={deltaLabel} />
        ) : null}
        {range ? (
          <span className="text-ink-muted tabular">80% range {range}</span>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Meter                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A single ratio against a limit, as a continuous track. Used in dense table
 * cells, where the row height leaves no room for anything taller.
 */
export function Meter({
  value,
  max,
  label,
  valueLabel,
  severity = "ok",
}: {
  value: number;
  max: number;
  label?: string;
  valueLabel?: string;
  severity?: "ok" | "warning" | "critical";
}) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const fill =
    severity === "critical"
      ? "var(--status-critical)"
      : severity === "warning"
        ? "var(--status-warning)"
        : "var(--series-1)";

  return (
    <div className="w-full">
      {label || valueLabel ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label ? <span className="text-ink-muted text-[11px]">{label}</span> : null}
          {valueLabel ? (
            <span className="text-ink-secondary tabular text-[11px] font-medium">
              {valueLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
        aria-label={label}
        className="bg-surface-3 h-1.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${px(pct * 100)}%`,
            backgroundColor: fill,
            transition: "width 300ms var(--ease-out)",
          }}
        />
      </div>
    </div>
  );
}
