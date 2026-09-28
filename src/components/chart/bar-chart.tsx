"use client";

/**
 * Horizontal bars for nominal categories.
 *
 * Every bar wears the same slot-1 hue. Colouring each bar darker-where-bigger
 * would spend the identity channel re-encoding what bar length already shows,
 * and these categories have no natural order anyway. One series, so no legend
 * box — the title says what is plotted.
 */

import { useState } from "react";
import { linearScale } from "@/lib/chart/scales";
import { approxTextWidth, barThickness, roundedBarPath } from "@/lib/chart/paths";
import { BarGradient } from "./parts";
import { useChartWidth } from "./use-chart-width";

export type BarDatum = {
  id: string;
  label: string;
  value: number;
  /** Signed change vs the comparison period, as a fraction. */
  delta?: number;
  detail?: string;
};

export function BarChart({
  data,
  format,
  rowHeight = 34,
  labelWidth = 112,
  highlightId,
}: {
  data: BarDatum[];
  format: (n: number) => string;
  rowHeight?: number;
  labelWidth?: number;
  /** One bar in the accent hue, the rest recessive — emphasis, not identity. */
  highlightId?: string;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);

  const deltaW = data.some((d) => d.delta != null) ? 56 : 8;
  const pad = { top: 4, right: deltaW, bottom: 4, left: labelWidth + 8 };
  const plotW = Math.max(60, width - pad.left - pad.right);
  const height = pad.top + data.length * rowHeight + pad.bottom;

  const max = Math.max(1, ...data.map((d) => d.value));
  const x = linearScale([0, max], [pad.left, pad.left + plotW]);
  const thickness = barThickness(rowHeight);

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img"
        aria-label="Forecast by category. Switch to the table view for exact values.">
        <defs>
          <BarGradient id="bar-accent" color="var(--series-1)" from={0.62} />
          <BarGradient id="bar-dim" color="var(--series-other)" from={0.28} to={0.55} />
        </defs>
        {data.map((d, i) => {
          const y = pad.top + i * rowHeight + (rowHeight - thickness) / 2;
          const bw = Math.max(1, x(d.value) - pad.left);
          const value = format(d.value);
          const vw = approxTextWidth(value, 11);
          const inside = bw > vw + 22;
          const dim = highlightId != null && d.id !== highlightId;

          return (
            <g
              key={d.id}
              tabIndex={0}
              onPointerEnter={() => setHover(d.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(d.id)}
              onBlur={() => setHover(null)}
              className="focus-visible:outline-none"
            >
              <rect
                x={0} y={pad.top + i * rowHeight} width={width} height={rowHeight}
                fill={hover === d.id ? "var(--surface-2)" : "transparent"}
              />
              <text
                x={labelWidth} y={pad.top + i * rowHeight + rowHeight / 2}
                textAnchor="end" dominantBaseline="middle"
                fontSize={11} fill="var(--ink-secondary)"
              >
                {d.label}
              </text>
              {/* Pale at the baseline, saturated at the data end: less ink
                  than a solid block, and the saturated end marks exactly
                  where the value stops. */}
              <path
                d={roundedBarPath(pad.left, y, bw, thickness, 6, "right")}
                fill={dim ? "url(#bar-dim)" : "url(#bar-accent)"}
              />
              {/* Inside only when it fits with padding on both sides; the value
                  never gets clipped by its own bar. */}
              <text
                x={inside ? pad.left + bw - 8 : pad.left + bw + 6}
                y={pad.top + i * rowHeight + rowHeight / 2}
                textAnchor={inside ? "end" : "start"}
                dominantBaseline="middle"
                className="tabular"
                fontSize={11}
                fontWeight={600}
                fill={inside ? "var(--surface-1)" : "var(--ink-secondary)"}
              >
                {value}
              </text>
              {d.delta != null ? (
                <text
                  x={width - 4} y={pad.top + i * rowHeight + rowHeight / 2}
                  textAnchor="end" dominantBaseline="middle"
                  className="tabular" fontSize={11}
                  fill={d.delta >= 0 ? "var(--delta-good)" : "var(--delta-bad)"}
                >
                  {`${d.delta >= 0 ? "+" : "−"}${(Math.abs(d.delta) * 100).toFixed(0)}%`}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover && data.find((d) => d.id === hover)?.detail ? (
        <div className="bg-surface-2 text-ink-secondary mt-2 rounded-md px-2.5 py-1.5 text-[11px]">
          <span className="text-ink-primary font-medium">
            {data.find((d) => d.id === hover)!.label}
          </span>{" "}
          — {data.find((d) => d.id === hover)!.detail}
        </div>
      ) : null}
    </div>
  );
}
