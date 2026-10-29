/**
 * Runs once when the server starts: opens the database, and on a host with a
 * long-running process starts the automatic sync of external data (weather,
 * holidays, alerts, events). Serverless hosts have no such process, so there
 * the POST /api/sync/* routes do that work from a cron job instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureDb } = await import("./lib/db");
  await ensureDb();
  if (process.env.VERCEL) return;
  const { startAutoSync } = await import("./lib/sync/auto");
  startAutoSync();
}
