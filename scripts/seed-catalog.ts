/**
 * Seed input only: the demo catalog that scripts/seed.ts writes into SQLite.
 * The app never imports this file — at runtime every store, SKU, grade,
 * holiday and event is read from the database.
 *
 * The C-store catalog: stores, SKUs, fuel grades and the observable calendar.
 *
 * "Observable" matters — the driver model (lib/forecast/drivers.ts) is only
 * allowed to regress on things a real operator would actually have in their
 * systems: promo calendar, holidays, street price, weather. It never sees the
 * latent parameters used to synthesise the series.
 */

/** The dataset's as-of date. Fixed, not `new Date()`, so SSR and hydration
 *  agree and every figure is reproducible. */
export const AS_OF = "2026-09-26";

/** Two years of daily history ending the day before AS_OF. */
export const HISTORY_DAYS = 730;

export type CategoryId =
  | "beverages"
  | "hot-food"
  | "salty-snacks"
  | "candy"
  | "beer-wine"
  | "tobacco"
  | "dairy-grocery"
  | "auto-nonfood";

export type Category = {
  id: CategoryId;
  name: string;
  /** Short label for dense axes and legends. */
  short: string;
};

export const CATEGORIES: Category[] = [
  { id: "beverages", name: "Packaged Beverages", short: "Beverages" },
  { id: "hot-food", name: "Hot & Prepared Food", short: "Hot Food" },
  { id: "salty-snacks", name: "Salty Snacks", short: "Snacks" },
  { id: "candy", name: "Candy & Sweets", short: "Candy" },
  { id: "beer-wine", name: "Beer & Wine", short: "Beer & Wine" },
  { id: "tobacco", name: "Tobacco & Alternatives", short: "Tobacco" },
  { id: "dairy-grocery", name: "Dairy & Grocery", short: "Grocery" },
  { id: "auto-nonfood", name: "Auto & Non-Food", short: "Auto" },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export type StoreId = "s-101" | "s-204" | "s-318" | "s-442";

export type Store = {
  id: StoreId;
  name: string;
  format: "Highway" | "Urban" | "Suburban" | "Rural";
  /** Multiplies every series — traffic scale of the site. */
  traffic: number;
  /** Fuel-to-inside sales skew; highway sites pump far more per basket. */
  fuelSkew: number;
  /** Demo site location — drives per-store weather and nearby events. */
  latitude: number;
  longitude: number;
  timezone: string;
  /** ISO 3166-2 subdivision, for state-level public holidays. */
  region: string;
};

export const STORES: Store[] = [
  {
    id: "s-101",
    name: "Store 101 — Route 9 Travel Center",
    format: "Highway",
    traffic: 1.0,
    fuelSkew: 1.35,
    latitude: 40.2415,
    longitude: -74.2966,
    timezone: "America/New_York",
    region: "US-NJ",
  },
  {
    id: "s-204",
    name: "Store 204 — Midtown & 5th",
    format: "Urban",
    traffic: 0.82,
    fuelSkew: 0.7,
    latitude: 40.4953,
    longitude: -74.4452,
    timezone: "America/New_York",
    region: "US-NJ",
  },
  {
    id: "s-318",
    name: "Store 318 — Lakeside Commons",
    format: "Suburban",
    traffic: 0.74,
    fuelSkew: 0.95,
    latitude: 40.0885,
    longitude: -74.217,
    timezone: "America/New_York",
    region: "US-NJ",
  },
  {
    id: "s-442",
    name: "Store 442 — County Road 12",
    format: "Rural",
    traffic: 0.55,
    fuelSkew: 1.1,
    latitude: 40.5334,
    longitude: -74.9443,
    timezone: "America/New_York",
    region: "US-NJ",
  },
];

export const STORE_BY_ID = new Map(STORES.map((s) => [s.id, s]));

/** Latent shape parameters — used to *generate*, never read by the models. */
export type SkuShape = {
  /** Mean units/day at the reference store before any effect. */
  base: number;
  /** Peak-to-mean amplitude of the annual cycle, 0–1. */
  yearAmp: number;
  /** Day-of-year the annual cycle peaks. */
  yearPeak: number;
  /** Seven multipliers, Sunday-first. Mean ~1. */
  dow: [number, number, number, number, number, number, number];
  /** Compounding trend per year, e.g. 0.06 = +6 %/yr. */
  trend: number;
  /** Multiplier applied on promo days. */
  promoLift: number;
  /** Units of lift per °F above the seasonal-normal temperature. */
  tempCoef: number;
  /** Multiplier on major holidays. */
  holidayLift: number;
};

export type Sku = {
  id: string;
  name: string;
  category: CategoryId;
  unitCost: number;
  unitPrice: number;
  /** Units per case — orders are placed in cases, not units. */
  caseSize: number;
  /** Supplier lead time in days. */
  leadTimeDays: number;
  /** Null for non-perishables. */
  shelfLifeDays: number | null;
  shape: SkuShape;
};

const dow = (
  ...v: number[]
): [number, number, number, number, number, number, number] =>
  v as [number, number, number, number, number, number, number];

// Weekday shapes, Sunday-first.
const COMMUTER = dow(0.72, 1.16, 1.18, 1.17, 1.15, 1.12, 0.8); // weekday AM rush
const WEEKEND = dow(1.24, 0.82, 0.8, 0.84, 0.94, 1.24, 1.42); // Fri–Sun heavy
const FLAT = dow(0.98, 0.99, 0.98, 1.0, 1.01, 1.04, 1.0);
const FRIDAY = dow(1.05, 0.85, 0.84, 0.88, 0.98, 1.3, 1.3);

export const SKUS: Sku[] = [
  // --- Packaged Beverages -------------------------------------------------
  s("bev-001", "Cola 20 oz Bottle", "beverages", 0.82, 2.29, 24, 3, null, {
    base: 68, yearAmp: 0.3, yearPeak: 196, dow: FLAT, trend: -0.02,
    promoLift: 1.55, tempCoef: 0.9, holidayLift: 1.15,
  }),
  s("bev-002", "Diet Cola 20 oz Bottle", "beverages", 0.82, 2.29, 24, 3, null, {
    base: 41, yearAmp: 0.27, yearPeak: 196, dow: FLAT, trend: -0.04,
    promoLift: 1.5, tempCoef: 0.8, holidayLift: 1.1,
  }),
  s("bev-003", "Energy Drink 16 oz", "beverages", 1.61, 3.99, 12, 4, null, {
    base: 57, yearAmp: 0.18, yearPeak: 186, dow: COMMUTER, trend: 0.14,
    promoLift: 1.75, tempCoef: 0.6, holidayLift: 0.9,
  }),
  s("bev-004", "Energy Drink Zero 16 oz", "beverages", 1.61, 3.99, 12, 4, null, {
    base: 33, yearAmp: 0.18, yearPeak: 186, dow: COMMUTER, trend: 0.26,
    promoLift: 1.8, tempCoef: 0.6, holidayLift: 0.9,
  }),
  s("bev-005", "Spring Water 1 L", "beverages", 0.44, 1.89, 24, 2, null, {
    base: 74, yearAmp: 0.46, yearPeak: 201, dow: FLAT, trend: 0.08,
    promoLift: 1.4, tempCoef: 1.8, holidayLift: 1.05,
  }),
  s("bev-006", "Sports Drink 32 oz", "beverages", 1.12, 2.79, 12, 3, null, {
    base: 29, yearAmp: 0.52, yearPeak: 199, dow: WEEKEND, trend: 0.05,
    promoLift: 1.6, tempCoef: 1.5, holidayLift: 1.0,
  }),
  s("bev-007", "Iced Coffee 13.7 oz", "beverages", 1.34, 3.29, 12, 4, null, {
    base: 24, yearAmp: 0.34, yearPeak: 191, dow: COMMUTER, trend: 0.18,
    promoLift: 1.45, tempCoef: 0.9, holidayLift: 0.85,
  }),
  s("bev-008", "Orange Juice 12 oz", "beverages", 1.05, 2.49, 12, 2, 21, {
    base: 18, yearAmp: 0.22, yearPeak: 31, dow: COMMUTER, trend: -0.03,
    promoLift: 1.35, tempCoef: -0.3, holidayLift: 1.0,
  }),

  // --- Hot & Prepared Food ------------------------------------------------
  s("hot-001", "Brewed Coffee 16 oz", "hot-food", 0.31, 2.19, 1, 2, 1, {
    base: 132, yearAmp: 0.3, yearPeak: 15, dow: COMMUTER, trend: 0.04,
    promoLift: 1.28, tempCoef: -1.9, holidayLift: 0.72,
  }),
  s("hot-002", "Brewed Coffee 20 oz", "hot-food", 0.38, 2.69, 1, 2, 1, {
    base: 88, yearAmp: 0.31, yearPeak: 15, dow: COMMUTER, trend: 0.07,
    promoLift: 1.28, tempCoef: -1.7, holidayLift: 0.72,
  }),
  s("hot-003", "Roller Grill Hot Dog", "hot-food", 0.52, 2.49, 1, 3, 2, {
    base: 47, yearAmp: 0.25, yearPeak: 189, dow: FLAT, trend: -0.05,
    promoLift: 1.65, tempCoef: 0.5, holidayLift: 0.8,
  }),
  s("hot-004", "Breakfast Sandwich", "hot-food", 1.42, 3.99, 1, 2, 2, {
    base: 39, yearAmp: 0.16, yearPeak: 40, dow: COMMUTER, trend: 0.11,
    promoLift: 1.5, tempCoef: -0.6, holidayLift: 0.7,
  }),
  s("hot-005", "Pizza Slice", "hot-food", 1.06, 3.49, 1, 3, 1, {
    base: 34, yearAmp: 0.14, yearPeak: 320, dow: WEEKEND, trend: 0.03,
    promoLift: 1.7, tempCoef: -0.2, holidayLift: 0.85,
  }),
  s("hot-006", "Chicken Tenders 3 pc", "hot-food", 2.1, 4.99, 1, 3, 1, {
    base: 21, yearAmp: 0.12, yearPeak: 310, dow: WEEKEND, trend: 0.16,
    promoLift: 1.6, tempCoef: -0.2, holidayLift: 0.85,
  }),
  s("hot-007", "Frozen Carbonated 32 oz", "hot-food", 0.29, 1.99, 1, 3, null, {
    base: 36, yearAmp: 0.72, yearPeak: 198, dow: WEEKEND, trend: 0.02,
    promoLift: 1.55, tempCoef: 2.4, holidayLift: 1.1,
  }),

  // --- Salty Snacks -------------------------------------------------------
  s("snk-001", "Potato Chips 2.5 oz", "salty-snacks", 0.94, 2.49, 24, 4, 60, {
    base: 52, yearAmp: 0.14, yearPeak: 188, dow: WEEKEND, trend: 0.01,
    promoLift: 1.68, tempCoef: 0.3, holidayLift: 1.2,
  }),
  s("snk-002", "Tortilla Chips 3 oz", "salty-snacks", 1.02, 2.79, 24, 4, 60, {
    base: 31, yearAmp: 0.16, yearPeak: 185, dow: WEEKEND, trend: 0.04,
    promoLift: 1.7, tempCoef: 0.3, holidayLift: 1.35,
  }),
  s("snk-003", "Peanuts 3 oz", "salty-snacks", 0.71, 2.19, 24, 5, 120, {
    base: 19, yearAmp: 0.1, yearPeak: 180, dow: FLAT, trend: -0.02,
    promoLift: 1.4, tempCoef: 0.1, holidayLift: 1.05,
  }),
  s("snk-004", "Beef Jerky 2.85 oz", "salty-snacks", 3.85, 8.49, 12, 6, 180, {
    base: 14, yearAmp: 0.12, yearPeak: 192, dow: WEEKEND, trend: 0.09,
    promoLift: 1.5, tempCoef: 0.1, holidayLift: 1.1,
  }),
  s("snk-005", "Pork Rinds 2 oz", "salty-snacks", 0.88, 2.29, 24, 5, 90, {
    base: 11, yearAmp: 0.1, yearPeak: 190, dow: WEEKEND, trend: -0.06,
    promoLift: 1.45, tempCoef: 0.1, holidayLift: 1.05,
  }),
  s("snk-006", "Trail Mix 4 oz", "salty-snacks", 1.64, 3.99, 12, 5, 150, {
    base: 13, yearAmp: 0.18, yearPeak: 196, dow: FLAT, trend: 0.12,
    promoLift: 1.45, tempCoef: 0.2, holidayLift: 1.0,
  }),

  // --- Candy & Sweets -----------------------------------------------------
  s("cnd-001", "Chocolate Bar King Size", "candy", 1.08, 2.69, 24, 5, 240, {
    base: 44, yearAmp: 0.2, yearPeak: 300, dow: FLAT, trend: 0.0,
    promoLift: 1.72, tempCoef: -0.5, holidayLift: 1.45,
  }),
  s("cnd-002", "Gummy Candy 5 oz", "candy", 1.16, 2.99, 12, 5, 270, {
    base: 23, yearAmp: 0.24, yearPeak: 300, dow: WEEKEND, trend: 0.07,
    promoLift: 1.65, tempCoef: -0.2, holidayLift: 1.6,
  }),
  s("cnd-003", "Mints 1.5 oz", "candy", 0.62, 1.89, 24, 6, 365, {
    base: 17, yearAmp: 0.08, yearPeak: 180, dow: COMMUTER, trend: -0.03,
    promoLift: 1.3, tempCoef: 0.0, holidayLift: 1.0,
  }),
  s("cnd-004", "Gum 15 ct", "candy", 0.74, 2.19, 24, 6, 365, {
    base: 26, yearAmp: 0.08, yearPeak: 180, dow: COMMUTER, trend: -0.05,
    promoLift: 1.35, tempCoef: 0.0, holidayLift: 1.0,
  }),
  s("cnd-005", "Ice Cream Novelty", "candy", 0.96, 2.99, 12, 4, 200, {
    base: 16, yearAmp: 0.85, yearPeak: 200, dow: WEEKEND, trend: 0.05,
    promoLift: 1.5, tempCoef: 2.6, holidayLift: 1.1,
  }),

  // --- Beer & Wine --------------------------------------------------------
  s("bwn-001", "Domestic Lager 6-pack", "beer-wine", 6.1, 10.99, 4, 4, null, {
    base: 27, yearAmp: 0.38, yearPeak: 190, dow: WEEKEND, trend: -0.04,
    promoLift: 1.62, tempCoef: 1.2, holidayLift: 1.75,
  }),
  s("bwn-002", "Light Lager 12-pack", "beer-wine", 10.4, 17.99, 2, 4, null, {
    base: 19, yearAmp: 0.4, yearPeak: 190, dow: WEEKEND, trend: -0.02,
    promoLift: 1.7, tempCoef: 1.3, holidayLift: 1.9,
  }),
  s("bwn-003", "Craft IPA 6-pack", "beer-wine", 9.2, 14.99, 4, 5, null, {
    base: 12, yearAmp: 0.3, yearPeak: 188, dow: WEEKEND, trend: 0.1,
    promoLift: 1.55, tempCoef: 0.9, holidayLift: 1.5,
  }),
  s("bwn-004", "Hard Seltzer 6-pack", "beer-wine", 7.4, 12.49, 4, 5, null, {
    base: 15, yearAmp: 0.62, yearPeak: 194, dow: WEEKEND, trend: 0.03,
    promoLift: 1.7, tempCoef: 1.6, holidayLift: 1.6,
  }),
  s("bwn-005", "Table Wine 750 ml", "beer-wine", 6.8, 12.99, 6, 7, null, {
    base: 8, yearAmp: 0.26, yearPeak: 330, dow: FRIDAY, trend: 0.02,
    promoLift: 1.4, tempCoef: -0.2, holidayLift: 2.1,
  }),

  // --- Tobacco & Alternatives --------------------------------------------
  s("tob-001", "Cigarettes Premium Pack", "tobacco", 7.9, 9.79, 10, 3, null, {
    base: 58, yearAmp: 0.07, yearPeak: 190, dow: FLAT, trend: -0.09,
    promoLift: 1.18, tempCoef: 0.1, holidayLift: 1.05,
  }),
  s("tob-002", "Cigarettes Value Pack", "tobacco", 5.8, 7.29, 10, 3, null, {
    base: 41, yearAmp: 0.07, yearPeak: 190, dow: FLAT, trend: -0.06,
    promoLift: 1.2, tempCoef: 0.1, holidayLift: 1.05,
  }),
  s("tob-003", "Nicotine Pouches 15 ct", "tobacco", 3.4, 5.99, 5, 4, null, {
    base: 22, yearAmp: 0.06, yearPeak: 190, dow: FLAT, trend: 0.38,
    promoLift: 1.35, tempCoef: 0.0, holidayLift: 1.0,
  }),
  s("tob-004", "Cigars 2 ct", "tobacco", 1.32, 2.49, 30, 5, null, {
    base: 25, yearAmp: 0.14, yearPeak: 192, dow: WEEKEND, trend: -0.04,
    promoLift: 1.4, tempCoef: 0.3, holidayLift: 1.15,
  }),

  // --- Dairy & Grocery ----------------------------------------------------
  s("gro-001", "Milk 1 Gallon", "dairy-grocery", 2.85, 4.99, 4, 2, 14, {
    base: 21, yearAmp: 0.1, yearPeak: 20, dow: WEEKEND, trend: -0.01,
    promoLift: 1.3, tempCoef: -0.2, holidayLift: 1.4,
  }),
  s("gro-002", "Eggs 1 Dozen", "dairy-grocery", 2.4, 4.49, 12, 2, 21, {
    base: 16, yearAmp: 0.12, yearPeak: 100, dow: WEEKEND, trend: 0.02,
    promoLift: 1.35, tempCoef: -0.1, holidayLift: 1.5,
  }),
  s("gro-003", "Bread Loaf", "dairy-grocery", 1.55, 3.29, 8, 2, 7, {
    base: 14, yearAmp: 0.08, yearPeak: 60, dow: WEEKEND, trend: -0.03,
    promoLift: 1.3, tempCoef: -0.1, holidayLift: 1.45,
  }),
  s("gro-004", "Bagged Ice 10 lb", "dairy-grocery", 1.1, 3.49, 1, 2, null, {
    base: 23, yearAmp: 0.95, yearPeak: 197, dow: WEEKEND, trend: 0.04,
    promoLift: 1.25, tempCoef: 3.1, holidayLift: 1.85,
  }),

  // --- Auto & Non-Food ----------------------------------------------------
  s("aut-001", "Motor Oil 1 qt", "auto-nonfood", 4.3, 8.99, 12, 7, null, {
    base: 7, yearAmp: 0.16, yearPeak: 170, dow: WEEKEND, trend: -0.02,
    promoLift: 1.3, tempCoef: 0.1, holidayLift: 0.8,
  }),
  s("aut-002", "Windshield Washer Fluid", "auto-nonfood", 2.1, 4.49, 6, 7, null, {
    base: 6, yearAmp: 0.78, yearPeak: 10, dow: FLAT, trend: 0.0,
    promoLift: 1.35, tempCoef: -1.4, holidayLift: 0.8,
  }),
  s("aut-003", "Phone Charging Cable", "auto-nonfood", 3.6, 12.99, 6, 10, null, {
    base: 4, yearAmp: 0.1, yearPeak: 190, dow: FLAT, trend: 0.06,
    promoLift: 1.25, tempCoef: 0.0, holidayLift: 0.9,
  }),
  s("aut-004", "Lottery Scratch Ticket", "auto-nonfood", 0.0, 5.0, 1, 1, null, {
    base: 49, yearAmp: 0.09, yearPeak: 350, dow: FRIDAY, trend: 0.03,
    promoLift: 1.1, tempCoef: 0.0, holidayLift: 1.25,
  }),
];

function s(
  id: string,
  name: string,
  category: CategoryId,
  unitCost: number,
  unitPrice: number,
  caseSize: number,
  leadTimeDays: number,
  shelfLifeDays: number | null,
  shape: SkuShape,
): Sku {
  return {
    id,
    name,
    category,
    unitCost,
    unitPrice,
    caseSize,
    leadTimeDays,
    shelfLifeDays,
    shape,
  };
}

export const SKU_BY_ID = new Map(SKUS.map((k) => [k.id, k]));

/* --- Fuel ----------------------------------------------------------------- */

export type FuelGradeId = "reg" | "mid" | "prem" | "diesel";

export type FuelGrade = {
  id: FuelGradeId;
  name: string;
  short: string;
  /** Octane label, or "—" for diesel. */
  octane: string;
  /** Tank working capacity in gallons at the reference store. */
  tankGallons: number;
  /** Fraction of tank considered unusable/reserve. */
  reserveFraction: number;
  /** Mean gallons/day at the reference store. */
  base: number;
  /** Gross margin, $/gal. */
  marginPerGallon: number;
  /** Own-price elasticity of volume (negative). */
  priceElasticity: number;
  shape: Omit<SkuShape, "base" | "promoLift" | "holidayLift"> & {
    holidayLift: number;
  };
};

export const FUEL_GRADES: FuelGrade[] = [
  {
    id: "reg",
    name: "Regular Unleaded",
    short: "Regular",
    octane: "87",
    tankGallons: 12000,
    reserveFraction: 0.08,
    base: 4150,
    marginPerGallon: 0.34,
    priceElasticity: -0.28,
    shape: {
      yearAmp: 0.14, yearPeak: 196, dow: dow(1.02, 0.94, 0.93, 0.95, 1.0, 1.14, 1.06),
      trend: 0.01, tempCoef: 6.5, holidayLift: 1.22,
    },
  },
  {
    id: "mid",
    name: "Midgrade Unleaded",
    short: "Midgrade",
    octane: "89",
    tankGallons: 4000,
    reserveFraction: 0.1,
    base: 420,
    marginPerGallon: 0.41,
    priceElasticity: -0.42,
    shape: {
      yearAmp: 0.16, yearPeak: 196, dow: dow(1.06, 0.92, 0.9, 0.93, 0.99, 1.15, 1.1),
      trend: -0.04, tempCoef: 0.8, holidayLift: 1.28,
    },
  },
  {
    id: "prem",
    name: "Premium Unleaded",
    short: "Premium",
    octane: "93",
    tankGallons: 6000,
    reserveFraction: 0.1,
    base: 610,
    marginPerGallon: 0.58,
    priceElasticity: -0.19,
    shape: {
      yearAmp: 0.2, yearPeak: 192, dow: dow(1.1, 0.9, 0.88, 0.91, 0.98, 1.18, 1.16),
      trend: 0.03, tempCoef: 1.1, holidayLift: 1.3,
    },
  },
  {
    id: "diesel",
    name: "Diesel",
    short: "Diesel",
    octane: "—",
    tankGallons: 10000,
    reserveFraction: 0.08,
    base: 1380,
    marginPerGallon: 0.46,
    priceElasticity: -0.15,
    // Freight-driven: weekday heavy, and it does NOT follow the summer peak.
    shape: {
      yearAmp: 0.09, yearPeak: 60, dow: dow(0.58, 1.19, 1.24, 1.23, 1.2, 1.1, 0.71),
      trend: 0.05, tempCoef: -1.2, holidayLift: 0.62,
    },
  },
];

export const FUEL_BY_ID = new Map(FUEL_GRADES.map((g) => [g.id, g]));

/* --- Observable calendar -------------------------------------------------- */

export type Holiday = {
  /** Month (1-12) and day — these are the fixed-date ones. */
  month: number;
  day: number;
  name: string;
  /** How strongly it moves C-store traffic, 0–1. */
  weight: number;
};

/** Fixed-date holidays. Floating ones are resolved in the generator. */
export const FIXED_HOLIDAYS: Holiday[] = [
  { month: 1, day: 1, name: "New Year's Day", weight: 0.9 },
  { month: 2, day: 14, name: "Valentine's Day", weight: 0.4 },
  { month: 7, day: 4, name: "Independence Day", weight: 1.0 },
  { month: 10, day: 31, name: "Halloween", weight: 0.7 },
  { month: 12, day: 24, name: "Christmas Eve", weight: 0.8 },
  { month: 12, day: 25, name: "Christmas Day", weight: 1.0 },
  { month: 12, day: 31, name: "New Year's Eve", weight: 0.9 },
];

export const CATEGORY_ORDER: CategoryId[] = CATEGORIES.map((c) => c.id);
