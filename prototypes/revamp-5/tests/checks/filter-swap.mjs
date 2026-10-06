// The area filter's calm beat (UX phase 2, variant A), demo mode, web build, on Life and Notes:
// the list fades rather than cuts, its rows change only while it's invisible, it ends fully shown and
// in place; the one ring travels (over several frames) and ends on the chosen chip; rapid taps settle on
// the last one; Notes' chips unfolding move the list down over several frames, not in one jump.
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
page.on("pageerror", (e) => errors.push(e.message));

// Per frame from the press: the list's opacity and lift, whether `marker` is among its rows, and the ring's place.
async function tapAndWatch(chips, list, chip, marker, ms = 1000) {
  const watching = page.evaluate(
    ([chips, list, marker, ms]) =>
      new Promise((resolve) => {
        const out = [];
        const start = performance.now();
        const frame = () => {
          const el = document.querySelector(`[data-testid="${list}"]`);
          // What shows: the list's opacity times its wrappers', and the lift on whichever carries it.
          let opacity = el ? 1 : null;
          let lift = 0;
          for (let node = el; node && node !== document.body; node = node.parentElement) {
            const s = getComputedStyle(node);
            opacity *= Number(s.opacity);
            const m = /matrix\(1, 0, 0, 1, 0, (-?[\d.]+)\)/.exec(s.transform);
            if (m && !lift) lift = Number(m[1]);
          }
          const ring = document.querySelector(`[data-testid="${chips}-ring"]`)?.getBoundingClientRect();
          out.push({
            t: Math.round(performance.now() - start),
            opacity: opacity === null ? null : Math.round(opacity * 100) / 100,
            lift,
            marker: !!document.querySelector(`[data-testid="${list}"] ${marker}`),
            ringX: ring ? Math.round(ring.x * 10) / 10 : null,
            ringW: ring ? Math.round(ring.width * 10) / 10 : null,
            top: el ? Math.round(el.getBoundingClientRect().top) : null,
          });
          if (performance.now() - start < ms) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    [chips, list, marker, ms],
  );
  await page.locator(`[data-testid="${chips}"] [role="button"][aria-label="${chip}"]`).first().click();
  return watching;
}
const ringOn = (chips, chip) =>
  page.evaluate(
    ([chips, chip]) => {
      const ring = document.querySelector(`[data-testid="${chips}-ring"]`)?.getBoundingClientRect();
      const target = document.querySelector(`[data-testid="${chips}"] [role="button"][aria-label="${chip}"]`)?.getBoundingClientRect();
      return !!ring && !!target && Math.abs(ring.x - target.x) < 1.5 && Math.abs(ring.width - target.width) < 1.5;
    },
    [chips, chip],
  );

try {
  await page.goto(`${BASE}/?demo`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  // —— Life ——
  await page.getByRole("tab", { name: "Life", exact: true }).first().click();
  await page.waitForTimeout(1500);
  const walk = '[aria-label="Mark Walk at lunch, no podcast done"]';
  let frames = await tapAndWatch("life-chips", "life-list", "Work", walk);
  const changedAt = frames.findIndex((f) => !f.marker);
  ok("Life: the rows change", changedAt > 0, JSON.stringify(frames.slice(0, 3)));
  ok("Life: …only while the list is invisible", changedAt > 0 && frames[changedAt].opacity <= 0.05, `opacity ${frames[changedAt]?.opacity} at ${frames[changedAt]?.t} ms`);
  ok("Life: it fades rather than cuts (frames between)", frames.some((f) => f.opacity > 0.05 && f.opacity < 0.95));
  ok("Life: it dips and rises (lifts up, then from below)", frames.some((f) => f.lift < -0.5) && frames.some((f) => f.lift > 0.5));
  const last = frames.at(-1);
  ok("Life: it ends fully shown, in place", last.opacity === 1 && Math.abs(last.lift) < 0.5, JSON.stringify(last));
  ok("Life: the ring travels over several frames", new Set(frames.map((f) => f.ringX)).size >= 4);
  ok("Life: …and ends on the chosen chip", await ringOn("life-chips", "Work"));

  // Rapid taps: the last one wins.
  for (const chip of ["Health", "Home", "All", "People"]) {
    await page.locator(`[data-testid="life-chips"] [role="button"][aria-label="${chip}"]`).first().click();
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(1400);
  const settled = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="life-list"]');
    let opacity = 1;
    for (let node = list; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return {
      opacity,
      people: !!list.querySelector('[aria-label="Mark Call Mum back done"]'),
      work: !!list.querySelector('[aria-label="Mark Send the brief to Ana done"]'),
    };
  });
  ok("Life: rapid taps settle on the last (People), fully shown", settled.opacity === 1 && settled.people && !settled.work, JSON.stringify(settled));
  ok("Life: …with the ring on it", await ringOn("life-chips", "People"));
  await page.locator('[data-testid="life-chips"] [role="button"][aria-label="People"]').first().click();
  await page.waitForTimeout(1200);
  ok("Life: tapping the chosen area again shows every area", await page.evaluate((walk) => !!document.querySelector(`[data-testid="life-list"] ${walk}`), walk));

  // —— Notes ——
  await page.getByRole("tab", { name: "Notes", exact: true }).first().click();
  await page.waitForTimeout(1500);
  const tops = page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = [];
        const start = performance.now();
        const frame = () => {
          out.push(Math.round(document.querySelector('[data-testid="notes-list"]').getBoundingClientRect().top));
          if (performance.now() - start < 700) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
  );
  await page.getByRole("button", { name: "Filter by area", exact: true }).first().click();
  const moved = [...new Set(await tops)];
  ok("Notes: unfolding the chips moves the list down over several frames", moved.length >= 4 && moved.at(-1) > moved[0], JSON.stringify(moved));
  await page.waitForTimeout(500);
  const kitchen = '[aria-label^="Kitchen shelves, Home"]';
  frames = await tapAndWatch("notes-chips", "notes-list", "Work", kitchen);
  const notesChanged = frames.findIndex((f) => !f.marker);
  ok("Notes: the notes change only while the list is invisible", notesChanged > 0 && frames[notesChanged].opacity <= 0.05, `opacity ${frames[notesChanged]?.opacity}`);
  ok("Notes: it ends fully shown", frames.at(-1).opacity === 1);
  ok("Notes: the ring ends on the chosen chip", await ringOn("notes-chips", "Work"));
  await page.getByRole("button", { name: "Show every area", exact: true }).first().click();
  await page.waitForTimeout(1300);
  ok("Notes: folding the chips away shows every area again", await page.evaluate((k) => {
    const list = document.querySelector('[data-testid="notes-list"]');
    let opacity = 1;
    for (let node = list; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return !!list.querySelector(k) && opacity === 1;
  }, kitchen));

  // —— Search ——
  await page.getByRole("tab", { name: "Search", exact: true }).first().click();
  await page.waitForTimeout(1500);
  const resultsWatch = page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = [];
        const start = performance.now();
        const frame = () => {
          const el = document.querySelector('[data-testid="search-results"]');
          let opacity = 1;
          for (let node = el; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
          out.push({ opacity: Math.round(opacity * 100) / 100, empty: el.innerText.includes("Find anything you wrote"), brief: !!el.querySelector('[aria-label="Mark Send the brief to Ana done"]') });
          if (performance.now() - start < 1600) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
  );
  await page.getByPlaceholder("Notes and tasks").pressSequentially("brief", { delay: 45 });
  const typing = await resultsWatch;
  const swappedAt = typing.findIndex((f) => !f.empty);
  ok("Search: typing changes the results only while they're invisible", swappedAt > 0 && typing[swappedAt].opacity <= 0.05, `opacity ${typing[swappedAt]?.opacity}`);
  ok("Search: …once typing pauses, not on every key (one change)", typing.filter((f, i) => i > 0 && f.empty !== typing[i - 1].empty).length === 1);
  ok("Search: the words find the task, fully shown", typing.at(-1).brief && typing.at(-1).opacity === 1, JSON.stringify(typing.at(-1)));
  frames = await tapAndWatch("search-chips", "search-results", "Health", '[aria-label="Mark Send the brief to Ana done"]');
  const areaChanged = frames.findIndex((f) => !f.marker);
  ok("Search: an area changes the results only while they're invisible", areaChanged > 0 && frames[areaChanged].opacity <= 0.05, `opacity ${frames[areaChanged]?.opacity}`);
  ok("Search: the ring ends on the chosen chip", await ringOn("search-chips", "Health"));
  await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
  await page.locator('[data-testid="search-chips"] [role="button"][aria-label="All"]').first().click();
  await page.waitForTimeout(1300);
  ok("Search: cleared and on every area, the way in shows again", await page.evaluate(() => document.querySelector('[data-testid="search-results"]').innerText.includes("Find anything you wrote")));
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n")[0]);
} finally {
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
