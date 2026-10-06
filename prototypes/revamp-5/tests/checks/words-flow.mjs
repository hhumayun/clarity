// Word help and Go deeper in Sage's web build, demo mode: after a pause at the end of a sentence,
// a strip of ways to start the next one; a tap puts the words in, cased and spaced; typing on lets
// it go; nothing comes mid-sentence. Go deeper offers the sample's own questions. Sends nothing.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const BASE = process.env.BASE || "http://localhost:8087";
const OUT = "/root/projects/clarity-design-research/revamp-5/shots/words";
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
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("request", (r) => { if (r.url().includes("/_api/")) api.push(r.url()); });

const btn = (name) => page.getByRole("button", { name, exact: false }).first();
const editorFrame = () => page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1);
const waitEditor = async () => {
  await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return editorFrame();
};
const words = async () => (await editorFrame()?.evaluate(() => document.querySelector(".ProseMirror")?.innerText ?? "")) ?? "";
const chips = () => page.getByRole("button", { name: /^Add “/ });
const SAMPLES = ["What I keep coming back to", "It made me feel", "Next time I", "The hard part is", "What helped was", "Tomorrow I want to"];

try {
  await page.goto(`${BASE}/notes?demo`, { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(2500);

  // 1. A new note: a sentence, then a pause.
  await btn("New note or task").click();
  await page.waitForTimeout(600);
  await btn("New note").click();
  const frame = await waitEditor();
  await frame.locator(".ProseMirror").click();
  await page.keyboard.type("We walked by the canal for an hour.", { delay: 15 });
  await page.waitForTimeout(1000);
  ok("no strip while writing", (await chips().count()) === 0);
  await page.waitForTimeout(3000);
  const offered = await chips().count();
  ok("after a pause at a sentence's end, a strip of ways to start the next", offered === 3, `${offered} chips`);
  await page.screenshot({ path: `${OUT}/strip.png` });
  const first = (await chips().first().getAttribute("aria-label"))?.replace(/^Add “|”$/g, "") ?? "";
  ok("…the samples' own (nothing is sent looking around)", SAMPLES.includes(first), first);

  // 2. A tap puts them in, after a space, capitalised; the strip goes.
  await chips().first().click();
  await page.waitForTimeout(800);
  const after = await words();
  ok("a tap puts the words in at the cursor, spaced and capitalised", after.includes(`We walked by the canal for an hour. ${first}`), JSON.stringify(after));
  ok("…and the strip goes", (await chips().count()) === 0);
  ok("the editor still has the cursor", await frame.evaluate(() => document.activeElement?.classList.contains("ProseMirror") ?? false));
  await page.keyboard.type("calm and slow,", { delay: 15 });
  ok("typing on goes straight after the words", (await words()).includes(`${first} calm and slow,`), JSON.stringify(await words()));

  // 3. Mid-sentence, nothing comes (the samples only start sentences).
  await page.keyboard.type(" and the water was so still that I", { delay: 15 });
  await page.waitForTimeout(4500);
  ok("mid-sentence, no strip", (await chips().count()) === 0);
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(600);
  ok("with the keyboard away, no strip", (await chips().count()) === 0);
  await btn("Done").click();
  await page.waitForTimeout(1500);

  // 4. Go deeper on a sample: its own questions, one after another.
  await page.getByRole("button", { name: /^Slow morning/ }).first().click();
  await waitEditor();
  const body = async () => page.evaluate(() => document.body.innerText);
  ok("Go deeper shows on a written note", /Go deeper/.test(await body()));
  ok("…with the sample's own question", /first hour|this morning feel different/.test(await body()));
  const before = await body();
  await btn("Another question").click();
  await page.waitForTimeout(900);
  ok("another question rolls in", (await body()) !== before && /first hour|this morning feel different/.test(await body()));
  await page.screenshot({ path: `${OUT}/deeper.png` });

  ok("demo mode sent nothing to the server", api.length === 0, api.slice(0, 3).join(", "));
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n")[0]);
  await page.screenshot({ path: `${OUT}/stopped.png` }).catch(() => {});
} finally {
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
