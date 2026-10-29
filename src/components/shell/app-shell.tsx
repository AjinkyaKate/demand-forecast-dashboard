"use client";

/**
 * The app shell: a sidebar that folds down to its icons beside the page,
 * built from the Nexvyn sidebar primitives and nav menu.
 *
 * Desktop: the sidebar is fixed and clips between 16rem and a 3.5rem icon
 * rail (clip-path only, so nothing reflows while it moves). The nav labels
 * stay in the DOM when folded, clipped out of sight, so screen readers and
 * keyboard users keep the full names. Below the medium breakpoint the same
 * panel becomes a sheet opened from the top bar: focus moves in and is
 * trapped, Escape or the backdrop closes it, focus returns to the button.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Database,
  FlaskConical,
  Fuel,
  PanelLeftClose,
  PanelLeftOpen,
  ShoppingBasket,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NavMenu, NavMenuItem } from "@/components/ui/nav-menu";
import {
  SIDEBAR_CLIP,
  SIDEBAR_CLIP_OPEN,
  SIDEBAR_CLIP_RAIL,
  SIDEBAR_FOCUS,
  SidebarCloseButton,
  SidebarIconButton,
  SidebarMenuButton,
  SidebarSheet,
  SidebarTopbar,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { useExternalStatus } from "@/lib/hooks/use-workspace";
import { isSoundMuted, setSoundMuted, subscribeSoundMuted } from "@/lib/sound";
import { longDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme";
import { useMeta } from "./meta";

const MODULES = [
  { href: "/items", label: "Item Forecasting", icon: ShoppingBasket },
  { href: "/fuel", label: "Fuel Forecasting", icon: Fuel },
  { href: "/lab", label: "Model Lab", icon: FlaskConical },
  { href: "/data", label: "Your data", icon: Database },
];

const SWAP =
  "absolute inset-0 flex items-center justify-center transition-[opacity,scale,filter] duration-(--motion-dur-base) ease-(--motion-ease-in-out) motion-reduce:transition-none";

/**
 * The mark: three bars of history rising into a dotted forecast line, on an
 * indigo tile. The one place the accent colour sits at rest.
 */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid size-7 shrink-0 place-items-center rounded-md", className)}
      style={{
        background: "linear-gradient(135deg, var(--series-1) 0%, var(--seq-700) 100%)",
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.18)",
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[18px]">
        <rect x="4" y="13" width="3" height="7" rx="1" fill="#fff" fillOpacity="0.55" />
        <rect x="9" y="9.5" width="3" height="10.5" rx="1" fill="#fff" fillOpacity="0.75" />
        <rect x="14" y="6" width="3" height="14" rx="1" fill="#fff" />
        <path d="M18.5 7.5 20.5 5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.1 2.4" />
        <circle cx="21" cy="4.5" r="1.6" fill="#fff" />
      </svg>
    </span>
  );
}

