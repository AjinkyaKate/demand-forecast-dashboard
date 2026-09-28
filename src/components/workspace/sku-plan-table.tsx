"use client";

/**
 * The replenishment decision table.
 *
 * This is where the forecast turns into an action. Every column exists to
 * answer one question a buyer actually asks: how much will sell, what do I
 * have, when do I run out, and how many cases do I order today.
 */

import { useMemo, useState } from "react";
import type { PlanStatus, SkuPlanRow } from "@/lib/workspace/items";
import { currency, thousands } from "@/lib/format";
import { StatusBadge, type StatusTone } from "./shared";
import { cn } from "@/lib/utils";

const STATUS_META: Record<PlanStatus, { tone: StatusTone; label: string }> = {
  "order-now": { tone: "critical", label: "Order now" },
  "order-soon": { tone: "warning", label: "Order soon" },
  overstocked: { tone: "serious", label: "Overstocked" },
  healthy: { tone: "good", label: "Healthy" },
};

type SortKey =
  | "status"
  | "name"
  | "forecast"
  | "onHand"
  | "cover"
  | "order"
  | "cost";

const STATUS_RANK: Record<PlanStatus, number> = {
  "order-now": 0,
  "order-soon": 1,
  overstocked: 2,
  healthy: 3,
};

export function SkuPlanTable({
  rows,
  horizon,
}: {
  rows: SkuPlanRow[];
  horizon: number;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "status",
    dir: 1,
  });

  const sorted = useMemo(() => {
    const val = (r: SkuPlanRow): number | string => {
      switch (sort.key) {
        case "status": return STATUS_RANK[r.status];
        case "name": return r.sku.name;
        case "forecast": return r.horizonUnits;
        case "onHand": return r.onHand;
        case "cover": return Number.isFinite(r.daysOfSupply) ? r.daysOfSupply : 1e9;
        case "order": return r.suggestedUnits;
        case "cost": return r.orderCost;
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      const d = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
      // Stable tiebreak on cover so equal statuses still read urgent-first.
      return d !== 0 ? d * sort.dir : a.daysOfSupply - b.daysOfSupply;
    });
  }, [rows, sort]);

  const th = (key: SortKey, label: string, numeric = false) => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        data-numeric={numeric ? "" : undefined}
        aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
        className={cn(
          "bg-surface-2 sticky top-0 z-10 border-b px-3 py-2 font-medium",
          numeric ? "text-right" : "text-left",
        )}
      >
        <button
          type="button"
          onClick={() =>
            setSort((s) =>
              s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 },
            )
          }
          className={cn(
            "press inline-flex items-center gap-1 rounded whitespace-nowrap",
            "transition-colors duration-150",
            active ? "text-ink-primary" : "text-ink-secondary hover:text-ink-primary",
          )}
        >
          {label}
          <span aria-hidden className={cn("text-[8px]", active ? "opacity-100" : "opacity-0")}>
            {sort.dir === 1 ? "▲" : "▼"}
          </span>
        </button>
      </th>
    );
  };

  return (
    // Wide table scrolls inside its own container — the page body never does.
    <div className="max-h-[30rem] overflow-auto rounded-lg">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">
          Replenishment plan by SKU: forecast demand, current stock, days of
          cover, reorder point and suggested order quantity.
        </caption>
        <thead>
          <tr>
            {th("name", "Item")}
            {th("forecast", `Forecast ${horizon}d`, true)}
            {th("onHand", "On hand", true)}
            {th("cover", "Days cover", true)}
            <th scope="col" data-numeric className="bg-surface-2 text-ink-secondary sticky top-0 z-10 border-b px-3 py-2 text-right font-medium whitespace-nowrap">
              Reorder at
            </th>
            {th("order", "Order", true)}
            {th("cost", "Cost", true)}
            {th("status", "Status")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <tr key={r.sku.id} className="row-hover border-b last:border-0">
                <td className="px-3 py-2">
                  <p className="text-ink-primary font-medium">{r.sku.name}</p>
                  <p className="text-ink-muted text-[11px]">
                    {r.categoryName} · {r.sku.caseSize}/case · {r.sku.leadTimeDays}d lead
                  </p>
                </td>
                <td data-numeric className="text-ink-primary px-3 py-2 text-right">
                  {thousands(Math.round(r.horizonUnits))}
                </td>
                <td data-numeric className="text-ink-primary px-3 py-2 text-right">
                  {thousands(r.onHand)}
                </td>
                <td data-numeric className="px-3 py-2 text-right">
                  <span
                    className={cn(
                      "font-medium",
                      r.daysOfSupply <= r.sku.leadTimeDays
                        ? "text-[var(--status-critical)]"
                        : "text-ink-primary",
                    )}
                  >
                    {Number.isFinite(r.daysOfSupply)
                      ? r.daysOfSupply.toFixed(1)
                      : "—"}
                  </span>
                </td>
                <td data-numeric className="text-ink-muted px-3 py-2 text-right">
                  {thousands(Math.round(r.reorderPoint))}
                </td>
                <td data-numeric className="px-3 py-2 text-right">
                  {r.suggestedCases > 0 ? (
                    <>
                      <span className="text-ink-primary font-semibold">
                        {thousands(r.suggestedCases)}
                      </span>
                      <span className="text-ink-muted"> cs</span>
                      <p className="text-ink-muted text-[11px]">
                        {thousands(r.suggestedUnits)} units
                      </p>
                    </>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td data-numeric className="text-ink-primary px-3 py-2 text-right">
                  {r.orderCost > 0 ? currency(r.orderCost) : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    {r.spoilageRisk ? (
                      <StatusBadge tone="warning">
                        Spoilage risk · {r.sku.shelfLifeDays}d life
                      </StatusBadge>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
