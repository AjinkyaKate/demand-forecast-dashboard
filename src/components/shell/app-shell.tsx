"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme";
import { useMeta } from "./meta";
import { longDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const MODULES = [
  { href: "/items", label: "Item Forecasting", short: "Items" },
  { href: "/fuel", label: "Fuel Forecasting", short: "Fuel" },
  { href: "/lab", label: "Model Lab", short: "Lab" },
];

function ModuleSwitch() {
  const pathname = usePathname();
  return (
    <nav aria-label="Forecasting modules">
      <ul className="flex items-center gap-1">
        {MODULES.map((m) => {
          const active = pathname === m.href;
          return (
            <li key={m.href}>
              <Link
                href={m.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "press rounded-control block px-3.5 py-2 text-[13px] font-medium",
                  // Navigation is high-frequency: a colour and surface change
                  // at 150ms, no entrance animation, nothing to wait through.
                  "transition-[color,background-color,box-shadow] duration-150",
                  active
                    ? "bg-surface-1 text-ink-primary shadow-[var(--shadow-border)]"
                    : "text-ink-muted hover:text-ink-primary hover:bg-surface-2",
                )}
              >
                <span className="hidden sm:inline">{m.label}</span>
                <span className="sm:hidden">{m.short}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { meta } = useMeta();
  return (
    <div className="bg-plane min-h-dvh">
      {/* The header sits directly on the plane — no bar, no rule. Separation
          comes from the white pill of the active item and the cards below. */}
      <header className="bg-plane/80 sticky top-0 z-30 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-4 sm:px-6">
          <Link href="/items" className="press flex items-center gap-2.5">
            <span
              aria-hidden
              className="bg-ink-primary grid size-9 place-items-center rounded-[11px]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--surface-1)"
                strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"
                className="size-[18px]">
                <path d="M3 17l5-6 4 3 6-8" />
              </svg>
            </span>
            <span className="leading-tight">
              <span className="text-ink-primary block text-[15px] font-semibold">
                Demand Forecast
              </span>
              <span className="text-ink-muted block text-[11px]">
                C-store &amp; retail
              </span>
            </span>
          </Link>

          <ModuleSwitch />

          <div className="ml-auto flex items-center gap-2.5">
            {meta ? (
              <p className="text-ink-muted hidden text-xs md:block">
                Data as of{" "}
                <span className="text-ink-secondary tabular font-medium">
                  {longDate(meta.asOf)}
                </span>
              </p>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pt-1 pb-10 sm:px-6">
        {children}
      </main>
    </div>
  );
}
