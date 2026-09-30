"use client";

/**
 * The container every chart mounts in: title, legend, the table-view toggle,
 * and a notes slot.
 *
 * The table view is not an extra — it is the chart's accessibility twin and
 * the relief channel for the sub-3:1 categorical slots in light mode. Every
 * value a tooltip can show is reachable here without hovering anything.
 *
 * Method notes sit behind a toggle rather than under every card. They carry
 * real caveats — a median is not a mean, a bridge depends on its order — so
 * they are one click away and announced, not deleted. But a paragraph under
 * each of nine charts buries the data it is meant to qualify.
 */

import { AnimatePresence, motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type LegendItem = {
  label: string;
  color: string;
  /** Legends mirror the mark: a line for lines, a rect for bars and areas. */
  shape?: "line" | "rect" | "band" | "ring" | "conf-gradient";
};

function LegendKey({ item }: { item: LegendItem }) {
  const shape = item.shape ?? "line";
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="flex h-3 w-3 items-center justify-center">
        {shape === "line" && (
          <span
            className="block h-0.5 w-3 rounded-full"
            style={{ backgroundColor: item.color }}
          />
        )}
        {shape === "rect" && (
          <span
            className="block h-2.5 w-2.5 rounded-[3px]"
            style={{ backgroundColor: item.color }}
          />
        )}
        {shape === "band" && (
          <span
            className="block h-2.5 w-2.5 rounded-[3px]"
            style={{ backgroundColor: item.color, opacity: 0.22 }}
          />
        )}
        {shape === "ring" && (
          <span
            className="block h-2.5 w-2.5 rounded-full border-2"
            style={{ borderColor: item.color }}
          />
        )}
        {shape === "conf-gradient" && (
          <span
            className="block h-2.5 w-4 rounded-[3px]"
            style={{ background: "linear-gradient(to right, #22c55e, #eab308, #ef4444)", opacity: 0.55 }}
          />
        )}
      </span>
      <span className="text-ink-secondary text-[13px]">{item.label}</span>
    </span>
  );
}

const TableIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" className="size-4">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 10v10" />
  </svg>
);

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" className="size-4">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.5" />
  </svg>
);

const ChartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" className="size-4">
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="M7 14l4-4 3 3 5-6" />
  </svg>
);

export type ChartFrameProps = {
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  /** Rendered when the reader switches to the table view. */
  table: ReactNode;
  caption?: ReactNode;
  /** Extra controls placed left of the table toggle. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  caption,
  actions,
  children,
  className,
}: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const bodyId = useId();
  const notesId = useId();

  return (
    // Card radius 20px with 20px padding; inner surfaces derive from this.
    <figure
      className={cn(
        "surface-card rounded-card flex flex-col gap-5 p-5 sm:p-6",
        className,
      )}
    >
      <figcaption className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-ink-primary text-[15px] leading-tight font-medium">
            {title}
          </h3>
          {subtitle ? (
            <p className="text-ink-muted mt-1 text-[13px] leading-snug">{subtitle}</p>
          ) : null}
        </div>

        {/* No shrink-0: on a narrow viewport a wide legend would push the
            card past the viewport and make the page body scroll sideways. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          {legend && legend.length > 1 ? (
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {legend.map((item) => (
                <li key={item.label}>
                  <LegendKey item={item} />
                </li>
              ))}
            </ul>
          ) : null}
          {actions}
          {caption ? (
            <button
              type="button"
              onClick={() => setShowNotes((v) => !v)}
              aria-pressed={showNotes}
              aria-controls={notesId}
              className={cn(
                "press icon-btn focus-visible:ring-ring size-8",
                "focus-visible:ring-2 focus-visible:outline-none",
                showNotes && "text-ink-primary bg-surface-2",
              )}
            >
              <InfoIcon />
              <span className="sr-only">
                {showNotes ? "Hide method notes" : "Show method notes"}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            aria-controls={bodyId}
            className={cn(
              "press icon-btn focus-visible:ring-ring relative size-8",
              "focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            {/* Contextual icon swap: scale 0.25 -> 1, blur 4px -> 0,
                spring duration 0.3 with bounce 0. initial={false} keeps it
                from animating on first paint. */}
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={showTable ? "chart" : "table"}
                initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                className="grid place-items-center"
              >
                {showTable ? <ChartIcon /> : <TableIcon />}
              </motion.span>
            </AnimatePresence>
            <span className="sr-only">
              {showTable ? "Show chart" : "Show data table"}
            </span>
          </button>
        </div>
      </figcaption>

      <div id={bodyId}>
        {showTable ? (
          <div className="rounded-inner max-h-[22rem] overflow-auto">{table}</div>
        ) : (
          children
        )}
      </div>

      {caption && showNotes ? (
        <p
          id={notesId}
          className="text-ink-muted border-hairline border-t pt-4 text-xs leading-relaxed"
        >
          {caption}
        </p>
      ) : null}
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* The table twin                                                             */
/* -------------------------------------------------------------------------- */

export type TableColumn<T> = {
  key: string;
  header: string;
  numeric?: boolean;
  render: (row: T) => ReactNode;
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
}: {
  rows: T[];
  columns: TableColumn<T>[];
  rowKey: (row: T, i: number) => string;
  caption?: string;
}) {
  return (
    <table className="w-full border-collapse text-xs">
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <thead className="bg-surface-2 sticky top-0 z-10">
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              data-numeric={c.numeric ? "" : undefined}
              className={cn(
                "text-ink-secondary border-b px-3 py-2 font-medium whitespace-nowrap",
                c.numeric ? "text-right" : "text-left",
              )}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={rowKey(row, i)} className="row-hover border-b last:border-0">
            {columns.map((c) => (
              <td
                key={c.key}
                data-numeric={c.numeric ? "" : undefined}
                className={cn(
                  "text-ink-primary px-3 py-1.5 whitespace-nowrap",
                  c.numeric ? "text-right" : "text-left",
                )}
              >
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
