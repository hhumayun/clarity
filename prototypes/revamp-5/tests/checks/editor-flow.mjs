// The note page with the built-in editor, in Sage's web build, demo mode:
// opening a sample note, editing and reopening it, a new note with the
// tools, Today's question with Next question. Demo mode must send nothing.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const BASE = process.env.BASE || "http://localhost:8087";
const OUT = "/root/projects/clarity-design-research/revamp-5/shots/editor";
mkdirSync(OUT, { recursive: true });
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
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); if (/\[editor\]/.test(m.text())) console.log("  console:", m.text().slice(0, 200)); });
const started = Date.now();
page.on("framenavigated", (f) => { if (f.url() === "about:srcdoc") console.log(`  editor frame loaded at ${((Date.now() - started) / 1000).toFixed(1)}s`); });
page.on("request", (r) => { if (r.url().includes("/_api/")) api.push(r.url()); });

const btn = (name) => page.getByRole("button", { name, exact: false }).first();
const editorFrame = () => page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1);
const waitEditor = async () => {
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe[title="Note"]');
    return frame?.contentDocument?.querySelector(".ProseMirror");
  }, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return editorFrame();
};
const words = async () => (await editorFrame()?.evaluate(() => document.querySelector(".ProseMirror")?.innerText ?? "")) ?? "";
const go = async (path) => {
  await page.goto(`${BASE}${path}${path.includes("?") ? "&" : "?"}demo`, { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(2500);
};

try {
  // The samples live only as long as the page: everything below moves by taps.
  await go("/notes");
  const notesText = () => page.evaluate(() => document.body.innerText);

  // 1. A sample note opens in the editor, its checklist and quote drawn.
  await page.getByRole("button", { name: /^Slow morning/ }).first().click();
  let frame = await waitEditor();
  ok("sample note opens in the editor", (await words()).includes("Coffee on the step"));
  ok("its question is a quote", (await frame.locator("blockquote").count()) === 1);
  ok("its checklist has three rows, the first ticked", (await frame.locator('ul[data-type="taskList"] li').count()) === 3 && (await frame.locator('li[data-checked="true"]').count()) === 1);
  ok("the tools are away until writing", !(await btn("Bold").isVisible().catch(() => false)));
  await page.screenshot({ path: `${OUT}/note-open.png` });

  // 2. Writing: the tools show; words added stay after leaving and coming back.
  await frame.locator(".ProseMirror p").last().click();
  await frame.evaluate(() => document.querySelector(".ProseMirror").editor.commands.focus("end"));
  await page.waitForTimeout(300);
  ok("writing shows the tools row", await btn("Bold").isVisible());
  await page.keyboard.type(" Added in the editor.", { delay: 10 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/note-writing.png` });
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(500);
  await btn("Done").click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Slow morning/ }).first().click();
  frame = await waitEditor();
  ok("the added words are kept", (await words()).includes("Added in the editor."));
  ok("…with the checklist and quote intact", (await frame.locator("blockquote").count()) === 1 && (await frame.locator('ul[data-type="taskList"] li').count()) === 3);
  await btn("Back").click();
  await page.waitForTimeout(1200);

  // 3. A new note: a title, a checklist and bold words from the tools.
  await btn("New note or task").click();
  await page.waitForTimeout(600);
  await btn("New note").click();
  frame = await waitEditor();
  await page.getByLabel("Title").fill("Editor check");
  await frame.locator(".ProseMirror").click();
  await page.waitForTimeout(300);
  await btn("Checklist").click();
  await page.keyboard.type("milk", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("eggs", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await btn("Bold").click();
  await page.keyboard.type("Strong", { delay: 10 });
  await page.waitForTimeout(400);
  ok("the checklist went in", (await frame.locator('ul[data-type="taskList"] li').count()) === 2);
  ok("bold went in", (await frame.locator(".ProseMirror strong").count()) === 1);
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(500);
  await btn("Done").click();
  await page.waitForTimeout(1500);
  ok("the new note is in Notes", (await notesText()).includes("Editor check"));

  // 4. Today's question left unanswered: no note, and the card still asks.
  await page.getByRole("tab", { name: "Today" }).first().click();
  await page.waitForTimeout(1200);
  const card = page.locator('[aria-label$="?"]').first();
  const question = (await card.getAttribute("aria-label")).split(". ").slice(1).join(". ");
  await card.click();
  frame = await waitEditor();
  ok("today's page opens with its question as a quote", (await frame.locator("blockquote").first().innerText()) === question, question);
  ok("another question can be had before writing", await btn("Another question").isVisible());
  await btn("Back").click();
  await page.waitForTimeout(1200);
  ok("a page left with only its question isn't saved", (await page.locator('[aria-label$="?"]').count()) > 0);

  // 5. Answered: Next question adds another, and the card then opens the page.
  await page.locator('[aria-label$="?"]').first().click();
  frame = await waitEditor();
  await page.keyboard.type("A long walk", { delay: 10 });
  await page.waitForTimeout(1200);
  ok("once writing starts, Another question steps away", !(await btn("Another question").isVisible().catch(() => false)));
  await btn("Next question").click();
  await page.waitForTimeout(400);
  await page.keyboard.type("Leaving early", { delay: 10 });
  await page.waitForTimeout(500);
  ok("next question adds a second quote, answered under it", (await frame.locator("blockquote").count()) === 2 && (await words()).includes("Leaving early"));
  await page.screenshot({ path: `${OUT}/page-questions.png` });
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(500);
  await btn("Done").click();
  await page.waitForTimeout(1500);
  ok("today's card now opens the written page", (await page.locator('[aria-label*="Today\'s page, written at"]').count()) > 0);
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n").slice(0, 4).join(" | "));
  await page.screenshot({ path: `${OUT}/stopped.png` }).catch(() => {});
} finally {
  ok("demo mode sent nothing to the server", api.length === 0, api.slice(0, 3).join(", "));
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
