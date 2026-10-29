import { chromium } from "playwright";
// Point at another port with BASE_URL=http://localhost:3001 when 3000 is taken.
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [];

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${theme}] console: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${theme}] pageerror: ${e.message}`));

  for (const route of ["items", "fuel"]) {
    await page.goto(`${BASE}/${route}`, { waitUntil: "networkidle" });
    // Let the staged entrance finish before capturing.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${route}-${theme}.png`, fullPage: true });
    console.log(`${route}-${theme}.png`);
  }
  await ctx.close();
}

// Mobile check on the default theme.
const m = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const mp = await m.newPage();
await mp.goto(`${BASE}/items`, { waitUntil: "networkidle" });
await mp.waitForTimeout(1200);
// The page body must never scroll horizontally.
const overflow = await mp.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
await mp.screenshot({ path: `${OUT}/items-mobile.png`, fullPage: true });
console.log("items-mobile.png", JSON.stringify(overflow));
await m.close();

await browser.close();
console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno console/page errors");
