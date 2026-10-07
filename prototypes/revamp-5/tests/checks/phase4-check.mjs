// UX phase 4 (2026-10-07), in Sage's web build, demo mode: ticking and lists. Frame by frame:
// - Today: ticking a task, what's under the list glides with it (it jumped in one frame), and the
//   ticked row stays ticked until it's gone; the Focus card's words cross-fade when what's next changes;
//   opening Done, what's under it glides down;
// - the task page: a repeating task's check fills, then eases back; with nothing to read there's no
//   "How it's going"; ticking, Start focus fades and what follows glides up;
// - Life: Done moves with the rows; a task unticked fades in where it lands;
// - today's page written: its card settles into the page over a moment, not in one frame.
// Sends nothing.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const BASE = process.env.BASE || "http://localhost:8087";
let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
const api = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.url().includes("/_api/")) api.push(r.url());
});
const btn = (name, exact = true) => page.getByRole("button", { name, exact }).first();
const text = () => page.evaluate(() => document.body.innerText);
const check = (name) => page.getByRole("checkbox", { name, exact: true }).first();
// A task's row on Today (its words, which open it), not the Focus card that may show the same title.
const openTask = (title) => page.getByRole("button", { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().click();

// Every frame for `ms`, what `probe(arg)` returns.
const frames = (probe, ms, arg = null) =>
  page.evaluate(
    ([source, ms, arg]) =>
      new Promise((resolve) => {
        const look = new Function("arg", `return (${source})(arg)`);
        const out = [];
        const start = performance.now();
        const frame = () => {
          out.push(look(arg));
          if (performance.now() - start < ms) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    [probe.toString(), ms, arg],
  );
// An element's top (by its accessibility label, in Today's page or anywhere), and how visible it is.
const placeOf = (arg) => {
  const scope = arg.scope ? document.querySelector(arg.scope) : document;
  const el = [...(scope?.querySelectorAll(`[aria-label="${arg.label}"]`) ?? [])].find((node) => node.getBoundingClientRect().height > 0);
  if (!el) return null;
  let opacity = 1;
  for (let node = el; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
  return { top: Math.round(el.getBoundingClientRect().top), opacity: Math.round(opacity * 100) / 100, checked: el.getAttribute("aria-checked") };
};
// A glide: it moved, over several frames, and no one frame took most of the way.
const glided = (tops) => {
  const list = tops.filter((top) => top !== null);
  if (list.length < 2) return false;
  const total = Math.abs(list.at(-1) - list[0]);
  const steps = list.slice(1).map((top, i) => Math.abs(top - list[i]));
  // (A browser's first animated frame can come late, so the first step may be a large one.)
  return total > 12 && Math.max(...steps) < total * 0.75 && steps.filter((step) => step > 0.5).length >= 3;
};
const between = (value) => value > 0.05 && value < 0.95;

try {
  await page.goto(`${BASE}/?demo`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // —— The task page ——
  // Nothing to read (no notes, no focus time): no "How it's going".
  await openTask("Book the dentist");
  await page.waitForTimeout(1500);
  ok("task page: with nothing to read, there's no How it's going", !/How it's going/.test(await text()));
  await btn("Back").click();
  await page.waitForTimeout(1200);

  // A repeating task's check fills when ticked on its page, then eases back as it moves on.
  await openTask("Walk at lunch, no podcast");
  await page.waitForTimeout(1500);
  const repeatWatch = frames(placeOf, 1600, { label: "Mark done" });
  await check("Mark done").click();
  const repeat = await repeatWatch;
  const repeatChecked = repeat.filter((f) => f && f.checked === "true").length;
  ok("task page: a repeating task's check fills when ticked", repeatChecked >= 3, `${repeatChecked} frames ticked`);
  ok("…then eases back (it's open again, at its next day)", (await page.getByRole("checkbox", { name: "Mark done" }).getAttribute("aria-checked")) !== "true");
  ok("…and says when it's next", /Next:/.test(await text()));
  await btn("Back").click();
  await page.waitForTimeout(1500);

  // Ticking on a task's page: Start focus fades, and what follows glides up.
  await openTask("Send the brief to Ana");
  // How it's going reads, then writes itself in: ticked only once it's done (its growing isn't the tick's).
  await page.waitForFunction(() => /Outlined the brief/.test(document.body.innerText), null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const notesWatch = frames(
    () => {
      const title = [...document.querySelectorAll("*")].find((el) => el.childElementCount === 0 && el.textContent === "Notes" && el.getBoundingClientRect().height > 0);
      const start = document.querySelector('[aria-label="Start focus"]');
      let opacity = start ? 1 : 0;
      for (let node = start; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return { notes: title ? Math.round(title.getBoundingClientRect().top) : null, start: Math.round(opacity * 100) / 100 };
    },
    900,
  );
  await check("Mark done").click();
  const notes = await notesWatch;
  ok("task page: ticked, Start focus fades out", notes.some((f) => between(f.start)) && notes.at(-1).start === 0, JSON.stringify(notes.map((f) => f.start).slice(0, 30)));
  ok("…and the sections below glide up with it", glided(notes.map((f) => f.notes)), JSON.stringify(notes.map((f) => f.notes).slice(0, 30)));
  await check("Mark not done").click();
  await page.waitForTimeout(800);
  await btn("Back").click();
  await page.waitForTimeout(1500);

  // —— Today ——
  // Ticking a task: what's under the list glides with the card; the row stays ticked until it's gone.
  const firstNext = await page.evaluate(() => document.querySelector('[aria-label^="Focus on "]')?.getAttribute("aria-label") ?? "");
  const firstTitle = /^Focus on (.*), \d+ minutes$/.exec(firstNext)?.[1] ?? "";
  const todayWatch = frames(
    (title) => {
      const add = document.querySelector('[data-testid="today"] [aria-label="Add task"]');
      const row = document.querySelector(`[data-testid="today"] [aria-label="Mark ${title} done"]`) ?? document.querySelector(`[data-testid="today"] [aria-label="Mark ${title} not done"]`);
      const card = document.querySelector('[aria-label^="Focus on "], [aria-label^="Nothing to focus on"]');
      const words = card ? [...card.querySelectorAll("*")].filter((el) => el.childElementCount === 0 && el.textContent && /\S/.test(el.textContent) && !/^(Focus|\d+ min)$/.test(el.textContent)) : [];
      const fade = words.map((el) => {
        let opacity = 1;
        for (let node = el; node && node !== card; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        return Math.round(opacity * 100) / 100;
      });
      return { add: add ? Math.round(add.getBoundingClientRect().top) : null, row: row ? row.getAttribute("aria-checked") : null, fade };
    },
    1900,
    firstTitle,
  );
  await page.locator(`[data-testid="today"] [aria-label="Mark ${firstTitle} done"]`).first().click();
  const today = await todayWatch;
  ok("Today: ticking, Add task and what follows glide up with the list", glided(today.map((f) => f.add)), JSON.stringify(today.map((f) => f.add)));
  // Unticked until the tap lands; then ticked, until it's gone: never un-ticked again on the way out.
  const states = today.map((f) => f.row).filter((v, i, list) => v !== list[i - 1]);
  ok("…and the ticked row stays ticked until it's gone (never un-ticked as it leaves)", JSON.stringify(states.slice(states.indexOf("true"))) === JSON.stringify(["true", null]), JSON.stringify(states));
  ok("Today: what's next changes on the Focus card with a cross-fade", today.some((f) => f.fade.some(between)), JSON.stringify(today.map((f) => f.fade.join("/")).filter((v, i, list) => v !== list[i - 1]).slice(0, 12)));

  // Opening Done: what's under it (Notes, Coming up) glides down, rather than jumping.
  await page.waitForTimeout(800);
  const foldWatch = frames(() => {
    const title = [...document.querySelectorAll('[data-testid="today"] *')].find((el) => el.childElementCount === 0 && el.textContent === "Coming up" && el.getBoundingClientRect().height > 0);
    return title ? Math.round(title.getBoundingClientRect().top) : null;
  }, 900);
  await page.locator('[data-testid="today"] [aria-label="Show done"]').first().click();
  const fold = await foldWatch;
  ok("Today: opening Done, Coming up glides down with it", glided(fold), JSON.stringify(fold.filter((v, i, list) => v !== list[i - 1])));
  await page.locator('[data-testid="today"] [aria-label="Hide done"]').first().click();
  await page.waitForTimeout(800);

  // —— Life ——
  await page.getByRole("tab", { name: "Life" }).first().click();
  await page.waitForTimeout(1800);
  // A one-off task (a repeating one moves to its next day rather than leaving).
  const lifeTask = "Draft the onboarding copy";
  const lifeWatch = frames((label) => {
    const done = document.querySelector('[data-testid="life-list"] [aria-label="Show done"], [data-testid="life-list"] [aria-label="Hide done"]');
    return done ? Math.round(done.getBoundingClientRect().top) : null;
  }, 1900);
  await page.locator(`[data-testid="life-list"] [aria-label="Mark ${lifeTask} done"]`).first().click();
  const life = await lifeWatch;
  ok("Life: Done moves with the rows as a task leaves", glided(life), JSON.stringify(life));

  // Unticked from Done, a task fades in where it lands.
  await page.locator('[data-testid="life-list"] [aria-label="Show done"]').first().click();
  await page.waitForTimeout(900);
  const backWatch = frames(placeOf, 900, { label: `Mark ${lifeTask} done`, scope: '[data-testid="life-list"]' });
  await page.locator(`[data-testid="life-list"] [aria-label="Mark ${lifeTask} not done"]`).first().click();
  const back = await backWatch;
  ok("Life: a task unticked fades in where it lands", back.some((f) => f && between(f.opacity)) && back.at(-1)?.opacity === 1, JSON.stringify(back.map((f) => f?.opacity ?? null).slice(0, 30)));

  // —— Today's page, written ——
  await page.getByRole("tab", { name: "Today" }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('[aria-label*=". "]').filter({ hasText: /Good (morning|afternoon|evening)|Still up/ }).first().click();
  await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror"), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.keyboard.type("A slow start, then a good walk.", { delay: 10 });
  await page.waitForTimeout(800);
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(500);
  const settledWatch = frames(() => {
    const el = document.querySelector('[data-testid="page-settled"]');
    return el ? Number(getComputedStyle(el).opacity) : null;
  }, 1800);
  await btn("Done").click();
  const settled = await settledWatch;
  ok("today's page written: its card settles into the page over a moment, not in one frame", settled.some((v) => v !== null && between(v)) && settled.at(-1) > 0.99, JSON.stringify(settled.filter((v, i, list) => v !== list[i - 1]).map((v) => Math.round(v * 100) / 100).slice(0, 20)));

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
