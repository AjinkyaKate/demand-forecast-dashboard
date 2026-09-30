export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDb } = await import("./lib/db");
    await ensureDb();

    try {
      const { startAutoSync } = await import("./lib/sync/auto");
      startAutoSync();
    } catch {}
  }
}
