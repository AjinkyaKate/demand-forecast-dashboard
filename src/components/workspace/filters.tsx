"use client";

/**
 * The filter row.
 *
 * One compact group at the right of the page's header card, above everything
 * it scopes. The controls carry no visible labels — their values ("Next 14
 * days", "Store 101 …", "All categories") say what they are; screen readers
 * still get the names. Horizon first, because it is the control every reader reaches for.
 * No chart carries its own filter — every chart, stat and table below
 * re-renders against the same slice, so the numbers always agree. The group
 * stays put and usable while a new slice loads; "Updating…" says so.
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
import { useMeta } from "@/components/shell/meta";
import {
  DEFAULT_FILTERS,
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
  const [chosen, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [pending, startTransition] = useTransition();
  const { meta } = useMeta();

  // The store list comes from the database; until a store is chosen (or if
  // the chosen one disappears) the first store in it is the default.
  const stores = meta?.stores;
  const filters = useMemo<Filters>(() => {
    if (!stores?.length) return chosen;
    const known = stores.some((s) => s.id === chosen.storeId);
    return known ? chosen : { ...chosen, storeId: stores[0].id };
  }, [chosen, stores]);

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

export function Field({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  // The trigger sizes itself to the widest option once, so the row never
  // shifts when a shorter value is picked. The name stays for screen readers;
  // the value says what the control is.
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn("min-h-8 gap-1.5 px-2.5 py-1 text-[13px]", className)}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent align="end" className="shadow-(--shadow-pop)">
        {options.map((o) => (
          <SelectItem
            key={o.value}
            value={o.value}
            className="min-h-9 py-2 pe-9 text-[13px]"
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The container every page's filters sit in, with the loading note. */
export function FilterGroup({ busy, children }: { busy?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
      <span
        role="status"
        aria-live="polite"
        // Out of the layout when idle (so it never leaves a blank row on a
        // narrow screen), but always mounted so the live region announces.
        className={cn(
          "text-ink-muted items-center gap-1.5 text-[11px]",
          busy ? "flex" : "sr-only",
        )}
      >
        <span aria-hidden className="border-ink-muted size-3 animate-spin rounded-full border-2 border-t-transparent" />
        {busy ? "Updating…" : ""}
      </span>
      <div className="flex max-w-full flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export function FilterBar({
  scope,
  busy,
}: {
  /** The module-specific scope control, rendered last in the row. */
  scope?: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] };
  /** A new slice is loading. */
  busy?: boolean;
}) {
  const { filters, update, pending } = useFilters();
  const { meta } = useMeta();

  return (
    <FilterGroup busy={busy || pending}>
      <Field
        label="Forecast horizon"
        value={String(filters.horizon)}
        onChange={(v) => update({ horizon: Number(v) })}
        options={HORIZON_PRESETS.map((p) => ({ value: String(p.value), label: p.label }))}
      />
      <Field
        label="Store"
        value={filters.storeId}
        onChange={(v) => update({ storeId: v as Filters["storeId"] })}
        options={(meta?.stores ?? []).map((s) => ({ value: s.id, label: s.name }))}
      />
      {scope ? (
        <Field
          label={scope.label}
          value={scope.value}
          onChange={scope.onChange}
          options={scope.options}
        />
      ) : null}
    </FilterGroup>
  );
}