function Brand({ compact, inert }: { compact: boolean; inert?: boolean }) {
  return (
    <Link
      href="/items"
      inert={inert}
      className={cn("flex h-10 items-center gap-2.5 rounded-md px-1.5", SIDEBAR_FOCUS)}
    >
      <BrandMark />
      <span
        className={cn(
          "text-ink-primary text-sm whitespace-nowrap transition-opacity duration-(--motion-dur-fast) ease motion-reduce:transition-none",
          compact && "opacity-0",
        )}
      >
        Demand Forecast
      </span>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Sidebar footer pieces                                                      */
/* -------------------------------------------------------------------------- */

/** How many external sources are live, as a pill that jumps to the panel. */
function SourcesBadge({ compact }: { compact: boolean }) {
  const { data } = useExternalStatus(0);
  if (!data?.sources.length) return null;
  const ok = data.sources.filter((s) => s.status === "ok").length;
  const total = data.sources.length;
  const allGood = ok === total;
  const color = allGood ? "var(--status-good)" : "var(--status-warning)";
  return (
    <Badge
      asChild
      size="sm"
      className={cn("gap-1.5 self-start", compact ? "w-10 justify-center px-0" : "ms-1")}
    >
      <Link href="/items#data-sources" title={`${ok} of ${total} data sources connected`}>
        <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className={cn("text-ink-secondary tabular", compact && "sr-only")}>
          {ok}/{total} sources live
        </span>
      </Link>
    </Badge>
  );
}

function SoundSwitch({ compact }: { compact: boolean }) {
  const enabled = useSyncExternalStore(
    subscribeSoundMuted,
    () => !isSoundMuted(),
    () => false,
  );
  return (
    <Switch
      checked={enabled}
      onCheckedChange={(v) => setSoundMuted(!v)}
      label="Interaction sounds"
      className="h-10 px-1"
      labelClassName={cn("text-ink-muted text-xs", compact && "sr-only")}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { meta } = useMeta();
  const id = useId();
  const asideId = `${id}-aside`;
  const sheetId = `${id}-sheet`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const [expanded, setExpanded] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Folding moves focus between the two fold buttons so a keyboard user is
  // never left on a button that just became inert.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (expanded ? collapseRef : expandRef).current?.focus();
  }, [expanded]);

  const toggle = () => {
    moveFocus.current = true;
    setExpanded((v) => !v);
  };

  const panel = (inSheet: boolean) => {
    const compact = !inSheet && !expanded;
    return (
      <>
        <div className="relative flex h-14 shrink-0 items-center gap-1 px-2">
          <Brand compact={compact} inert={compact} />
          {inSheet ? (
            <SidebarCloseButton label="Close navigation" onClose={() => setSheetOpen(false)} />
          ) : (
            <>
              {/* Folded, the mark itself becomes the expand button on hover. */}
              <button
                ref={expandRef}
                type="button"
                aria-label="Expand sidebar"
                aria-expanded={false}
                aria-controls={asideId}
                inert={!compact}
                onClick={toggle}
                className={cn(
                  "group/expand absolute start-2 top-2 flex size-10 items-center justify-center rounded-md",
                  SIDEBAR_FOCUS,
                  !compact && "invisible",
                )}
              >
                <span aria-hidden className="relative size-7">
                  <span
                    className={cn(
                      SWAP,
                      "group-hover/expand:scale-90 group-hover/expand:opacity-0 group-hover/expand:blur-[2px] group-focus-visible/expand:scale-90 group-focus-visible/expand:opacity-0 group-focus-visible/expand:blur-[2px]",
                    )}
                  >
                    <BrandMark />
                  </span>
                  <span
                    className={cn(
                      SWAP,
                      "text-ink-primary scale-90 opacity-0 blur-[2px] group-hover/expand:scale-100 group-hover/expand:opacity-100 group-hover/expand:blur-none group-focus-visible/expand:scale-100 group-focus-visible/expand:opacity-100 group-focus-visible/expand:blur-none",
                    )}
                  >
                    <PanelLeftOpen className="size-[18px]" strokeWidth={1.5} />
                  </span>
                </span>
              </button>
              <SidebarIconButton
                ref={collapseRef}
                label="Collapse sidebar"
                aria-expanded
                aria-controls={asideId}
                inert={compact}
                onClick={toggle}
                className="ms-auto"
              >
                <PanelLeftClose className="size-[18px]" strokeWidth={1.5} />
              </SidebarIconButton>
            </>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-2 pt-1">
          {/* Folded, the menu narrows to the icon column and the labels go
              screen-reader-only, so the rail shows icons and keyboard users
              and assistive tech keep the full names. */}
          <NavMenu
            activeSlug={pathname}
            aria-label="Forecasting modules"
            className={cn(
              compact
                ? "w-10 [&_[data-nav-item]>span:last-child]:sr-only"
                : "w-full",
            )}
          >
            {MODULES.map((m) => (
              <NavMenuItem
                key={m.href}
                href={m.href}
                label={m.label}
                icon={<m.icon strokeWidth={1.5} />}
                asChild
                className="min-h-10 whitespace-nowrap"
              >
                <Link href={m.href} onClick={() => inSheet && setSheetOpen(false)} />
              </NavMenuItem>
            ))}
          </NavMenu>
        </div>

        <div className="border-hairline flex flex-col gap-1 border-t p-2">
          <SourcesBadge compact={compact} />
          <div className="flex h-10 items-center gap-2">
            <ThemeToggle />
            <span className={cn("text-ink-muted text-xs whitespace-nowrap", compact && "sr-only")}>
              Light / dark
            </span>
          </div>
          <SoundSwitch compact={compact} />
          {meta && meta.stores.length > 0 ? (
            <p className={cn("text-ink-muted px-1 pt-1 pb-1 text-[11px] whitespace-nowrap", compact && "sr-only")}>
              Data as of{" "}
              <span className="text-ink-secondary tabular">{longDate(meta.asOf)}</span>
            </p>
          ) : null}
        </div>
      </>
    );
  };

  return (
    <div className="bg-plane relative flex min-h-dvh">
      {/* Spacer that keeps the page clear of the fixed aside. It snaps; the
          aside's clip-path is what animates. */}
      <div aria-hidden className={cn("hidden shrink-0 md:block", expanded ? "w-64" : "w-14")} />

      <aside
        id={asideId}
        aria-label="Sidebar"
        className={cn(
          "bg-plane fixed inset-y-0 start-0 z-20 hidden w-64 flex-col md:flex",
          SIDEBAR_CLIP,
          expanded ? SIDEBAR_CLIP_OPEN : SIDEBAR_CLIP_RAIL,
        )}
      >
        {panel(false)}
      </aside>

      <div className="border-hairline flex min-w-0 flex-1 flex-col md:border-s">
        <SidebarTopbar className="bg-plane/80 border-hairline sticky top-0 z-10 backdrop-blur-md md:hidden">
          <SidebarMenuButton
            ref={triggerRef}
            open={sheetOpen}
            controls={sheetId}
            label="Open navigation"
            onOpen={() => setSheetOpen(true)}
          />
          <Brand compact={false} />
          <div className="ms-auto">
            <ThemeToggle />
          </div>
        </SidebarTopbar>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
          {children}
        </main>
      </div>

      <div className={cn("fixed inset-0 z-40 md:hidden", !sheetOpen && "pointer-events-none")}>
        <SidebarSheet
          id={sheetId}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          triggerRef={triggerRef}
          label="Navigation"
        >
          {panel(true)}
        </SidebarSheet>
      </div>
    </div>
  );
}
