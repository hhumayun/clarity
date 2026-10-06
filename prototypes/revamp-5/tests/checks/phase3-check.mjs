// UX phase 3 (2026-10-06), in Sage's web build, demo mode: the note page while writing. The web build has
// no keyboard, so writing in the words stands for it (the phone follows the keyboard's own motion; judge
// that there). Here: Go deeper, Tasks and Done, and the tools, are always there and fade into each other
// rather than cutting, and the words never move as they do; word help's strip takes no room; a new
// page opens straight to writing, and gets Go deeper once written; Today's question keeps its row when
// writing starts, so the line being written doesn't jump; the ⋯ menu floats, fades and closes on a tap
// outside; ⋯ fades in when a new note is first saved; a new page has its time from the first frame.
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
const editorFrame = () => page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1);
const waitEditor = async () => {
  await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return editorFrame();
};

// The note page's parts, as drawn: how visible each is (its own and its parents' opacity), whether it's
// hidden from screen readers, and where the words are.
function look() {
  const seen = (id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    let opacity = 1;
    for (let node = el; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return { opacity: Math.round(opacity * 100) / 100, hidden: !!el.closest('[aria-hidden="true"]') };
  };
  const words = document.querySelector('iframe[title="Note"]')?.getBoundingClientRect();
  return {
    bottom: seen("note-bottom"),
    tools: seen("note-tools"),
    row: seen("question-row"),
    menu: seen("note-menu"),
    more: seen("note-more"),
    words: words ? { top: Math.round(words.top), height: Math.round(words.height) } : null,
    eyebrow: document.querySelector('[data-testid="note-meta"]')?.textContent ?? null,
  };
}
// Every frame for `ms`, what look() says.
const frames = (ms) =>
  page.evaluate(
    ([source, ms]) =>
      new Promise((resolve) => {
        const probe = new Function(`return (${source})()`);
        const out = [];
        const start = performance.now();
        const frame = () => {
          out.push(probe());
          if (performance.now() - start < ms) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    [look.toString(), ms],
  );
const between = (value) => value > 0.05 && value < 0.95;
const steady = (list, key) => list.every((f) => f.words && list[0].words && Math.abs(f.words[key] - list[0].words[key]) <= 1);

try {
  await page.goto(`${BASE}/notes?demo`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => /Notes/.test(document.body.innerText), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // —— A written note: writing and back ——
  await page.getByRole("button", { name: /^Slow morning/ }).first().click();
  let frame = await waitEditor();
  let now = await page.evaluate(look);
  ok("reading: Go deeper and the buttons show, the tools don't", now.bottom?.opacity === 1 && !now.bottom.hidden && now.tools?.opacity === 0 && now.tools.hidden, JSON.stringify(now));

  const toWriting = frames(700);
  await frame.locator(".ProseMirror p").last().click();
  let seen = await toWriting;
  ok("writing: the buttons fade (not a cut) and the tools fade in", seen.some((f) => between(f.bottom.opacity)) && seen.some((f) => between(f.tools.opacity)), JSON.stringify(seen.map((f) => [f.bottom.opacity, f.tools.opacity])));
  ok("…both stay there all along", seen.every((f) => f.bottom && f.tools));
  ok("…and the words don't move or change size", steady(seen, "top") && steady(seen, "height"), JSON.stringify([seen[0].words, seen.at(-1).words]));
  now = await page.evaluate(look);
  ok("…ending with the tools only (the buttons hidden from screen readers too)", now.tools.opacity === 1 && !now.tools.hidden && now.bottom.opacity === 0 && now.bottom.hidden, JSON.stringify(now));

  const toReading = frames(700);
  await btn("Put the keyboard away").click();
  seen = await toReading;
  ok("keyboard away: the tools fade and the buttons come back, fading", seen.some((f) => between(f.bottom.opacity)) && seen.some((f) => between(f.tools.opacity)) && seen.at(-1).bottom.opacity === 1, JSON.stringify(seen.map((f) => [f.bottom.opacity, f.tools.opacity])));
  ok("…and the words stay where they are", steady(seen, "top") && steady(seen, "height"));

  // —— The ⋯ menu ——
  await btn("More: archive or delete this note").click();
  await page.waitForTimeout(500);
  const shadow = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="note-menu"]')).boxShadow);
  ok("the ⋯ menu floats, with the one shadow", !!shadow && shadow !== "none", shadow);
  const closing = frames(500);
  await page.mouse.click(196, 620);
  seen = await closing;
  ok("a tap outside closes it, fading out", seen.some((f) => f.menu && between(f.menu.opacity)) && !seen.at(-1).menu, JSON.stringify(seen.map((f) => f.menu?.opacity ?? null)));
  await page.waitForTimeout(300);
  ok("…and the tap went nowhere else (the keyboard didn't come)", !(await page.evaluate(look)).tools.opacity);
  await btn("Back").click();
  await page.waitForTimeout(1500);

  // —— A new page ——
  await btn("New note or task").click();
  await page.waitForTimeout(600);
  const opening = frames(2500);
  await btn("New note").click();
  seen = (await opening).filter((f) => f.bottom);
  ok("a new page opens straight to writing: its buttons never show first", seen.length > 0 && seen.every((f) => f.bottom.opacity < 0.05), JSON.stringify(seen.map((f) => f.bottom.opacity).slice(0, 40)));
  ok("…and the tools are there to write with", seen.at(-1)?.tools.opacity === 1, JSON.stringify(seen.at(-1)));
  ok("…and its time is there from the first frame", seen.length > 0 && seen.every((f) => /·\s*\d{1,2}:\d{2}\s*[AP]M/i.test(f.eyebrow ?? "")), seen[0]?.eyebrow ?? "");
  frame = editorFrame();
  const saving = frames(3500);
  await page.keyboard.type("We walked by the canal for an hour.", { delay: 15 });
  seen = await saving;
  ok("⋯ fades in once the new note is saved", seen.some((f) => f.more && between(f.more.opacity)) && seen.at(-1).more?.opacity === 1, JSON.stringify(seen.map((f) => f.more?.opacity ?? null).filter((v) => v !== null).slice(0, 12)));

  // Word help's strip comes above the tools, taking no room from the words. (On the phone, where the
  // keyboard and tools are taller than what's under the words, it lies over the words' bottom.)
  const before = (await page.evaluate(look)).words;
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label^="Add “"]')].length > 0, null, { timeout: 8000 }).catch(() => {});
  const strip = await page.evaluate(() => {
    const chip = document.querySelector('[aria-label^="Add “"]');
    const tools = document.querySelector('[aria-label="Put the keyboard away"]');
    const words = document.querySelector('iframe[title="Note"]').getBoundingClientRect();
    return chip && tools ? { chipBottom: Math.round(chip.getBoundingClientRect().bottom), toolsTop: Math.round(tools.getBoundingClientRect().top), height: Math.round(words.height) } : null;
  });
  ok("word help's strip comes above the tools", !!strip && strip.chipBottom <= strip.toolsTop, JSON.stringify(strip));
  ok("…taking no room from the words", !!strip && Math.abs(strip.height - before.height) <= 1, `${before.height} → ${strip?.height}`);

  await btn("Put the keyboard away").click();
  await page.waitForTimeout(900);
  now = await page.evaluate(look);
  ok("keyboard away: the new page's buttons come", now.bottom.opacity === 1 && !now.bottom.hidden, JSON.stringify(now.bottom));
  ok("…with Go deeper, now that it's written", /Go deeper/.test(await page.evaluate(() => document.querySelector('[data-testid="note-bottom"]').innerText)));
  await btn("Done").click();
  await page.waitForTimeout(1500);

  // —— Today's question: the first words ——
  await page.getByRole("tab", { name: "Today" }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('[aria-label$="?"]').first().click();
  frame = await waitEditor();
  now = await page.evaluate(look);
  ok("today's page: its question tools show", now.row?.opacity === 1 && !now.row.hidden, JSON.stringify(now.row));
  const typing = frames(2500);
  await page.keyboard.type("A long walk", { delay: 20 });
  seen = await typing;
  now = await page.evaluate(look);
  ok("once written, they fade (keeping their place, hidden from screen readers)", now.row?.opacity === 0 && now.row.hidden && seen.some((f) => between(f.row.opacity)), JSON.stringify(seen.map((f) => f.row?.opacity)));
  ok("…and the line being written doesn't move", steady(seen, "top"), JSON.stringify([seen[0].words, seen.at(-1).words]));
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(600);
  await btn("Done").click();
  await page.waitForTimeout(1200);

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
