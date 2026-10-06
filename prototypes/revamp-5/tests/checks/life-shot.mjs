// Life in light and dark (demo mode), to see the task slices read as whole cards.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const OUT = "/root/projects/clarity-design-research/revamp-5/shots/perf";
require("fs").mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
for (const scheme of ["light", "dark"]) {
  const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true })).newPage();
  await page.goto("http://localhost:8087/?demo", { waitUntil: "load", timeout: 240000 });
  await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
  await page.getByRole("tab", { name: "Life" }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes("Book the dentist"), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/life-${scheme}.png` });
  console.log("saved", `${OUT}/life-${scheme}.png`);
}
await browser.close();
