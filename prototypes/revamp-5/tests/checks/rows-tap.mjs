// Ticks the first task in each round-3 look with a real tap (2026-10-08): it fills, the words
// strike, and it settles (moves to Done, or stays ticked where the look keeps finished tasks).
// Frames mid-tick and after into OUT; reports console errors.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const BASE = process.env.BASE || "http://localhost:8087";
const OUT = process.env.OUT || "/root/projects/uximprove/tasks/round3/tap";
const LOOKS = (process.env.LOOKS || "frontpage,fills,sky,lamplight").split(",");
mkdirSync(OUT, { recursive: true });
let failed = 0;
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
for (const look of LOOKS) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/?demo&rows=${look}${/frontpage|lamplight/.test(look) ? "&focusline=short" : ""}`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => /Tasks|This (morning|afternoon|evening)|Tonight|Later today|Add task/.test(document.body.innerText), null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  // The first open one-off task (a repeat moves to its next day instead of ticking).
  const title = await page.evaluate(() => {
    for (const [id, mod] of window.__r.getModules()) {
      if (!/src\/store\/store\.ts$/.test(mod.verboseName ?? "")) continue;
      const { tasks } = window.__r(id).useStore.getState();
      const labels = [...document.querySelectorAll('[aria-label^="Mark "][aria-label$=" done"]')].map((el) => el.getAttribute("aria-label")).filter((l) => !/ not done$/.test(l));
      return labels.map((l) => l.replace(/^Mark /, "").replace(/ done$/, "")).find((t) => tasks.some((x) => x.title === t && !x.repeat && !x.done));
    }
  });
  const check = page.locator(`[aria-label="Mark ${title} done"]`).first();
  await check.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await check.tap();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${look}-mid.png` });
  await page.waitForTimeout(3600);
  await page.screenshot({ path: `${OUT}/${look}-after.png` });
  const state = await page.evaluate((t) => {
    for (const [id, mod] of window.__r.getModules()) {
      if (!/src\/store\/store\.ts$/.test(mod.verboseName ?? "")) continue;
      const task = window.__r(id).useStore.getState().tasks.find((x) => x.title === t);
      return task ? { done: task.done } : null;
    }
  }, title);
  const stillOpen = await page.locator(`[aria-label="Mark ${title} done"]`).count();
  const ok = state?.done === true && stillOpen === 0;
  if (!ok) failed++;
  console.log(`${look}: tapped "${title}" -> store ${JSON.stringify(state)}, open checks left ${stillOpen}, errors ${errors.length}${errors.length ? " " + errors.slice(0, 2).join(" | ") : ""} ${ok ? "OK" : "FAIL"}`);
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
