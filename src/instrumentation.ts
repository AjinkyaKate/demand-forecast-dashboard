/**
 * Runs once when the Next.js server starts. Starts the automatic sync of
 * external data (weather, holidays, alerts, events) — Node runtime only, since
 * it writes to SQLite.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAutoSync } = await import("./lib/sync/auto");
    startAutoSync();
  }
}
