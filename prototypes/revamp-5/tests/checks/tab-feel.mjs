// Tab switches after the app has had a quiet moment (demo mode): the other tabs are drawn
// ahead (preloaded), so even a first visit should be quick, and the incoming page fades in.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:8087/?demo", { waitUntil: "load", timeout: 240000 });
await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
// The quiet moment: the other places are drawn ahead.
await page.waitForTimeout(8000);
ok("the other tabs were drawn ahead", await page.evaluate(() => document.body.innerText.includes("Life Center") || [...document.querySelectorAll("div")].some((d) => d.textContent === "Life Center")));
for (const [tab, marker] of [["Notes", "Slow morning"], ["Life", "Book the dentist"], ["Search", "Find anything you wrote"], ["Today", "Walk at lunch, no podcast"]]) {
  const t = Date.now();
  await page.getByRole("tab", { name: tab }).first().click();
  // While it switches: the lowest opacity seen on the incoming page's containers.
  const lowest = await page.evaluate(async (m) => {
    let min = 1;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const holder = [...document.querySelectorAll("div")].find((d) => d.childElementCount === 0 && d.textContent === m && d.getBoundingClientRect().width > 0);
      for (let el = holder; el; el = el.parentElement) min = Math.min(min, Number(getComputedStyle(el).opacity));
    }
    return min;
  }, marker);
  // On screen: some copy of the marker with every container around it fully shown.
  await page.waitForFunction((m) => [...document.querySelectorAll("div")].some((d) => {
    if (d.childElementCount !== 0 || d.textContent !== m || d.getBoundingClientRect().width === 0) return false;
    for (let el = d; el; el = el.parentElement) if (Number(getComputedStyle(el).opacity) < 0.99) return false;
    return true;
  }), marker, { timeout: 30000 }).catch(async () => {
    console.log("  copies of", JSON.stringify(marker), await page.evaluate((m) => [...document.querySelectorAll("div")].filter((d) => d.textContent === m).map((d) => `${d.childElementCount} children, width ${Math.round(d.getBoundingClientRect().width)}`).slice(0, 6).join("; "), marker));
  });
  const took = Date.now() - t;
  ok(`${tab}: on screen in ${took} ms, fading in (lowest opacity ${lowest.toFixed(2)})`, took < 1500 && lowest < 1);
}
ok("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
