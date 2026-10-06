// Quick: does the web build open, and do Today, Notes and Life show (demo mode)?
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
const t0 = Date.now();
await page.goto("http://localhost:8087/?demo", { waitUntil: "load", timeout: 240000 });
await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
console.log("Today shown after", Date.now() - t0, "ms");
await page.waitForTimeout(1500);
await page.screenshot({ path: "/root/projects/clarity-design-research/revamp-5/shots/editor/smoke.png" });
console.log("tabs:", await page.getByRole("tab").count(), "| text:", (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 300));
console.log("errors so far:", errors.slice(0, 4));
for (const [tab, marker] of [["Notes", "Slow morning"], ["Life", "Life Center"], ["Today", "Tasks"], ["Notes", "Slow morning"]]) {
  const t = Date.now();
  await page.getByRole("tab", { name: tab }).first().click({ timeout: 60000 });
  await page.waitForFunction((m) => document.body.innerText.includes(m), marker, { timeout: 60000 });
  console.log(`${tab}: shown after ${Date.now() - t} ms`);
}
console.log("errors:", errors.slice(0, 4));
await browser.close();
