"use client";

/**
 * The filter row.
 *
 * One row, left-aligned, above everything it scopes. Date range first, because
 * it is the control every reader reaches for. No chart carries its own filter —
 * every chart, stat and table below re-renders against the same slice, so the
 * numbers always agree.
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STORES } from "@/lib/data/catalog";
import {
  DEFAULT_FILTERS,
  HISTORY_PRESETS,
  HORIZON_PRESETS,
  type Filters,
} from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

type Ctx = {
  filters: Filters;
  update: (patch: Partial<Filters>) => void;
  /** True while a filter change is being applied. */
  pending: boolean;
};

const FiltersContext = createContext<Ctx | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [pending, startTransition] = useTransition();

  const value = useMemo<Ctx>(
    () => ({
      filters,
      pending,
      update: (patch) =>
        // A transition keeps the previous render on screen while the new slice
        // computes, which is what makes the "hold the frame" behaviour possible.
        startTransition(() => setFilters((f) => ({ ...f, ...patch }))),
    }),
    [filters, pending],
  );

  return <FiltersContext value={value}>{children}</FiltersContext>;
}

export function useFilters(): Ctx {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used inside FiltersProvider");
  return ctx;
}

/* -------------------------------------------------------------------------- */

function Field({
  label,
  value,
  onChange,
  options,
  widthClass = "w-[170px]",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  widthClass?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-muted text-[11px] font-medium">{label}</span>
      {/* `items` is what lets the trigger render the option's LABEL rather
          than its raw value — without it the store filter reads "s-101".
          onValueChange emits `string | null`; a cleared value is ignored so a
          filter can never fall out of scope. */}
      <Select
        items={options}
        value={value}
        onValueChange={(v) => {
          if (v != null) onChange(v);
        }}
      >
        <SelectTrigger
          size="sm"
          className={cn("press bg-surface-1 rounded-chip h-9 text-[13px]", widthClass)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-[13px]">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function FilterBar({
  scope,
}: {
  /** The module-specific scope control, rendered last in the row. */
  scope?: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] };
}) {
  const { filters, update } = useFilters();

  return (
    // Container radius 10px with 6px padding → inner controls at 6px stay
    // concentric (10 = 6 + 4 plus the control's own inset).
    <div className="surface-card rounded-inner flex flex-wrap items-end gap-x-3 gap-y-3 p-2 sm:gap-x-4">
      <Field
        label="Date range"
        value={String(filters.historyDays)}
        onChange={(v) => update({ historyDays: Number(v) })}
        options={HISTORY_PRESETS.map((p) => ({ value: String(p.value), label: p.label }))}
      />
      <Field
        label="Forecast horizon"
        value={String(filters.horizon)}
        onChange={(v) => update({ horizon: Number(v) })}
        options={HORIZON_PRESETS.map((p) => ({ value: String(p.value), label: p.label }))}
        widthClass="w-[150px]"
      />
      <Field
        label="Store"
        value={filters.storeId}
        onChange={(v) => update({ storeId: v as Filters["storeId"] })}
        options={STORES.map((s) => ({ value: s.id, label: s.name }))}
        widthClass="w-[248px]"
      />
      {scope ? (
        <Field
          label={scope.label}
          value={scope.value}
          onChange={scope.onChange}
          options={scope.options}
          widthClass="w-[190px]"
        />
      ) : null}
    </div>
  );
}
