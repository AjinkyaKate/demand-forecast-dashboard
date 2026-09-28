"use client";

/**
 * Multi-series line chart with direct end-labels.
 *
 * At four series direct labels stop being optional — yellow and orange share
 * the screen — so every series is labelled at its end as well as in the
 * legend. When ends converge the labels are pushed apart and connected back to
 * their line with a leader, never silently stacked.
 */

import { useCallback, useMemo, useState } from "react";
import { linePath, linearScale, niceTicks, tickIndices } from "@/lib/chart/scales";
import { approxTextWidth } from "@/lib/chart/paths";
import { dowDate, shortDate } from "@/lib/format";
import { ChartTooltip, PillLabel, TooltipHeading, TooltipRow } from "./parts";
import { useChartWidth } from "./use-chart-width";

export type LineSeries = {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
};

const PAD = { top: 10, right: 12, bottom: 34, left: 52 };
const MIN_LABEL_GAP = 14;

export function MultiLine({
  dates,
  series,
  height = 260,
  format,
  labelGutter = 74,
}: {
  dates: string[];
  series: LineSeries[];
  height?: number;
  format: (n: number) => string;
  labelGutter?: number;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [cursor, setCursor] = useState<number | null>(null);

  const plotW = Math.max(60, width - PAD.left - PAD.right - labelGutter);
  const plotH = Math.max(60, height - PAD.top - PAD.bottom);

  const geom = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
    const max = all.length ? Math.max(...all) : 1;
    const { ticks, domain } = niceTicks(0, max, 5);
    const x = linearScale([0, Math.max(1, dates.length - 1)], [PAD.left, PAD.left + plotW]);
    const y = linearScale(domain, [PAD.top + plotH, PAD.top]);

    // End-label de-collision: take each series' last finite point, then push
    // overlapping labels apart and remember the original y for the leader line.
    const ends = series
      .map((s) => {
        let i = s.values.length - 1;
        while (i >= 0 && s.values[i] == null) i--;
        return i >= 0 ? { s, i, yTrue: y(s.values[i] as number) } : null;
      })
      .filter(Boolean) as { s: LineSeries; i: number; yTrue: number }[];

    ends.sort((a, b) => a.yTrue - b.yTrue);
    const placed = ends.map((e) => ({ ...e, yLabel: e.yTrue }));
    for (let k = 1; k < placed.length; k++) {
      const gap = placed[k].yLabel - placed[k - 1].yLabel;
      if (gap < MIN_LABEL_GAP) placed[k].yLabel = placed[k - 1].yLabel + MIN_LABEL_GAP;
    }
    // Keep the pushed stack inside the plot.
    const overflow = placed.length
      ? placed[placed.length - 1].yLabel - (PAD.top + plotH)
      : 0;
    if (overflow > 0) for (const p of placed) p.yLabel -= overflow;

    return { x, y, ticks, domain, placed };
  }, [series, dates.length, plotW, plotH]);

  const onMove = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const rel = e.clientX - rect.left;
      const i = Math.round((rel / plotW) * (dates.length - 1));
      setCursor(Math.min(dates.length - 1, Math.max(0, i)));
    },
    [plotW, dates.length],
  );

  const xTicks = tickIndices(dates.length, width < 520 ? 4 : 6);
  const active = cursor != null ? cursor : null;

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`${series.map((s) => s.label).join(", ")} over time. Arrow keys step through days; the table view lists every value.`}
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
        {geom.ticks.map((t) => (
          <line key={t} x1={PAD.left} x2={PAD.left + plotW} y1={geom.y(t)} y2={geom.y(t)}
            stroke="var(--grid)" strokeWidth={1} shapeRendering="crispEdges" />
        ))}
        {geom.ticks.map((t) => (
          <text key={`l-${t}`} x={PAD.left - 8} y={geom.y(t)} textAnchor="end"
            dominantBaseline="middle" className="tabular" fontSize={11} fill="var(--ink-muted)">
            {format(t)}
          </text>
        ))}

        {series.map((s) => (
          <path
            key={s.id}
            d={linePath(s.values.map((v, i) => (v == null ? null : { x: geom.x(i), y: geom.y(v) })))}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Direct end-labels with leader lines where they had to move. */}
        {geom.placed.map((p) => {
          const moved = Math.abs(p.yLabel - p.yTrue) > 1.5;
          const lx = geom.x(p.i);
          return (
            <g key={`end-${p.s.id}`}>
              <circle cx={lx} cy={p.yTrue} r={4} fill={p.s.color}
                stroke="var(--surface-1)" strokeWidth={2} />
              {moved ? (
                <path
                  d={`M${lx + 5} ${p.yTrue}L${lx + 12} ${p.yLabel}`}
                  stroke="var(--axis)" strokeWidth={1} fill="none"
                />
              ) : null}
              <text
                x={lx + (moved ? 15 : 9)}
                y={p.yLabel}
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={600}
                fill="var(--ink-secondary)"
              >
                {p.s.label}
              </text>
            </g>
          );
        })}

        <line x1={PAD.left} x2={PAD.left + plotW} y1={PAD.top + plotH} y2={PAD.top + plotH}
          stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges" />

        {xTicks.map((i) => (
          <PillLabel key={`x-${i}`} x={geom.x(i)} y={height - 12}
            text={shortDate(dates[i])} anchor={i === 0 ? "start" : "middle"} />
        ))}

        {active != null ? (
          <g pointerEvents="none">
            <line x1={geom.x(active)} x2={geom.x(active)} y1={PAD.top} y2={PAD.top + plotH}
              stroke="var(--ink-muted)" strokeWidth={1} />
            {series.map((s) =>
              s.values[active] != null ? (
                <circle key={`c-${s.id}`} cx={geom.x(active)} cy={geom.y(s.values[active] as number)}
                  r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
              ) : null,
            )}
          </g>
        ) : null}

        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent"
          onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setCursor(null)} />
      </svg>

      {active != null ? (
        <ChartTooltip
          left={geom.x(active) > PAD.left + plotW * 0.55 ? undefined : geom.x(active) + 12}
          right={geom.x(active) > PAD.left + plotW * 0.55 ? width - geom.x(active) + 12 : undefined}
        >
          <TooltipHeading>{dowDate(dates[active])}</TooltipHeading>
          <dl className="mt-1.5 space-y-1">
            {series.map((s) => (
              <TooltipRow
                key={s.id}
                color={s.color}
                label={s.label}
                value={s.values[active] == null ? "—" : format(s.values[active] as number)}
              />
            ))}
          </dl>
        </ChartTooltip>
      ) : null}
    </div>
  );
}

/** Width the end-label gutter needs for a given set of labels. */
export function gutterFor(labels: string[]): number {
  return Math.ceil(Math.max(...labels.map((l) => approxTextWidth(l, 11))) + 22);
}
