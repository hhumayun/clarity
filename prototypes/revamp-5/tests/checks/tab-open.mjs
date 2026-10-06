// Do Today, Notes and Life always open? Demo mode, web build: many tab switches, in random orders and at random
// speeds (some interrupting the 200 ms fade), some during the first seconds while tabs are being drawn ahead.
// After each settled tap: the tab chosen in the bar is the one tapped, and its page is the one shown, fully
// visible. ROUNDS (default 6) sequences of 25 taps. SEED makes a run repeatable.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const BASE = process.env.BASE || "http://localhost:8087";
const ROUNDS = Number(process.env.ROUNDS || 6);
let seed = Number(process.env.SEED || 7);
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (list) => list[Math.floor(random() * list.length)];
const TABS = { Today: "today", Notes: "notes-list", Life: "life-list" };
const GAPS = [60, 120, 250, 500, 1000];

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const errors = [];
let problems = 0;
let checked = 0;

// What the bar says is chosen, and how visible each page is.
const look = (page) =>
  page.evaluate((tabs) => {
    const chosen = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((el) => el.getAttribute("aria-label"));
    const pages = {};
    for (const [label, id] of Object.entries(tabs)) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) {
        pages[label] = { there: false, opacity: 0 };
        continue;
      }
      let opacity = 1;
      let hidden = false;
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        opacity *= Number(style.opacity);
        if (style.display === "none" || style.visibility === "hidden") hidden = true;
      }
      const box = el.getBoundingClientRect();
      pages[label] = { there: true, opacity: hidden ? 0 : Math.round(opacity * 100) / 100, onScreen: box.width > 0 && box.x > -5 && box.x < 50 };
    }
    // Which page is actually on top, where the lists are (pages behind may be drawn, but covered).
    const ids = Object.fromEntries(Object.entries(tabs).map(([label, id]) => [id, label]));
    const onTop = [450, 600].map((y) => {
      for (let node = document.elementFromPoint(196, y); node; node = node.parentElement) {
        const id = node.getAttribute && node.getAttribute("data-testid");
        if (id && ids[id]) return ids[id];
      }
      return null;
    });
    const veil = document.querySelector('[data-testid="tab-veil"]');
    return { chosen, pages, onTop, veil: veil ? Number(getComputedStyle(veil).opacity) : 0 };
  }, TABS);

for (let round = 0; round < ROUNDS; round++) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/?demo`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
  // Odd rounds start tapping at once (tabs still being drawn ahead); even ones once that's done.
  await page.waitForTimeout(round % 2 ? 200 : 5000);
  let last = "Today";
  const log = [];
  for (let n = 0; n < 25; n++) {
    const target = pick(Object.keys(TABS));
    const gap = pick(GAPS);
    await page.getByRole("tab", { name: target, exact: true }).first().click({ timeout: 10000 });
    last = target;
    log.push(`${target}+${gap}`);
    await page.waitForTimeout(gap);
    if (gap >= 500) {
      // Settled: the bar and the page agree, and the page is fully there.
      await page.waitForTimeout(300);
      const state = await look(page);
      checked++;
      const shown = state.pages[last];
      const others = state.onTop.filter((label) => label !== last);
      const ok = state.chosen.length === 1 && state.chosen[0] === last && shown.there && shown.opacity > 0.99 && shown.onScreen && others.length === 0 && state.veil < 0.01;
      if (!ok) {
        problems++;
        console.log(`round ${round + 1}, tap ${n + 1}: tapped ${last}; bar shows ${JSON.stringify(state.chosen)}; pages ${JSON.stringify(state.pages)}; on top ${JSON.stringify(state.onTop)}; veil ${state.veil}`);
        console.log(`  taps: ${log.join(" ")}`);
        await page.screenshot({ path: `/tmp/clarity-revamp-5/tab-open-${round + 1}-${n + 1}.png` });
      }
    }
  }
  await context.close();
}
await browser.close();
console.log(`${checked} settled checks, ${problems} problems, ${errors.length} page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
process.exit(problems || errors.length ? 1 : 0);
