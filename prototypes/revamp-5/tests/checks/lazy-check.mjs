// Does opening a tab for the first time fetch code (lazy routes)? Lists the requests made during each first switch.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true })).newPage();
let requests = [];
page.on("request", (r) => requests.push(r.url().replace("http://localhost:8087", "").slice(0, 110)));
await page.goto("http://localhost:8087/?demo", { waitUntil: "load", timeout: 240000 });
await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
await page.waitForTimeout(2000);
for (const [tab, marker] of [["Notes", "Slow morning"], ["Life", "Life Center"], ["Search", "Search"]]) {
  requests = [];
  const t = Date.now();
  await page.getByRole("tab", { name: tab }).first().click({ timeout: 60000 });
  await page.waitForFunction((m) => document.body.innerText.includes(m), marker, { timeout: 60000 });
  console.log(`${tab}: ${Date.now() - t} ms; requests: ${requests.filter((u) => !u.startsWith("data:")).join(" | ") || "none"}`);
}
await browser.close();
