import type { Metadata } from "next";
import { DataWorkspace } from "@/components/workspace/data-workspace";

export const metadata: Metadata = {
  title: "Your data · Demand Forecast",
  description:
    "Add your own sales history from a POS export and see the forecast run on it.",
};

export default function DataPage() {
  return <DataWorkspace />;
}
