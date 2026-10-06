// Screenshots of revamp 5 ("Sage") in headless Chrome at iPhone size.
// node shots.js <light|dark> [name,name]   BASE defaults to the Metro dev server.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const OUT = process.env.OUT || "/root/projects/clarity-design-research/revamp-5/shots";
const BASE = process.env.BASE || "http://localhost:8087";
const scheme = process.argv[2] || "light";
const only = process.argv[3] ? process.argv[3].split(",") : null;

// The sample notes need demo mode now: a fresh browser opens on the welcome.
const demo = (path) => `${path}${path.includes("?") ? "&" : "?"}demo`;

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
  let page = null;
  const errors = [];
  // A fresh tab for every screen: one long-lived tab running the dev bundle runs out of memory.
  const fresh = async () => {
    if (page) await page.close();
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); });
  };
  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}_${scheme}.png` });
    console.log("shot", name, errors.length ? `ERRORS(${errors.length}): ${errors.splice(0).join(" | ").slice(0, 900)}` : "");
  };
  const go = async (path, wait = 2400) => {
    await fresh();
    await page.goto(`${BASE}${demo(path)}`, { waitUntil: "load", timeout: 180000 });
    // The launch veil (the leaf and the word "clarity") must have lifted before anything is judged.
    await page.waitForFunction(() => document.body.innerText.trim().length > 0 && !/^\s*clarity\s*$/m.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(wait);
  };
  const scroller = async (y) => {
    await page.evaluate((top) => {
      const els = [...document.querySelectorAll("div")].filter((d) => d.scrollHeight > d.clientHeight + 40 && getComputedStyle(d).overflowY !== "visible");
      els.sort((a, b) => b.scrollHeight - a.scrollHeight);
      if (els[0]) els[0].scrollTop = top;
    }, y);
    await page.waitForTimeout(700);
  };
  const want = (name) => !only || only.includes(name);
  try {
    if (want("today")) { await go("/", 4500); await shot("today"); await scroller(560); await shot("today_2"); await scroller(1300); await shot("today_3"); }
    if (want("notes")) { await go("/notes"); await shot("notes"); await scroller(700); await shot("notes_2"); }
    if (want("life")) { await go("/life"); await shot("life"); await scroller(700); await shot("life_2"); }
    if (want("search")) { await go("/search"); await shot("search"); }
    if (want("note")) { await go("/note/slow-morning"); await shot("note"); await scroller(600); await shot("note_2"); }
    if (want("newnote")) { await go("/note/new?prompt=What%20would%20make%20today%20feel%20well%20spent%3F&page=1"); await shot("newnote"); }
    if (want("task")) { await go("/task/t1", 4200); await shot("task"); await scroller(600); await shot("task_2"); }
    if (want("focus")) { await go("/focus/t1"); await shot("focus_setup"); }
    if (want("catchup")) { await go("/catch-up"); await shot("catchup"); }
    if (want("quickadd")) { await go("/quick-add?day=none"); await shot("quickadd"); }
    if (want("settings")) { await go("/settings"); await shot("settings"); await scroller(700); await shot("settings_2"); }
    if (want("notetasks")) { await go("/note-tasks?note=kitchen-shelves", 3800); await shot("notetasks"); }
    if (want("pictures")) { await go("/pictures", 3800); await shot("pictures"); await scroller(640); await shot("pictures_2"); }
    if (want("sheets")) {
      for (const [name, path] of [["sheet_date", "/sheet/date?task=t1"], ["sheet_reminder", "/sheet/reminder?task=t1"], ["sheet_area", "/sheet/area?task=t1"], ["sheet_areas", "/sheet/areas"], ["sheet_linknote", "/sheet/link-note?task=t1"]]) { await go(path, 3200); await shot(name); }
    }
  } catch (e) {
    console.log("FAILED", e.message);
  }
  await browser.close();
})();
