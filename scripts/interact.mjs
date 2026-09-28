import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });

const ok = (label, cond) => console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);

await p.goto("http://localhost:3000/items", { waitUntil: "networkidle" });
await p.waitForTimeout(1000);

console.log("HOVER / CROSSHAIR");
const fig = p.locator("figure").filter({ hasText: "Demand — actual vs forecast" }).first();
const svg = fig.locator("svg[role=img]").first();
const box = await svg.boundingBox();
await p.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
await p.waitForTimeout(250);
const tip = fig.locator('[role=status]');
ok("tooltip appears on hover", await tip.isVisible());
const tipText = await tip.innerText();
ok("tooltip names a weekday + date", /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),/.test(tipText));
ok("tooltip carries a value", /[\d,.]+K?/.test(tipText));

console.log("\nKEYBOARD");
await p.mouse.move(0, 0);
await p.waitForTimeout(200);
await svg.focus();
await p.keyboard.press("End");
await p.waitForTimeout(200);
const kb1 = await tip.isVisible();
ok("focus + End shows the same readout as hover", kb1);
const t1 = await tip.innerText();
await p.keyboard.press("ArrowLeft");
await p.keyboard.press("ArrowLeft");
await p.waitForTimeout(200);
const t2 = await tip.innerText();
ok("arrow keys move the cursor", t1 !== t2);
await p.keyboard.press("Escape");
await p.waitForTimeout(200);
ok("Escape dismisses", !(await tip.isVisible()));

console.log("\nTABLE TWIN");
const toggle = fig.getByRole("button", { name: /data table/i });
await toggle.click();
await p.waitForTimeout(400);
const tbl = fig.locator("table");
ok("table view renders", await tbl.isVisible());
const rows = await tbl.locator("tbody tr").count();
ok(`table has rows (${rows})`, rows > 100);
const hdrs = await tbl.locator("thead th").allInnerTexts();
ok(`headers: ${hdrs.join(" | ")}`, hdrs.includes("Forecast") && hdrs.includes("80% interval"));
await fig.getByRole("button", { name: /show chart/i }).click();
await p.waitForTimeout(300);
ok("toggles back to chart", await svg.isVisible());

console.log("\nFILTERS SCOPE EVERYTHING");
const before = await p.locator("section").first().innerText();
await p.getByRole("combobox").nth(1).click();   // Forecast horizon
await p.waitForTimeout(250);
await p.getByRole("option", { name: "Next 30 days" }).click();
await p.waitForTimeout(900);
const after = await p.locator("section").first().innerText();
ok("horizon change updates the headline figures", before !== after);
ok("header reflects new horizon", (await p.locator("body").innerText()).includes("next 30 days"));
const heroTxt = await p.locator("text=Forecast demand · next 30 days").first().isVisible();
ok("hero label updated", heroTxt);

console.log("\nSTORE SWITCH");
await p.getByRole("combobox").nth(2).click();
await p.waitForTimeout(250);
await p.getByRole("option", { name: /Midtown/ }).click();
await p.waitForTimeout(1500);
ok("store switch recomputes without error", errs.length === 0);
ok("store name shown in trigger", (await p.getByRole("combobox").nth(2).innerText()).includes("Midtown"));

console.log("\nSORTING");
await p.goto("http://localhost:3000/items", { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const plan = p.locator("section").filter({ hasText: "Replenishment plan" }).first();
const firstBefore = await plan.locator("tbody tr").first().innerText();
await plan.getByRole("button", { name: /^Cost/ }).click();
await p.waitForTimeout(300);
const firstAfter = await plan.locator("tbody tr").first().innerText();
ok("sorting the plan table reorders rows", firstBefore !== firstAfter);

console.log(errs.length ? `\nERRORS:\n${errs.join("\n")}` : "\nno console/page errors");
await b.close();
