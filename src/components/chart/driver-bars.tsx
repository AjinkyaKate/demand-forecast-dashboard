"use client";

/**
 * Driver contributions — a diverging bar chart.
 *
 * The job is polarity: does this driver push the forecast above or below an
 * average stretch of this series? That is exactly what diverging encodes, so
 * it gets two hues that read as opposite (indigo / orange) around a neutral
 * gray midpoint, not a categorical palette.
 */

import { useState } from "react";
import { linearScale, niceTicks } from "@/lib/chart/scales";
import { approxTextWidth, barThickness, roundedBarPath } from "@/lib/chart/paths";
import { BarGradient } from "./parts";
import { useChartWidth } from "./use-chart-width";

export type DriverBar = {
  id: string;
  label: string;
  /** Signed multiplicative effect, e.g. 0.08 = +8 %. */
  value: number;
  hint?: string;
  /** Secondary readout shown in the tooltip. */
  detail?: string;
};

const LABEL_W = 132;
const PAD = { top: 6, right: 16, bottom: 22, left: LABEL_W + 8 };

export function DriverBars({
  bars,
  rowHeight = 34,
}: {
  bars: DriverBar[];
  rowHeight?: number;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);

  const height = PAD.top + bars.length * rowHeight + PAD.bottom;
  const plotW = Math.max(80, width - PAD.left - PAD.right);

  const maxAbs = Math.max(0.02, ...bars.map((b) => Math.abs(b.value)));
  const { ticks, domain } = niceTicks(-maxAbs, maxAbs, 4);
  // Force symmetry so the neutral midpoint sits dead centre and the two arms
  // carry equal steps — otherwise the chart overstates whichever side is bigger.
  const lim = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
  const x = linearScale([-lim, lim], [PAD.left, PAD.left + plotW]);
  const zero = x(0);
  const thickness = barThickness(rowHeight);

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img"
        aria-label="Driver contributions to the forecast, as a percentage above or below an average period. Switch to the table view for exact values.">
        <defs>
          {/* Each arm fades toward the neutral midpoint, so the zero line
              reads as "nothing" from both directions. */}
          <BarGradient id="div-pos" color="var(--div-pos)" from={0.5} to={1} />
          <BarGradient id="div-neg" color="var(--div-neg)" from={1} to={0.5} />
        </defs>
        {ticks.map((t) => (
          <line
            key={t}
            x1={x(t)}
            x2={x(t)}
            y1={PAD.top}
            y2={PAD.top + bars.length * rowHeight}
            stroke="var(--grid)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        ))}

        {bars.map((b, i) => {
          const y = PAD.top + i * rowHeight + (rowHeight - thickness) / 2;
          const bx = b.value >= 0 ? zero : x(b.value);
          const bw = Math.abs(x(b.value) - zero);
          const positive = b.value >= 0;
          const label = `${positive ? "+" : "−"}${(Math.abs(b.value) * 100).toFixed(1)}%`;
          const labelW = approxTextWidth(label, 11);
          // Place the value outside the bar end; fall back to the far side of
          // the midpoint when the bar reaches the edge of the plot.
          const outsideX = positive ? bx + bw + 6 : bx - 6;
          const fits = positive
            ? outsideX + labelW < PAD.left + plotW
            : outsideX - labelW > PAD.left;

          return (
            <g
              key={b.id}
              onPointerEnter={() => setHover(b.id)}
              onPointerLeave={() => setHover(null)}
              tabIndex={0}
              onFocus={() => setHover(b.id)}
              onBlur={() => setHover(null)}
              className="focus-visible:outline-none"
            >
              {/* Hit target spans the whole row, not just the painted bar. */}
              <rect
                x={0} y={PAD.top + i * rowHeight} width={width} height={rowHeight}
                fill={hover === b.id ? "var(--surface-2)" : "transparent"}
              />
              <text
                x={LABEL_W}
                y={PAD.top + i * rowHeight + rowHeight / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fill="var(--ink-secondary)"
              >
                {b.label}
              </text>
              <path
                d={roundedBarPath(bx, y, Math.max(1, bw), thickness, 6, positive ? "right" : "left")}
                fill={positive ? "url(#div-pos)" : "url(#div-neg)"}
              />
              <text
                x={fits ? outsideX : positive ? bx + bw - 6 : bx + 6}
                y={PAD.top + i * rowHeight + rowHeight / 2}
                textAnchor={fits ? (positive ? "start" : "end") : positive ? "end" : "start"}
                dominantBaseline="middle"
                className="tabular"
                fontSize={11}
                fontWeight={600}
                fill={fits ? "var(--ink-secondary)" : "var(--surface-1)"}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Neutral midpoint — the "no effect" line. */}
        <line
          x1={zero} x2={zero} y1={PAD.top} y2={PAD.top + bars.length * rowHeight}
          stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges"
        />

        {ticks.map((t) => (
          <text
            key={`t-${t}`}
            x={x(t)}
            y={height - 6}
            textAnchor="middle"
            className="tabular"
            fontSize={10}
            fill="var(--ink-muted)"
          >
            {`${t > 0 ? "+" : ""}${(t * 100).toFixed(0)}%`}
          </text>
        ))}
      </svg>

      {hover ? (
        <HoverNote bar={bars.find((b) => b.id === hover)!} />
      ) : null}
    </div>
  );
}

function HoverNote({ bar }: { bar: DriverBar }) {
  return (
    <div className="bg-surface-2 text-ink-secondary mt-2 rounded-md px-2.5 py-1.5 text-[11px] leading-snug">
      <span className="text-ink-primary font-medium">{bar.label}</span>
      {bar.hint ? ` — ${bar.hint}` : null}
      {bar.detail ? <span className="tabular"> · {bar.detail}</span> : null}
    </div>
  );
}
