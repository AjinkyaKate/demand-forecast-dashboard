/**
 * Shapes shared by the import module and the Data page. Nothing here touches
 * the database, so the browser bundle can import it.
 */

export type SalesField =
  | "date"
  | "item"
  | "units"
  | "store"
  | "itemName"
  | "category"
  | "price"
  | "promo"
  | "discount";

export type DateFormat = "auto" | "ymd" | "dmy" | "mdy";

export type SalesMapping = {
  date: string;
  item: string;
  units: string;
  store?: string | null;
  itemName?: string | null;
  category?: string | null;
  price?: string | null;
  promo?: string | null;
  discount?: string | null;
  dateFormat: DateFormat;
  /** Used when the file has no store column. */
  storeName?: string;
  /** Replace wipes what is on file (demo data included); merge upserts. */
  mode: "replace" | "merge";
};

export const SALES_FIELDS: {
  key: SalesField;
  label: string;
  required: boolean;
  hint: string;
}[] = [
  { key: "date", label: "Date", required: true, hint: "One row per day, or per receipt; receipts are summed to days." },
  { key: "item", label: "Item code", required: true, hint: "SKU, PLU, UPC or product id. Must be the same code every day." },
  { key: "units", label: "Units sold", required: true, hint: "Quantity sold. Returns (negatives) count as zero." },
  { key: "store", label: "Store", required: false, hint: "Store name or code. Leave out for a single store." },
  { key: "itemName", label: "Item name", required: false, hint: "A readable name, if the code column is just a number." },
  { key: "category", label: "Category", required: false, hint: "Department or category, for the category chart and filter." },
  { key: "price", label: "Unit price", required: false, hint: "Selling price that day. Lets the model learn price sensitivity." },
  { key: "promo", label: "On promotion", required: false, hint: "Yes/No, 1/0 or true/false. Lets the model learn promo lift." },
  { key: "discount", label: "Discount", required: false, hint: "Fraction (0.2) or percent (20) off the shelf price." },
];

export type DateDetect = {
  format: "ymd" | "dmy" | "mdy" | "excel" | "text";
  /** True when day and month could be either way round in every sample. */
  ambiguous: boolean;
  example: string;
  label: string;
};

export type Preview = {
  fileName: string;
  delimiter: string;
  columns: string[];
  sample: string[][];
  rowCount: number;
  guess: Partial<Record<SalesField, string>>;
  dateDetect: DateDetect | null;
};

export type Assessment = {
  rowsRead: number;
  rowsKept: number;
  rowsDropped: { badDate: number; badUnits: number; blankItem: number };
  days: number;
  dateFrom: string | null;
  dateTo: string | null;
  stores: { id: string; name: string; rows: number; items: number }[];
  items: number;
  warnings: string[];
};

export type ImportResult = Assessment & { fileName: string; mode: SalesMapping["mode"]; importedAt: string };

export type DataSummary = {
  /** True until the user has imported anything: the stores are the demo set. */
  isDemo: boolean;
  asOf: string | null;
  stores: {
    id: string;
    name: string;
    dateFrom: string | null;
    dateTo: string | null;
    days: number;
    items: number;
    rows: number;
    fuelRows: number;
  }[];
  imports: {
    id: number;
    fileName: string;
    mode: string;
    rows: number;
    stores: number;
    items: number;
    dateFrom: string | null;
    dateTo: string | null;
    importedAt: string;
  }[];
};
