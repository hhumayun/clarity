// Screenshots of Today's task rows in each look (src/ui/rowLook.ts), light and dark, for the user to
// choose from (2026-10-07). Demo mode with eight tasks today (four added, like a real day), so the
// calmer looks fold after five. Each look: the first screen, and the list scrolled into view.
// Writes PNGs to OUT (default /root/projects/uximprove/tasks/round2); never commit them with research.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const BASE = process.env.BASE || "http://localhost:8087";
const OUT = process.env.OUT || "/root/projects/uximprove/tasks/round2";
const LOOKS = (process.env.LOOKS || "now,card,sequence,journal").split(",");
const SCHEMES = (process.env.SCHEMES || "light,dark").split(",");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
for (const scheme of SCHEMES) {
  for (const look of LOOKS) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(`${BASE}/?demo&rows=${look}`, { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
    // Four more for today, as a real day has: a long one, a reminder, one from a note, a plain one.
    await page.evaluate(() => {
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
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${scheme}-${look}-first.png` });
    // The list in view: Tasks near the top.
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="today"]');
      const title = [...scroller.querySelectorAll("*")].find((el) => el.childElementCount === 0 && el.textContent === "Tasks");
      scroller.scrollTop += title.getBoundingClientRect().top - 190;
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${scheme}-${look}-list.png` });
    console.log(`${scheme} ${look}`);
    await context.close();
  }
}
await browser.close();
