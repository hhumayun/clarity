// How long an area chip takes to filter Life and Notes: demo mode, web build, the samples grown to a
// real account's size (COPIES, default 4), at a phone's pace (THROTTLE, default 4). PROFILE=1 writes a
// CPU profile of Life's first chip tap to /tmp/clarity-revamp-5/filter-life.cpuprofile.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const COPIES = Number(process.env.COPIES || 4);
const THROTTLE = Number(process.env.THROTTLE || 4);

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
const script = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "ScriptDuration").value;
const text = () => page.evaluate(() => document.body.innerText);

await page.goto("http://localhost:8087/?demo", { waitUntil: "load", timeout: 240000 });
await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
const grown = await page.evaluate((n) => {
  for (const [id, mod] of window.__r.getModules()) {
    if (/src\/store\/store\.ts$/.test(mod.verboseName ?? "")) {
      const store = window.__r(id).useStore;
      const { tasks, notes } = store.getState();
      const more = (list) => Array.from({ length: n }, (_, copy) => list.map((item) => ({ ...item, id: copy ? `${item.id}-${copy}` : item.id }))).flat();
      store.setState({ tasks: more(tasks), notes: more(notes) });
      return { tasks: store.getState().tasks.length, notes: store.getState().notes.length };
    }
  }
  return null;
}, COPIES);
console.log(`grown to ${grown.tasks} tasks and ${grown.notes} notes; CPU ${THROTTLE}x slower`);

// One tap, timed in the page from the press itself: until the chip shows the choice, and until the rows
// on screen are right (checked every frame). Then a moment for what follows.
async function tap(label, name, until) {
  const before = await script();
  await page.evaluate(([chip, check]) => {
    const done = new Function(check);
    window.__tap = { pressed: null, chip: null, rows: null };
    document.addEventListener("pointerdown", () => {
      window.__tap.pressed = performance.now();
      const frame = () => {
        const now = performance.now();
        if (window.__tap.chip === null && [...document.querySelectorAll('[aria-selected="true"]')].some((el) => el.innerText.trim() === chip)) window.__tap.chip = now;
        if (window.__tap.rows === null && done()) window.__tap.rows = now;
        if ((window.__tap.chip === null || window.__tap.rows === null) && now - window.__tap.pressed < 60000) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, { capture: true, once: true });
  }, [name, `return (${until.toString()})()`]);
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.waitForFunction(() => window.__tap.chip !== null && window.__tap.rows !== null, null, { timeout: 60000 }).catch(() => {});
  const { pressed, chip, rows } = await page.evaluate(() => window.__tap);
  await page.waitForTimeout(1500);
  const ms = (t) => (t === null ? "never" : `${Math.round(t - pressed)} ms`);
  console.log(`${label}: chip ${ms(chip)}, rows on screen ${ms(rows)}; ${Math.round(((await script()) - before) * 1000)} ms of JavaScript in all`);
}
const life = (title) => `!!document.querySelector('[data-testid="life-list"] [aria-label="Mark ${title} done"]')`;

await page.getByRole("tab", { name: "Life" }).first().click();
// Markers only Life's rows carry: task rows are labelled "Mark … done", and these tasks aren't on Today
// (still mounted under Life), nor are their labels in the Notes tab drawn ahead.
await page.waitForFunction(() => !!document.querySelector('[data-testid="life-list"] [aria-label="Mark Ask Sam about the brackets done"]'), null, { timeout: 120000 });
await page.waitForTimeout(2500);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
if (process.env.PROFILE) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
}
await tap("Life, Work", "Work", new Function(`return !(${life("Walk at lunch, no podcast")}) && ${life("Send the brief to Ana")}`));
if (process.env.PROFILE) {
  const { profile } = await cdp.send("Profiler.stop");
  writeFileSync("/tmp/clarity-revamp-5/filter-life.cpuprofile", JSON.stringify(profile));
}
await tap("Life, Health", "Health", new Function(`return ${life("Walk at lunch, no podcast")} && !(${life("Send the brief to Ana")})`));
await tap("Life, All", "All", new Function(`return ${life("Walk at lunch, no podcast")} && ${life("Send the brief to Ana")}`));

await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
await page.getByRole("tab", { name: "Notes" }).first().click();
await page.waitForFunction(() => !!document.querySelector('[data-testid="notes-list"] [aria-label^="Kitchen shelves, Home"]'), null, { timeout: 120000 });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "Filter by area" }).first().click();
await page.waitForTimeout(1200);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
await tap("Notes, Work", "Work", () => !!!document.querySelector('[data-testid="notes-list"] [aria-label^="Kitchen shelves, Home"]') && !!document.querySelector('[data-testid="notes-list"] [aria-label^="What matters this quarter, Work"]'));
await tap("Notes, All", "All", () => !!document.querySelector('[data-testid="notes-list"] [aria-label^="Kitchen shelves, Home"]'));
await browser.close();
