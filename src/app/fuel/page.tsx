import type { Metadata } from "next";
import { FuelWorkspace } from "@/components/workspace/fuel-workspace";

export const metadata: Metadata = {
  title: "Fuel Forecasting · Demand Forecast",
  description:
    "Forecast demand by fuel grade, with price drivers, anomalies and a tank delivery plan.",
};

export default function FuelPage() {
  return <FuelWorkspace />;
}
