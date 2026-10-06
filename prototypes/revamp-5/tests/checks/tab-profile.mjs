// How long switching tabs takes in Sage's web build, demo mode, with the samples
// grown to about the size of a real account (≈90 notes, ≈80 tasks), Chrome slowed
// to a phone's pace (4x). For each switch: the JavaScript time it cost (CDP
// ScriptDuration) and how long until the new tab's own content was on screen.
// Optional: PROFILE=1 writes a CPU profile of the first Today -> Notes switch.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const BASE = process.env.BASE || "http://localhost:8087";
const LABEL = process.env.LABEL || "now";

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");

await page.goto(`${BASE}/?demo`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => /Today/.test(document.body.innerText), null, { timeout: 60000 });
await page.waitForTimeout(2500);

// Grow the samples in place: the sample store, found in the dev bundle's modules.
const grown = await page.evaluate(({ noteCopies, taskCopies }) => {
  const modules = window.__r?.getModules?.();
  if (!modules) return "no module registry";
  let store = null;
  for (const [id, mod] of modules) {
    if (/src\/store\/store\.ts$/.test(mod.verboseName ?? "")) store = window.__r(id).useStore;
  }
  if (!store) return "store not found";
  const state = store.getState();
  const notes = [];
  for (let copy = 0; copy < noteCopies; copy++) for (const note of state.notes) notes.push({ ...note, id: `${note.id}-${copy}` });
  const tasks = [];
  for (let copy = 0; copy < taskCopies; copy++) for (const task of state.tasks) tasks.push({ ...task, id: `${task.id}-${copy}` });
  store.setState({ notes, tasks });
  return `notes ${notes.length}, tasks ${tasks.length}`;
}, { noteCopies: Number(process.env.NOTE_COPIES || 11), taskCopies: Number(process.env.TASK_COPIES || 4) });
console.log(`[${LABEL}] samples grown: ${grown}`);
await page.waitForTimeout(3000);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE || 4) });

const script = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "ScriptDuration").value;
const results = [];
async function go(tab, marker, note) {
  const before = await script();
  const started = Date.now();
  await page.getByRole("tab", { name: tab }).first().click({ timeout: 180000 });
  // The new tab's own content on screen.
  await page.waitForFunction((text) => {
    const visible = [...document.querySelectorAll("div")].some((el) => el.childElementCount === 0 && el.textContent === text && el.getBoundingClientRect().width > 0 && el.offsetParent !== null);
    return visible;
  }, marker, { timeout: 180000, polling: 50 }).catch(() => {});
  const shown = Date.now() - started;
  await page.waitForTimeout(2500);
  const scriptMs = Math.round(((await script()) - before) * 1000);
  results.push({ switch: `${note}`, shownMs: shown, scriptMs });
  console.log(`[${LABEL}] ${note}: on screen after ${shown} ms, ${scriptMs} ms of JavaScript`);
}

await go("Notes", "Notes", "Today -> Notes (first)");
if (process.env.PROFILE) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  // A fixed window, whether or not Life has finished drawing.
  await page.getByRole("tab", { name: "Life" }).first().click({ timeout: 60000, noWaitAfter: true }).catch(() => {});
  await page.waitForTimeout(Number(process.env.WINDOW_MS || 30000));
} else await go("Life", "Life Center", "Notes -> Life (first)");
if (process.env.PROFILE) {
  const { profile } = await cdp.send("Profiler.stop");
  writeFileSync(`/tmp/clarity-revamp-5/tab-profile-${LABEL}.cpuprofile`, JSON.stringify(profile));
  console.log("profile written"); process.exit(0);
}
await go("Today", "Tasks", "Life -> Today (again)");
await go("Notes", "Notes", "Today -> Notes (again)");
await go("Life", "Life Center", "Notes -> Life (again)");

// A change while on Life: how much do the tabs out of sight do?
const beforeChange = await script();
await page.evaluate(() => {
  for (const [id, mod] of window.__r.getModules()) {
    if (/src\/store\/store\.ts$/.test(mod.verboseName ?? "")) {
      const store = window.__r(id).useStore;
      const [first] = store.getState().notes;
      store.getState().writeNote({ id: first.id, title: first.title, typedTitle: first.title, markdown: "Changed", excerpt: "Changed", blocks: [{ kind: "p", text: "Changed" }], words: 1, area: first.area });
    }
  }
});
await page.waitForTimeout(2500);
results.push({ switch: "one note changed, seen from Life", shownMs: null, scriptMs: Math.round(((await script()) - beforeChange) * 1000) });

console.table(results);
if (errors.length) console.log("page errors:", errors.slice(0, 3));
await browser.close();
