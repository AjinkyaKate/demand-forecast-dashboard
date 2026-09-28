"use client";

/**
 * Shared chart furniture: pill axis labels, gradient fills, and the tooltip
 * shell. Kept in one place so every chart speaks the same visual language.
 */

import type { ReactNode } from "react";
import { approxTextWidth } from "@/lib/chart/paths";
import { px } from "@/lib/chart/scales";

/* -------------------------------------------------------------------------- */
/* Pill axis label                                                            */
/* -------------------------------------------------------------------------- */

/**
 * An x-axis tick set in a soft pill rather than bare on the baseline.
 *
 * The pill is chrome, not data: it sits in the recessed surface colour and its
 * text takes a muted ink token, so it stays quieter than every mark above it
 * while still giving the date something to sit on.
 */
export function PillLabel({
  x,
  y,
  text,
  anchor = "middle",
}: {
  x: number;
  y: number;
  text: string;
  anchor?: "start" | "middle" | "end";
}) {
  const w = approxTextWidth(text, 11) + 16;
  const h = 20;
  const left =
    anchor === "start" ? x : anchor === "end" ? x - w : px(x - w / 2);

  return (
    <g>
      <rect
        x={px(left)}
        y={px(y - h / 2)}
        width={px(w)}
        height={h}
        rx={h / 2}
        fill="var(--surface-2)"
      />
      <text
        x={px(left + w / 2)}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        className="tabular"
        fontSize={11}
        fill="var(--ink-muted)"
      >
        {text}
      </text>
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* Gradient fills                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A fill that runs pale at the baseline and saturated at the data end.
 *
 * This is less ink than a solid saturated block, not more, and the encoding is
 * untouched — length still carries the value, and the saturated end marks
 * exactly where the value stops. `direction` follows the bar's growth axis so
 * the pale end always sits on the baseline.
 */
export function BarGradient({
  id,
  color,
  direction = "horizontal",
  from = 0.55,
  to = 1,
}: {
  id: string;
  color: string;
  direction?: "horizontal" | "vertical";
  /** Opacity at the baseline end. Kept well above zero — a bar that fades to
   *  nothing loses its own start, which makes short bars hard to compare. */
  from?: number;
  /** Opacity at the data end. */
  to?: number;
}) {
  const coords =
    direction === "horizontal"
      ? { x1: "0", y1: "0", x2: "1", y2: "0" }
      : { x1: "0", y1: "1", x2: "0", y2: "0" };
  return (
    <linearGradient id={id} {...coords}>
      <stop offset="0%" stopColor={color} stopOpacity={from} />
      <stop offset="100%" stopColor={color} stopOpacity={to} />
    </linearGradient>
  );
}

/** A soft vertical wash under a line, fading to nothing at the baseline. */
export function AreaGradient({
  id,
  color,
  top = 0.22,
}: {
  id: string;
  color: string;
  top?: number;
}) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={top} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

/* -------------------------------------------------------------------------- */
/* Tooltip                                                                    */
/* -------------------------------------------------------------------------- */

export function ChartTooltip({
  left,
  right,
  top = 8,
  children,
}: {
  left?: number;
  right?: number;
  top?: number;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="tooltip-card pointer-events-none absolute z-10 w-max min-w-[10.5rem] p-2.5"
      style={{ left, right, top }}
    >
      {children}
    </div>
  );
}

export function TooltipHeading({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-[11px] font-medium"
      style={{ color: "var(--tooltip-ink-dim)" }}
    >
      {children}
    </p>
  );
}

/**
 * One series row. The value is the strong element and the series name is
 * secondary — the legend's hierarchy inverted, because here the reader already
 * has the series and wants the number.
 */
export function TooltipRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt
        className="flex items-center gap-1.5 text-[11px]"
        style={{ color: "var(--tooltip-ink-dim)" }}
      >
        {/* A line key, not a filled box — at tooltip density a box is
            data-weight ink doing a label's job. */}
        <span
          aria-hidden
          className="inline-block h-0.5 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label}
      </dt>
      <dd
        className="tabular text-xs font-semibold"
        style={{ color: "var(--tooltip-ink)" }}
      >
        {value}
      </dd>
    </div>
  );
}

export function TooltipNote({ children }: { children: ReactNode }) {
  return (
    <p
      className="mt-2 border-t pt-1.5 text-[11px] leading-snug"
      style={{ borderColor: "var(--tooltip-rule)", color: "var(--tooltip-ink-dim)" }}
    >
      {children}
    </p>
  );
}
