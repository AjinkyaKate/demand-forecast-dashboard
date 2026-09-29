import type { Metadata } from "next";
import { ModelLab } from "@/components/workspace/model-lab";

export const metadata: Metadata = {
  title: "Model Lab · Demand Forecast",
  description:
    "How much each input (calendar, promotions, holidays, weather, events) changes forecast accuracy, measured on the same backtest.",
};

export default function LabPage() {
  return <ModelLab />;
}
