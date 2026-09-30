import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/shell/theme";
import { AppShell } from "@/components/shell/app-shell";
import { FiltersProvider } from "@/components/workspace/filters";
import { MetaProvider } from "@/components/shell/meta";

export const metadata: Metadata = {
  title: "Demand Forecast · C-store & Retail",
  description:
    "Item and fuel demand forecasting for convenience-store and retail operators: historical demand, predicted demand, drivers, anomalies and replenishment decisions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning is required by next-themes: it stamps the
    // resolved theme class onto <html> before React hydrates.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <MetaProvider>
            <FiltersProvider>
              <AppShell>{children}</AppShell>
            </FiltersProvider>
          </MetaProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
