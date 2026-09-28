import type { CategoryId, FuelGradeId, StoreId } from "../data/catalog";

/** Filter state. One row of controls scopes every chart, stat and table. */
export type Filters = {
  storeId: StoreId;
  /** Days of history shown. Does not change the fit — the model always uses
   *  the full two years; this is the visible window. */
  historyDays: number;
  /** Forecast horizon in days. */
  horizon: number;
  categoryId: CategoryId | "all";
  gradeId: FuelGradeId | "all";
};

export const HISTORY_PRESETS = [
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 180, label: "Last 180 days" },
  { value: 365, label: "Last 12 months" },
  { value: 730, label: "Last 24 months" },
] as const;

export const HORIZON_PRESETS = [
  { value: 7, label: "Next 7 days" },
  { value: 14, label: "Next 14 days" },
  { value: 30, label: "Next 30 days" },
] as const;

export const DEFAULT_FILTERS: Filters = {
  storeId: "s-101",
  historyDays: 180,
  horizon: 14,
  categoryId: "all",
  gradeId: "all",
};

/** Service level used for safety stock and the headline band. */
export const SERVICE_Z = 1.2816; // ~90% cycle service on a one-sided normal
