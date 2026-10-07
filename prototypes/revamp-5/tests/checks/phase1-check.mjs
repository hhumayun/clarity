// UX phase 1 (2026-10-06), in Sage's web build, demo mode: Reduce Motion that works, and the bugs fixed with it.
// Under Reduce Motion (Playwright's emulation): Hold to stop needs the hold, and another day fades in without
// sliding. Then: deleting a task never shows "could not be found"; Go deeper remembers "Not now"; "Saved to
// Notes" goes away; Today says "All done" once everything's ticked; Search shows more; the areas sheet says why
// a name can't be used; renaming the area Life is filtered by puts Life back on every area. Sends nothing.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const BASE = process.env.BASE || "http://localhost:8087";
// Another day in this week's strip with a task of its own in the samples: tomorrow, or on a Sunday
// (the strip runs Monday to Sunday) yesterday.
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const OTHER = new Date().getDay() === 0 ? { day: "Saturday", task: "Pay the window cleaner" } : { day: DAYS[(new Date().getDay() + 1) % 7], task: "Ask Sam about the brackets" };
let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const errors = [];
const api = [];
async function phone(options = {}) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, ...options });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/_api/")) api.push(r.url());
  });
  await page.goto(`${BASE}/?demo`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  return { context, page };
}
const btn = (page, name, exact = true) => page.getByRole("button", { name, exact }).first();
const text = (page) => page.evaluate(() => document.body.innerText);
// Every frame for `ms`, what `probe` returns.
const frames = (page, probe, ms) =>
  page.evaluate(
    ([source, ms]) =>
      new Promise((resolve) => {
        const look = new Function(`return (${source})()`);
        const out = [];
        const start = performance.now();
        const frame = () => {
          out.push(look());
          if (performance.now() - start < ms) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    [probe.toString(), ms],
  );

try {
  // —— Under Reduce Motion ——
  let { context, page } = await phone({ reducedMotion: "reduce" });

  // Another day fades in, without sliding.
  await page.evaluate((task) => (window.__probeTask = task), OTHER.task);
  await btn(page, OTHER.day, false).click();
  const days = await frames(
    page,
    () => {
      // A task of the day arriving, not the one leaving.
      const row = document.querySelector(`[data-testid="today"] [aria-label="Mark ${window.__probeTask} done"]`);
      let opacity = row ? 1 : 0;
      let slid = false;
      for (let el = row; el && el !== document.body; el = el.parentElement) {
        const style = getComputedStyle(el);
        opacity *= Number(style.opacity);
        const m = /matrix\(1, 0, 0, 1, (-?[\d.]+), /.exec(style.transform);
        if (m && Math.abs(Number(m[1])) > 1) slid = true;
      }
      return { opacity: Math.round(opacity * 100) / 100, slid };
    },
    700,
  );
  ok("reduced: another day fades in (a fade plays under Reduce Motion)", days.some((f) => f.opacity > 0.05 && f.opacity < 0.95) && days.at(-1).opacity > 0.99, JSON.stringify(days.map((f) => f.opacity)));
  ok("reduced: …and nothing slides", days.every((f) => !f.slid));
  await btn(page, "Back to today").click();
  await page.waitForTimeout(800);

  // Hold to stop needs the hold.
  await page.getByRole("button", { name: /^Focus on / }).first().click();
  await page.waitForTimeout(1500);
  await page.getByText(/^Start · /).first().click();
  await page.waitForTimeout(1500);
  const stop = btn(page, "Stop early");
  const box = await stop.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(900);
  ok("reduced: a tap on Stop early doesn't stop the session", (await stop.count()) === 1 && !/How did it go/.test(await text(page)));
  await page.mouse.down();
  await page.waitForTimeout(1700);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  ok("reduced: holding it does", /How did it go/.test(await text(page)));
  await context.close();

  // —— As usual ——
  ({ context, page } = await phone());

  // Focus: "Saved to Notes" rests, then goes.
  await page.getByRole("button", { name: /^Focus on / }).first().click();
  await page.waitForTimeout(1500);
  await page.getByText(/^Start · /).first().click();
  await page.waitForTimeout(2500);
  await btn(page, "Park a thought").click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder("What's on your mind?").fill("Check the VAT on the quote");
  await btn(page, "Save to Notes").click();
  ok("a parked thought says Saved to Notes", await page.waitForFunction(() => /Saved to Notes/.test(document.body.innerText), null, { timeout: 3000 }).then(() => true, () => false));
  await page.waitForTimeout(3000);
  ok("…and the words go again", !/Saved to Notes/.test(await text(page)));
  await page.goto(`${BASE}/?demo`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // Deleting a task: the page leaves showing the task, never "could not be found".
  await page.getByText("Book the dentist", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await btn(page, "Delete task").click();
  await page.waitForTimeout(500);
  const watch = frames(page, () => document.body.innerText.includes("could not be found"), 1500);
  await btn(page, "Delete").click();
  const seen = await watch;
  ok("deleting a task never shows 'could not be found'", seen.every((f) => !f), `${seen.filter(Boolean).length} frames`);
  await page.waitForTimeout(800);
  ok("…and the task is gone", !(await page.locator('[aria-label="Mark Book the dentist done"]').count()));

  // Today: everything ticked is "All done", not "Nothing planned".
  for (let round = 0; round < 6; round++) {
    // Today's own rows (Life, drawn ahead behind it, has them too, and counts as visible).
    const check = page.locator('[data-testid="today"] [aria-label^="Mark "][aria-label$=" done"]').first();
    if (!(await check.count())) break;
    await check.click();
    await page.waitForTimeout(1600);
  }
  ok("with everything ticked, Today says All done", /All done for today/.test(await text(page)), (await text(page)).slice(0, 200));

  // Go deeper remembers "Not now" when the keyboard comes and goes.
  await page.getByRole("tab", { name: "Notes" }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Slow morning/ }).first().click();
  await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror"), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  ok("Go deeper shows on a written note", /Go deeper/.test(await text(page)));
  await btn(page, "Not now").click();
  await page.waitForTimeout(600);
  const editor = page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1);
  await editor.locator(".ProseMirror p").last().click();
  await page.waitForTimeout(800);
  await btn(page, "Put the keyboard away").click();
  await page.waitForTimeout(800);
  ok("…and stays put away after writing (Not now is remembered)", !/Go deeper/.test(await text(page)));
  await btn(page, "Back").click();
  await page.waitForTimeout(1200);

  // Search: more than a dozen, and a quiet way to see them.
  await page.evaluate(() => {
    for (const [id, mod] of window.__r.getModules()) {
      if (/src\/store\/store\.ts$/.test(mod.verboseName ?? "")) {
        const store = window.__r(id).useStore;
        const { notes } = store.getState();
        store.setState({ notes: Array.from({ length: 4 }, (_, c) => notes.map((note) => ({ ...note, id: c ? `${note.id}-${c}` : note.id }))).flat() });
      }
    }
  });
  await page.getByRole("tab", { name: "Search" }).first().click();
  await page.waitForTimeout(1200);
  await page.getByPlaceholder("Notes and tasks").fill("e");
  await page.waitForTimeout(1500);
  const before = await page.locator('[aria-label*=", "][aria-label*=" am"], [aria-label*=", "][aria-label*=" pm"]').count();
  ok("Search with many matches offers to show more", (await btn(page, "Show more notes").count()) === 1);
  await btn(page, "Show more notes").click();
  await page.waitForTimeout(1200);
  const after = await page.locator('[aria-label*=", "][aria-label*=" am"], [aria-label*=", "][aria-label*=" pm"]').count();
  ok("…and shows them", after > before, `${before} → ${after}`);
  await page.getByPlaceholder("Notes and tasks").fill("");

  // Areas: why a name can't be used; renaming the chosen area puts Life back on every area.
  await page.getByRole("tab", { name: "Life" }).first().click();
  await page.waitForTimeout(1500);
  await btn(page, "People").click();
  await page.waitForTimeout(800);
  await btn(page, "Manage areas").click();
  await page.waitForTimeout(1200);
  await page.getByLabel("New area name").fill("home");
  await btn(page, "Add area").click();
  await page.waitForTimeout(500);
  ok("adding a name that's taken says so", /There's already an area called Home/.test(await text(page)));
  await page.getByLabel("New area name").fill("");
  await btn(page, "Rename Mind").click();
  await page.waitForTimeout(500);
  await page.getByLabel("Rename Mind").fill("Health");
  await btn(page, "Save").click();
  await page.waitForTimeout(500);
  ok("renaming to a name that's taken says so", /There's already an area called Health/.test(await text(page)));
  await btn(page, "Cancel").click();
  await btn(page, "Rename People").click();
  await page.waitForTimeout(500);
  await page.getByLabel("Rename People").fill("Family");
  await btn(page, "Save").click();
  await page.waitForTimeout(500);
  await btn(page, "Done").click();
  await page.waitForTimeout(1500);
  ok("renaming the chosen area puts Life back on every area", (await page.getByRole("button", { name: "All", exact: true }).first().getAttribute("aria-selected")) === "true" && !/Nothing waiting in People/.test(await text(page)));
  await context.close();

  ok("demo mode sent nothing to the server", api.length === 0, api.slice(0, 3).join(", "));
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n")[0]);
} finally {
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
