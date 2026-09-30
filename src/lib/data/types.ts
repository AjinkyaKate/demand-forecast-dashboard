/**
 * Shapes of the data the app reads from SQLite. The database is the only
 * source: nothing here carries values, only types.
 */

export type StoreId = string;
export type CategoryId = string;
export type FuelGradeId = string;

export type Store = {
  id: StoreId;
  name: string;
  format: string;
  traffic: number;
  fuelSkew: number;
  historyStart: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  region: string | null;
};

/** An event near a store, from PredictHQ. */
export type LocalEvent = {
  id: string;
  title: string;
  category: string;
  start: string;
  end: string;
  attendance: number | null;
  rank: number | null;
  distanceKm: number | null;
};

export type Category = { id: CategoryId; name: string; short: string };

export type Sku = {
  id: string;
  name: string;
  category: CategoryId;
  unitCost: number;
  unitPrice: number;
  /** Units per case — orders are placed in cases, not units. */
  caseSize: number;
  leadTimeDays: number;
  /** Null for non-perishables. */
  shelfLifeDays: number | null;
};

export type FuelGrade = {
  id: FuelGradeId;
  name: string;
  short: string;
  octane: string;
  tankGallons: number;
  reserveFraction: number;
  marginPerGallon: number;
  priceElasticity: number;
};

/** One calendar day: weather, holidays, and its place in the series. */
export type DayCtx = {
  date: string;
  /** 0 = first day of this store's history. */
  t: number;
  /** Day of year, 1-366. */
  doy: number;
  /** 0 = Sunday. */
  dow: number;
  isWeekend: boolean;
  tempF: number;
  /** Departure from the seasonal normal, °F. */
  tempAnomaly: number;
  /** Rain, mm. */
  precipMm: number;
  /** Open-Meteo reading kind: observed history, forecast, or no reading. */
  weatherSource: "observed" | "forecast" | "none";
  holiday: string | null;
  /** 1 on a public holiday (national or the store's state), else 0. */
  holidayWeight: number;
  /** True for the day before a major holiday — the stock-up day. */
  preHoliday: boolean;
  /** Name of the holiday that follows, when preHoliday is set. */
  nextHoliday: string | null;
  /** True once the date is past the last day of sales. */
  isFuture: boolean;
};

export type OpsEvent = {
  id: string;
  start: string;
  end: string;
  label: string;
  kind: "weather" | "traffic" | "equipment" | "supply" | "competition" | "local";
  /** Which series it touches. */
  scope: "all" | "fuel" | "inside" | CategoryId[];
  /** Multiplicative effect logged for the window. */
  effect: number;
  note: string;
};

/** One SKU's daily series at one store, with its observable feature columns. */
export type ItemSeries = {
  skuId: string;
  storeId: StoreId;
  dates: string[];
  /** Units sold. Length = history only. */
  units: number[];
  /** Feature columns span history + future. */
  onPromo: boolean[];
  discount: number[];
  priceIndex: number[];
};

export type FuelSeries = {
  gradeId: FuelGradeId;
  storeId: StoreId;
  dates: string[];
  gallons: number[];
  /** Street price, history + future (held at the last observed price). */
  price: number[];
  /** Price relative to its trailing 90-day mean — the elasticity feature. */
  priceIndex: number[];
};
