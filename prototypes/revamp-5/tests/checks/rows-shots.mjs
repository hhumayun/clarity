// Screenshots of Today's task rows in each look (src/ui/rowLook.ts), light and dark, for the user to
// choose from (2026-10-07). Demo mode with eight tasks today (four added, like a real day), so the
// calmer looks fold after five. Each look: the first screen, and the list scrolled into view.
// Writes PNGs to OUT (default /root/projects/uximprove/tasks/round2); never commit them with research.
// LOOKS, SCHEMES (light,dark), EXTRA=0 (a light day), TICK=n (some done), QUERY and TAG (more address, file tag).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const BASE = process.env.BASE || "http://localhost:8087";
const OUT = process.env.OUT || "/root/projects/uximprove/tasks/round2";
const LOOKS = (process.env.LOOKS || "now,card,sequence,journal").split(",");
const SCHEMES = (process.env.SCHEMES || "light,dark").split(",");
// EXTRA=0: the samples' own four tasks today (a light day), not eight.
const EXTRA = process.env.EXTRA !== "0";
// QUERY: more for the address (e.g. "focusline=short"), and TAG: a word added to the file names for it.
const QUERY = process.env.QUERY ? `&${process.env.QUERY}` : "";
const SUFFIX = (EXTRA ? "" : "-light-day") + (process.env.TAG ? `-${process.env.TAG}` : "");
// TICK=n: tick off the first n of today's one-off tasks first (a day under way).
const TICK = Number(process.env.TICK || 0);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
for (const scheme of SCHEMES) {
  for (const look of LOOKS) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(`${BASE}/?demo&rows=${look}${QUERY}`, { waitUntil: "load", timeout: 180000 });
    // Today drawn (a look may name its heading by the time of day instead of "Tasks").
    await page.waitForFunction(() => /Tasks|This (morning|afternoon|evening)|Tonight|Later today|Add task/.test(document.body.innerText), null, { timeout: 120000 });
    // Four more for today, as a real day has: a long one, a reminder, one from a note, a plain one.
    if (EXTRA) await page.evaluate(() => {
      for (const [id, mod] of window.__r.getModules()) {
        if (!/src\/store\/store\.ts$/.test(mod.verboseName ?? "")) continue;
        const store = window.__r(id).useStore;
        const { tasks, notes } = store.getState();
        const today = tasks.find((task) => task.title === "Book the dentist");
        const more = [
          { title: "Research a new dentist: two shortlisted, one left to call back", area: "Health" },
          { title: "Pay the phone bill", area: "Home", remind: 0 },
          { title: "Motion design sketches", area: "Work", noteIds: [notes[0].id] },
          { title: "Cancel the puzzle app trial", area: "Home" },
        ].map((extra, i) => ({ ...today, id: `shot-${i}`, time: null, remind: null, repeat: null, noteIds: [], foundIn: null, movedFrom: null, details: "", ...extra }));
        store.setState({ tasks: [...tasks.slice(0, tasks.indexOf(today) + 1), ...more, ...tasks.slice(tasks.indexOf(today) + 1)] });
      }
    });
    if (TICK) {
      await page.evaluate((n) => {
        for (const [id, mod] of window.__r.getModules()) {
          if (!/src\/store\/store\.ts$/.test(mod.verboseName ?? "")) continue;
          const store = window.__r(id).useStore;
          const { tasks, setDone } = store.getState();
          const day = tasks.find((task) => task.title === "Book the dentist")?.day;
          tasks.filter((task) => task.day === day && !task.done && !task.repeat).slice(0, n).forEach((task) => setDone(task.id, true));
        }
      }, TICK);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${scheme}-${look}${SUFFIX}-first.png` });
    // The list in view: Tasks near the top.
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="today"]');
      // The "Tasks" heading, or (a look that draws its own) the first task's check, a little lower.
      const title = [...scroller.querySelectorAll("*")].find((el) => el.childElementCount === 0 && el.textContent === "Tasks");
      const first = scroller.querySelector('[aria-label^="Mark "][aria-label$=" done"]');
      const anchor = title ?? first;
      if (anchor) scroller.scrollTop += anchor.getBoundingClientRect().top - (title ? 190 : 260);
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${scheme}-${look}${SUFFIX}-list.png` });
    console.log(`${scheme} ${look}`);
    await context.close();
  }
}
await browser.close();
