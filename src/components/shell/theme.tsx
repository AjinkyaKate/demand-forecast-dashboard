"use client";

/**
 * Theme provider and toggle.
 *
 * `disableTransitionOnChange` is doing real work here: a theme flip changes
 * colour, background, border and shadow on nearly every element at once, and
 * without suppression every one of those transitions fires together and the
 * switch smears instead of snapping. next-themes injects the
 * `transition:none` override, forces a reflow, and removes it on the next
 * frame — the same recipe, already shipped.
 */

import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" className="size-4">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" className="size-4">
    <path d="M12 3a6.4 6.4 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

/**
 * Both icons stay in the DOM and cross-fade via CSS on the `.dark` class.
 *
 * The motion-library version of this swap needs the resolved theme in React
 * state, which the server cannot know — so it costs either a hydration
 * mismatch or a mount flag that blanks the icon on first paint. Driving it
 * from the class next-themes has already stamped on <html> before hydration
 * sidesteps both. Same values either way: scale 0.25 -> 1, opacity 0 -> 1,
 * blur 4px -> 0, on cubic-bezier(0.2, 0, 0, 1).
 */
const XFADE =
  "transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cn(
        "press icon-btn focus-visible:ring-ring relative size-9",
        "focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      {/* Every state class is written out in full. Tailwind extracts literal
          strings from source, so a class assembled at runtime never ships. */}
      <span className="relative grid size-4 place-items-center">
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 grid place-items-center",
            XFADE,
            "scale-[0.25] opacity-0 blur-[4px]",
            "dark:scale-100 dark:opacity-100 dark:blur-0",
          )}
        >
          <MoonIcon />
        </span>
        {/* The sun is in flow and defines the layout box. */}
        <span
          aria-hidden
          className={cn(
            "grid place-items-center",
            XFADE,
            "scale-100 opacity-100 blur-0",
            "dark:scale-[0.25] dark:opacity-0 dark:blur-[4px]",
          )}
        >
          <SunIcon />
        </span>
      </span>
      <span className="sr-only">Toggle light and dark theme</span>
    </button>
  );
}
