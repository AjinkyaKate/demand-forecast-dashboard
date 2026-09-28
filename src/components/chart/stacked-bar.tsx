"use client";

/**
 * Part-to-whole as a single horizontal stacked bar.
 *
 * Segments are separated by a 2px gap in the surface colour — never a stroke
 * drawn around each segment, which would add data-weight ink that isn't data.
 *
 * Labels sit BELOW the bar in ink tokens rather than inside the fill. An
 * in-fill label has to pick white or ink by the fill's luminance, and these
 * fills arrive as `var(--series-N)` — a string no luminance function can
 * read. The first cut guessed, and shipped white "20%" on yellow at 2.1:1.
 * Putting the text outside the mark removes the guess entirely: the coloured
 * segment carries identity, the text beside it carries the number.
 */

import { useState } from "react";
import { approxTextWidth, roundedBarPath } from "@/lib/chart/paths";
import { px } from "@/lib/chart/scales";
import { useChartWidth } from "./use-chart-width";

export type StackSegment = {
  id: string;
  label: string;
  value: number;
  color: string;
};

const GAP = 2;

export function StackedBar({
  segments,
  format,
  thickness = 44,
}: {
  segments: StackSegment[];
  format: (n: number) => string;
  thickness?: number;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);

  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const height = thickness + 26;
  const usable = Math.max(40, width - GAP * (segments.length - 1));

  // Offsets are accumulated with a reduce rather than a mutable cursor —
  // reassigning across a render pass is exactly the kind of thing that goes
  // subtly wrong when React replays a render.
  const laid = segments.reduce<
    ({ x: number; w: number; share: number } & StackSegment)[]
  >((acc, s, i) => {
    const w = px((s.value / total) * usable);
    const x = px((acc[i - 1]?.x ?? 0) + (acc[i - 1]?.w ?? 0) + (i > 0 ? GAP : 0));
    acc.push({ ...s, x, w, share: s.value / total });
    return acc;
  }, []);

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img"
        aria-label="Share of volume by grade. Switch to the table view for exact values.">
        {laid.map((s, i) => {
          const pct = `${(s.share * 100).toFixed(0)}%`;
          const caption = `${s.label} ${pct}`;
          const side =
            laid.length === 1 ? "none" : i === 0 ? "left" : i === laid.length - 1 ? "right" : "none";
          // A segment too narrow for its caption gets none; the legend, the
          // tooltip and the table view all still carry the value.
          const fits = s.w > approxTextWidth(caption, 11) + 8;
          const pctOnly = !fits && s.w > approxTextWidth(pct, 11) + 6;
          return (
            <g
              key={s.id}
              tabIndex={0}
              onPointerEnter={() => setHover(s.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(s.id)}
              onBlur={() => setHover(null)}
              className="focus-visible:outline-none"
            >
              <path
                d={roundedBarPath(s.x, 0, Math.max(1, s.w), thickness, 8, side)}
                fill={s.color}
                opacity={hover && hover !== s.id ? 0.55 : 1}
                style={{ transition: "opacity 150ms var(--ease-out)" }}
              />
              {fits || pctOnly ? (
                <text
                  x={s.x + s.w / 2}
                  y={thickness + 15}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--ink-secondary)"
                >
                  {fits ? (
                    <>
                      {s.label}{" "}
                      <tspan className="tabular" fontWeight={600} fill="var(--ink-primary)">
                        {pct}
                      </tspan>
                    </>
                  ) : (
                    <tspan className="tabular" fontWeight={600} fill="var(--ink-primary)">
                      {pct}
                    </tspan>
                  )}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover ? (
        <div className="bg-surface-2 text-ink-secondary mt-1 rounded-md px-2.5 py-1.5 text-[11px]">
          <span className="text-ink-primary font-medium">
            {laid.find((s) => s.id === hover)!.label}
          </span>
          <span className="tabular">
            {" "}
            — {format(laid.find((s) => s.id === hover)!.value)} (
            {(laid.find((s) => s.id === hover)!.share * 100).toFixed(1)}%)
          </span>
        </div>
      ) : null}
    </div>
  );
}
