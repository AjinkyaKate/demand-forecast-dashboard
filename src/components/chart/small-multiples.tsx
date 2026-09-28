"use client";

/**
 * Small multiples — one panel per series, each on its own y-scale.
 *
 * Four fuel grades on one shared axis is unreadable: Regular runs ~6,000
 * gal/day and Midgrade ~570, so three of the four series collapse onto the
 * baseline and their shape — the entire point of the chart — disappears.
 * Faceting is the fix the form calls for. A dual axis would not be: two
 * arbitrary scales on one plot invent a correlation that isn't in the data.
 *
 * The cost of faceting is that panel heights are no longer comparable, so
 * each panel states its own peak and the frame says so plainly.
 */

import { useCallback, useState } from "react";
import { linePath, linearScale, niceTicks, tickIndices } from "@/lib/chart/scales";
import { dowDate, shortDate } from "@/lib/format";
import { ChartTooltip, PillLabel, TooltipHeading, TooltipRow } from "./parts";
import { useChartWidth } from "./use-chart-width";
import type { LineSeries } from "./multi-line";

const PAD = { top: 4, right: 10, bottom: 32, left: 52 };
const GAP = 10;

export function SmallMultiples({
  dates,
  series,
  format,
  panelHeight = 62,
}: {
  dates: string[];
  series: LineSeries[];
  format: (n: number) => string;
  panelHeight?: number;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [cursor, setCursor] = useState<number | null>(null);

  const plotW = Math.max(60, width - PAD.left - PAD.right);
  const height =
    PAD.top + series.length * panelHeight + (series.length - 1) * GAP + PAD.bottom;

  const x = linearScale([0, Math.max(1, dates.length - 1)], [PAD.left, PAD.left + plotW]);

  const panels = series.map((s, i) => {
    const vals = s.values.filter((v): v is number => v != null);
    const max = vals.length ? Math.max(...vals) : 1;
    const { domain } = niceTicks(0, max, 2);
    const top = PAD.top + i * (panelHeight + GAP);
    const y = linearScale(domain, [top + panelHeight, top]);
    return { s, top, y, domain, peak: max };
  });

  const onMove = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const i = Math.round(((e.clientX - rect.left) / plotW) * (dates.length - 1));
      setCursor(Math.min(dates.length - 1, Math.max(0, i)));
    },
    [plotW, dates.length],
  );

  const xTicks = tickIndices(dates.length, width < 520 ? 3 : 5);

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`Daily volume for ${series.map((s) => s.label).join(", ")}, one panel per grade, each with its own vertical scale. Arrow keys step through days; the table view lists every value.`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            setCursor((c) => {
              const base = c ?? dates.length - 1;
              const next = base + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 7 : 1);
              return Math.min(dates.length - 1, Math.max(0, next));
            });
          } else if (e.key === "Escape") setCursor(null);
        }}
        onBlur={() => setCursor(null)}
        className="focus-visible:ring-ring touch-none rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        {panels.map(({ s, top, y, domain, peak }) => (
          <g key={s.id}>
            {/* Panel label rides the mark's colour via a short line key; the
                text itself stays in an ink token. */}
            <line
              x1={PAD.left - 44} x2={PAD.left - 32} y1={top + 6} y2={top + 6}
              stroke={s.color} strokeWidth={2} strokeLinecap="round"
            />
            <text x={PAD.left - 28} y={top + 6} dominantBaseline="middle"
              fontSize={11} fontWeight={600} fill="var(--ink-secondary)">
              {s.label}
            </text>
            <text x={PAD.left - 8} y={top + panelHeight} textAnchor="end"
              dominantBaseline="middle" className="tabular" fontSize={10}
              fill="var(--ink-muted)">
              0
            </text>
            <text x={PAD.left + plotW} y={top + 6} textAnchor="end"
              dominantBaseline="middle" className="tabular" fontSize={10}
              fill="var(--ink-muted)">
              peak {format(peak)}
            </text>

            <line
              x1={PAD.left} x2={PAD.left + plotW}
              y1={y(domain[1])} y2={y(domain[1])}
              stroke="var(--grid)" strokeWidth={1} shapeRendering="crispEdges"
            />
            <path
              d={linePath(
                s.values.map((v, i) => (v == null ? null : { x: x(i), y: y(v) })),
              )}
              fill="none" stroke={s.color} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round"
            />
            <line
              x1={PAD.left} x2={PAD.left + plotW}
              y1={top + panelHeight} y2={top + panelHeight}
              stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges"
            />
            {cursor != null && s.values[cursor] != null ? (
              <circle cx={x(cursor)} cy={y(s.values[cursor] as number)} r={3.5}
                fill={s.color} stroke="var(--surface-1)" strokeWidth={2}
                pointerEvents="none" />
            ) : null}
          </g>
        ))}

        {/* One crosshair spans every panel, so a single pointer position
            reads all four grades at the same date. */}
        {cursor != null ? (
          <line
            x1={x(cursor)} x2={x(cursor)} y1={PAD.top} y2={height - PAD.bottom}
            stroke="var(--ink-muted)" strokeWidth={1} pointerEvents="none"
          />
        ) : null}

        {xTicks.map((i) => (
          <PillLabel key={i} x={x(i)} y={height - 12} text={shortDate(dates[i])}
            anchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"} />
        ))}

        <rect x={PAD.left} y={PAD.top} width={plotW} height={height - PAD.top - PAD.bottom}
          fill="transparent" onPointerMove={onMove} onPointerDown={onMove}
          onPointerLeave={() => setCursor(null)} />
      </svg>

      {cursor != null ? (
        <ChartTooltip
          top={4}
          left={x(cursor) > PAD.left + plotW * 0.55 ? undefined : x(cursor) + 12}
          right={x(cursor) > PAD.left + plotW * 0.55 ? width - x(cursor) + 12 : undefined}
        >
          <TooltipHeading>{dowDate(dates[cursor])}</TooltipHeading>
          <dl className="mt-1.5 space-y-1">
            {series.map((s) => (
              <TooltipRow
                key={s.id}
                color={s.color}
                label={s.label}
                value={s.values[cursor] == null ? "—" : format(s.values[cursor] as number)}
              />
            ))}
          </dl>
        </ChartTooltip>
      ) : null}
    </div>
  );
}
