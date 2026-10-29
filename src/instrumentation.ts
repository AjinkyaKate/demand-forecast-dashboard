/**
 * Runs once when the Next.js server starts. Starts the automatic sync of
 * external data (weather, holidays, alerts, events) — Node runtime only, since
 * it writes to SQLite.
 */
export async function register() {
  // Serverless hosts have no long-running process to hold a schedule; the
  // POST /api/sync/* routes do the same work from a cron job there.
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.VERCEL) {
    const { startAutoSync } = await import("./lib/sync/auto");
    startAutoSync();
  }
}
