import type { Metadata } from "next";
import { ItemWorkspace } from "@/components/workspace/item-workspace";

export const metadata: Metadata = {
  title: "Item Forecasting · Demand Forecast",
  description:
    "Forecast demand for products and SKUs sold in the store, with drivers, anomalies and a replenishment plan.",
};

export default function ItemsPage() {
  return <ItemWorkspace />;
}
