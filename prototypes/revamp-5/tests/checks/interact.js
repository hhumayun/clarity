// Interaction checks for revamp 5 ("Sage"), in headless Chrome against Metro's web build.
// node interact.js [light|dark]
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const OUT = "/root/projects/clarity-design-research/revamp-5/motion";
const BASE = process.env.BASE || "http://localhost:8087";
const scheme = process.argv[2] || "light";
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

// The sample notes need demo mode now: a fresh browser opens on the welcome.
const demo = (path) => `${path}${path.includes("?") ? "&" : "?"}demo`;

(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
  let page = null;
  const errors = [];
  // Every request to Clarity's API: demo mode must make none.
  const apiCalls = [];
  const fresh = async () => {
    if (page) await page.close();
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => { if (r.url().includes("/_api/")) apiCalls.push(`${r.method()} ${r.url()}`); });
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  };
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}_${scheme}.png` });
  const go = async (path, wait = 2600) => {
    await fresh();
    await page.goto(`${BASE}${demo(path)}`, { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction(() => document.body.innerText.trim().length > 0 && !/^\s*clarity\s*$/m.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(wait);
  };
  const btn = (name) => page.getByRole("button", { name, exact: false }).first();
  const visible = async (locator) => (await locator.count()) > 0 && (await locator.first().isVisible());
  const texts = () => page.evaluate(() => document.body.innerText);
  const countScan = async (where) => {
    const t = await texts();
    const bad = t.match(/\b\d+\s+(tasks?|notes?|words?|items?|entries|sessions?|things?)\b|\(\d+\)|\b\d+\s*\/\s*\d+\b/gi);
    ok(`no counts on ${where}`, !bad, bad ? bad.slice(0, 4).join(", ") : "");
  };

  try {
    // Today and its counts
    await go("/", 3000);
    await countScan("Today");

    // The + dial
    await btn("New note or task").click();
    await page.waitForTimeout(160); await shot("dial_mid");
    await page.waitForTimeout(500); await shot("dial_open");
    ok("dial shows Note and Task", (await visible(btn("New note"))) && (await visible(btn("New task"))));
    await btn("New note").click();
    await page.waitForTimeout(1400);
    ok("dial Note opens a new note", await visible(page.getByLabel("Title")));
    await btn("Back").click();
    await page.waitForTimeout(1200);

    // Tick a task: fills, rests struck, leaves for Done
    const tick = page.getByRole("checkbox", { name: "Mark Book the dentist done" });
    ok("task check is there", await visible(tick));
    await tick.click();
    await page.waitForTimeout(140); await shot("tick_mid");
    await page.waitForTimeout(380); await shot("tick_rest");
    await page.waitForTimeout(1100);
    ok("ticked task leaves the list", !(await visible(page.getByRole("checkbox", { name: "Mark Book the dentist done" }))));
    await btn("Show done").click();
    await page.waitForTimeout(600);
    ok("Done unfolds with it", await visible(page.getByRole("checkbox", { name: "Mark Book the dentist not done" })));
    await shot("done_open");

    // Another day from the week
    const wed = page.getByRole("button", { name: /^Wednesday/ }).first();
    await wed.click();
    await page.waitForTimeout(120); await shot("day_mid");
    await page.waitForTimeout(700); await shot("day_wed");
    ok("another day shows Back to today", await visible(btn("Back to today")));
    ok("the day's heading changes", (await texts()).includes("Wednesday"));
    await btn("Back to today").click();
    await page.waitForTimeout(900);

    // Write to today's question, one question at a time (the editor: questions are quotes)
    const write = page.getByRole("button", { name: /^Good (morning|afternoon|evening)|^Still up/ }).first();
    await write.click();
    await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror blockquote"), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const editor = page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1);
    ok("the question stands above the answer", !!editor && (await editor.locator("blockquote").count()) === 1);
    await page.keyboard.type("A long walk after lunch, and the brief finally made sense.", { delay: 5 });
    await page.waitForTimeout(600);
    await btn("Next question").click();
    await page.waitForTimeout(700); await shot("guided");
    ok("Next question adds a second question", !!editor && (await editor.locator("blockquote").count()) === 2);
    await btn("Put the keyboard away").click().catch(() => {});
    await page.waitForTimeout(400);
    await btn("Done").click();
    // Done's own check says it: no word about saving (asked for on 2026-10-06).
    const saved = await page.waitForFunction(() => document.body.innerText.includes("Saved"), null, { timeout: 2500 }).then(() => true, () => false);
    ok("Done says nothing about saving", !saved);
    await shot("done_morph");
    await page.waitForTimeout(1000); await shot("written");
    ok("Today's card shows the page as written", await visible(page.getByRole("button", { name: /written at/ })));

    // How it's going: dots, then words. Opened from inside the app, as on the phone (no launch veil in front).
    await go("/life", 1500);
    await page.getByText("Send the brief to Ana", { exact: true }).first().click();
    const dots = await page.waitForFunction(() => !!document.querySelector('[role="progressbar"][aria-label="Reading"]'), null, { timeout: 3000 }).then(() => true, () => false);
    await shot("summary_reading");
    ok("summary reads first (dots)", dots);
    await page.waitForTimeout(1500); await shot("summary_stream");
    await page.waitForTimeout(5000); await shot("summary_done");
    ok("summary arrives with its steps", (await texts()).includes("Parked a question"));

    // Find tasks: Add becomes a check
    await go("/note-tasks?note=kitchen-shelves", 700);
    await shot("find_reading");
    await page.waitForTimeout(2400);
    const add = btn("Add Measure the alcove again");
    ok("found tasks arrive as cards", await visible(add));
    await add.click();
    await page.waitForTimeout(500); await shot("find_added");
    ok("Add turns into a check", await visible(btn("Measure the alcove again added")));

    // Your colour
    await go("/settings", 2000);
    await page.getByRole("radio", { name: "Rose" }).click();
    await page.waitForTimeout(200); await shot("accent_pop");
    await page.waitForTimeout(600); await shot("accent_rose");
    const fab = await page.evaluate(() => getComputedStyle([...document.querySelectorAll('[role="radio"]')].find((e) => e.getAttribute("aria-label") === "Rose")).borderColor);
    ok("Rose is chosen", !!fab);

    // Focus: the flood
    await go("/focus/t1", 2200);
    await btn("Start 15 minutes of focus time").click();
    await page.waitForTimeout(260); await shot("flood_mid");
    await page.waitForTimeout(1600); await shot("focus_run");
    ok("focus is running", (await texts()).includes("left"));

    // Catch up: deal out, deal in
    await go("/catch-up", 2200);
    const first = await texts();
    await btn("Do it today").click();
    await page.waitForTimeout(140); await shot("deal_out");
    await page.waitForTimeout(800); await shot("deal_in");
    ok("Catch up deals the next card", (await texts()) !== first && (await texts()).includes("Moved to Today"));

    // Swipe a row right to finish it
    await go("/life", 2600);
    const row = page.getByRole("button", { name: /Opens the task/ }).first();
    const target = page.getByText("Look into a standing desk", { exact: true }).first();
    await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    const box = await target.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(box.x + 20 + i * 11, box.y + 10); await page.waitForTimeout(16); }
    await shot("swipe_mid");
    await page.mouse.up();
    await page.waitForTimeout(1400);
    ok("swiping right finishes a task", !(await visible(page.getByRole("checkbox", { name: "Mark Look into a standing desk done" }))));
    void row;

    // Long-press menu
    const ask = page.getByText("Ask Sam about the brackets", { exact: true }).first();
    await ask.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const b2 = await ask.boundingBox();
    await page.mouse.move(b2.x + 20, b2.y + 8); await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();
    await page.waitForTimeout(700); await shot("menu");
    ok("long-press opens the quick menu", await visible(page.getByRole("menuitem", { name: "Focus" })));

    for (const [path, name] of [["/notes", "Notes"], ["/life", "Life Center"], ["/search", "Search"], ["/note/slow-morning", "a note"], ["/task/t1", "a task"]]) {
      await go(path, 2200);
      await countScan(name);
    }
  } catch (e) {
    ok("run finished", false, e.message.split("\n")[0]);
  }
  ok("demo mode sent nothing to Clarity's server", apiCalls.length === 0, apiCalls.slice(0, 3).join(" | "));
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `; page errors: ${[...new Set(errors)].slice(0, 5).join(" | ")}` : ""}`);
  await browser.close();
})();
