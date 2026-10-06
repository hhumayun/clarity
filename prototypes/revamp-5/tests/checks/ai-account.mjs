// AI help off and on, as the TEST account, against the live server (web build).
// Off: nothing at all goes to an AI endpoint, whatever the screens do. On: Find tasks reads the
// note, an untitled note is titled quietly when it's left (and indexed once), the task page asks
// how it's going, and Focus asks for first steps. Writes only "Sage check" items and removes them.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const LIVE = "https://clarity-notes-production.up.railway.app";
const APP = "http://localhost:8087";
const OUT = "/root/projects/clarity-design-research/revamp-5/shots/ai";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
mkdirSync(OUT, { recursive: true });
const WORDS = "Sage check: I need to call the plumber about the kitchen leak, and book the car in for its service before Friday.";
const MORE = " Also ask Sam about the spare keys.";
const TASK = "Sage check: AI help task";
// Every endpoint that reads your words with an AI, or records what AI help offered.
const AI_PATHS = ["/_api/notes/suggest_title", "/_api/notes/reindex", "/_api/tasks/extract", "/_api/tasks/summary", "/_api/tasks/first_steps", "/_api/tasks/dismiss_suggestion", "/_api/suggestions/generate", "/_api/suggestions/event"];

let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const cors = { "access-control-allow-origin": APP, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };
const calls = [];
await context.route(`${LIVE}/_api/**`, async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  calls.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postData() ?? "", at: Date.now() });
  const response = await route.fetch();
  return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const press = (name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: 30000 });
const btn = (name) => page.getByRole("button", { name, exact: false }).first();
const text = () => page.evaluate(() => document.body.innerText);
const words = async () => (await page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1)?.evaluate(() => document.querySelector(".ProseMirror")?.innerText ?? "")) ?? "";
const chips = () => page.getByRole("button", { name: /^Add “/ });
const asks = (from) => calls.slice(from).filter((call) => call.path === "/_api/suggestions/generate").length;
const OWN_FIRST = "What would you tell a friend who wrote this?";
const aiCalls = (from = 0) => calls.slice(from).filter((call) => AI_PATHS.includes(call.path));
const waitFor = async (check, ms = 20000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await page.waitForTimeout(400);
  }
  return false;
};
const waitEditor = async () => {
  await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1);
};
const toToday = async () => {
  await page.waitForFunction(() => /Today/.test(document.body.innerText) && !/Gentle help/.test(document.body.innerText), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
};
// A cold start at a place, as a link would open it.
const openAt = async (path) => {
  await page.goto(`${APP}${path}`, { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(2500);
};

let api;
let noteId = null;
let taskId = null;
const oursNotes = async () => (await api("GET", "/_api/notes/list")).data.notes.filter((note) => note.content.includes("Sage check"));
try {
  await page.goto(`${APP}/`, { waitUntil: "load", timeout: 180000 });
  await press("Continue with email");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await press("Continue");
  await press("Email me a code instead");
  await page.getByLabel("The code from the email", { exact: true }).fill("424242", { timeout: 30000 });
  await page.waitForFunction(() => window.Clerk?.session?.id, null, { timeout: 30000 });
  api = async (method, path, body) => {
    const token = await page.evaluate(() => window.Clerk.session.getToken());
    const response = await fetch(`${LIVE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : superjson.stringify(body) });
    const raw = await response.text();
    try {
      return { status: response.status, data: superjson.parse(raw) };
    } catch {
      return { status: response.status, data: raw };
    }
  };
  const session = await api("GET", "/_api/auth/session");
  if (session.data?.user?.email !== EMAIL) throw new Error(`Signed in as ${session.data?.user?.email ?? "nobody"}, not the test account: stopping before any write.`);
  ok("signed in as the test account", true);
  const before = (await api("GET", "/_api/notes/list")).data.notes.map((note) => ({ id: note.id, title: note.title, content: note.content, updatedAt: String(note.updatedAt) }));

  // The opening screens, skipped: AI help is then asked about once, on its own.
  await page.waitForFunction(() => /Write freely/.test(document.body.innerText), null, { timeout: 60000 });
  await press("Skip");
  ok("skipping the opening screens, AI help is asked about once", await waitFor(async () => /Gentle help/.test(await text())));
  ok("…saying its words go to AI companies that don't keep them or train on them", /don't keep it or use it for training/.test(await text()));
  await page.screenshot({ path: `${OUT}/ask-once.png` });
  await press("Not now");
  await toToday();
  ok("Not now opens the app", /Today/.test(await text()));

  // —— AI help off ——
  const offFrom = calls.length;
  await btn("New note or task").click();
  await page.waitForTimeout(600);
  await btn("New note").click();
  let frame = await waitEditor();
  await frame.locator(".ProseMirror").click();
  await page.keyboard.type(WORDS, { delay: 5 });
  // Long enough a pause that word help would have asked, were it on.
  await page.waitForTimeout(4500);
  ok("off: no word help after a pause", (await chips().count()) === 0);
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(400);
  await press("Done");
  await page.waitForTimeout(5000);
  const made = calls.find((call) => call.path === "/_api/notes/create" && call.body.includes("Sage check: I need"));
  noteId = made ? superjson.parse(made.body).id : null;
  ok("off: the untitled note is saved", !!noteId);
  let ours = await oursNotes();
  ok("off: …and left untitled", ours.length === 1 && ours[0].title === "", JSON.stringify(ours.map((n) => n.title)));

  // Its tasks: no Find tasks, and a word on where AI help is.
  await page.getByRole("tab", { name: "Notes" }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Sage check: I need/ }).first().click();
  await waitEditor();
  await btn("This note's tasks").click();
  await page.waitForTimeout(2500);
  ok("off: a note's tasks have no Find tasks", (await page.getByRole("button", { name: "Find tasks in this note" }).count()) === 0);
  ok("off: …but say that AI help finds them, and where to turn it on", /needs AI help, which is off/.test(await text()));
  await page.screenshot({ path: `${OUT}/off-note-tasks.png` });

  // A task's page and Focus: Sage's own words, nothing asked of an AI.
  // Added from the note, in an area of its own.
  await page.getByRole("button", { name: "Add task", exact: true }).first().click();
  await page.getByRole("textbox", { name: "New task" }).fill(TASK);
  await page.getByRole("button", { name: /^Area:/ }).click();
  await page.getByRole("button", { name: "New area" }).click();
  await page.getByRole("textbox", { name: "New area name" }).fill("Sage check");
  await page.getByRole("textbox", { name: "New area name" }).press("Enter");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Add task", exact: true }).last().click();
  await waitFor(async () => calls.some((call) => call.path === "/_api/tasks/create" && call.body.includes(TASK)));
  const madeTask = calls.find((call) => call.path === "/_api/tasks/create" && call.body.includes(TASK));
  taskId = madeTask ? superjson.parse(madeTask.body).id : null;
  ok("a task is added from the note", !!taskId && superjson.parse(madeTask.body).noteId === noteId);
  // Kept on the phone before the cold starts below.
  await page.waitForTimeout(3000);
  await openAt(`/task/${taskId}`);
  await waitFor(async () => (await text()).includes(TASK));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/off-task.png` });
  await openAt(`/focus/${taskId}`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/off-focus.png` });
  const offAi = aiCalls(offFrom);
  ok("off: nothing at all went to an AI endpoint", offAi.length === 0, offAi.map((call) => call.path).join(", "));

  // —— Turned on in Settings ——
  await openAt("/settings");
  await waitFor(async () => /AI help/.test(await text()));
  ok("off: Settings doesn't offer Learn from my writing", !/Learn from my writing/.test(await text()));
  await page.getByRole("switch", { name: "AI help" }).click();
  await page.waitForTimeout(800);
  ok("Settings turns AI help on", await page.getByRole("switch", { name: "AI help" }).isChecked());
  ok("on: Learn from my writing is offered", /Learn from my writing/.test(await text()));
  await page.screenshot({ path: `${OUT}/settings-on.png` });

  // —— AI help on ——
  // The task page asks how it's going; Focus asks for first steps.
  let from = calls.length;
  await openAt(`/task/${taskId}`);
  ok("on: the task page asks how it's going", await waitFor(async () => calls.slice(from).some((call) => call.path === "/_api/tasks/summary")));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/on-task.png` });
  from = calls.length;
  await openAt(`/focus/${taskId}`);
  ok("on: Focus asks for first steps", await waitFor(async () => calls.slice(from).some((call) => call.path === "/_api/tasks/first_steps")));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/on-focus.png` });

  // The note: more words, then left. It's given a title quietly, and indexed once.
  await openAt("/notes");
  await page.getByRole("button", { name: /Sage check: I need/ }).first().click();
  frame = await waitEditor();
  await frame.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Control+End");
  await page.keyboard.type(MORE, { delay: 5 });
  await page.waitForTimeout(1500);
  from = calls.length;
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(400);
  await press("Done");
  ok("on: leaving an untitled note asks for a title", await waitFor(async () => calls.slice(from).some((call) => call.path === "/_api/notes/suggest_title")));
  ok("on: …and indexes it, once", await waitFor(async () => calls.slice(from).filter((call) => call.path === "/_api/notes/reindex").length === 1));
  const asked = calls.slice(from).find((call) => call.path === "/_api/notes/suggest_title");
  const save = calls.slice(from).find((call) => call.path === "/_api/notes/update" && call.body.includes(noteId) && call.body.includes("spare keys"));
  ok("on: the title is asked after the words are saved", !!save && !!asked && save.at <= asked.at, `save ${save?.at} title ${asked?.at}`);
  ok("on: the note has a title on the server", await waitFor(async () => (await oursNotes())[0]?.title?.trim().length > 0, 20000));
  ours = await oursNotes();
  console.log(`  title given: "${ours[0]?.title}"`);
  ok("on: …and its words are as written", ours[0]?.content?.includes("spare keys"), JSON.stringify(ours[0]?.content));
  await page.waitForTimeout(1500);
  ok("on: the title shows in Notes", ours[0]?.title ? (await text()).includes(ours[0].title) : false);
  await page.screenshot({ path: `${OUT}/on-titled.png` });

  // Its tasks: the first look reads the note.
  from = calls.length;
  await page.getByRole("button", { name: new RegExp(ours[0]?.title ?? "Sage check") }).first().click();
  await waitEditor();
  await btn("This note's tasks").click();
  ok("on: opening a note's tasks reads it for tasks", await waitFor(async () => calls.slice(from).some((call) => call.path === "/_api/tasks/extract")));
  ok("on: …and what it finds arrives as cards (or nothing new)", await waitFor(async () => /Found in this note|No new tasks|Nothing new/.test(await text()), 30000));
  ok("on: Find tasks is there", (await page.getByRole("button", { name: "Find tasks in this note" }).count()) === 1);
  await page.screenshot({ path: `${OUT}/on-note-tasks.png` });
  const extract = calls.slice(from).filter((call) => call.path === "/_api/tasks/extract");
  ok("on: read once, not again and again", extract.length === 1, `${extract.length} reads`);

  // Word help: a pause after some words brings one ask and a strip; a tap puts the words in.
  const prefs = (await api("GET", "/_api/preferences")).data;
  await openAt("/notes");
  await btn("New note or task").click();
  await page.waitForTimeout(600);
  await btn("New note").click();
  frame = await waitEditor();
  await frame.locator(".ProseMirror").click();
  from = calls.length;
  await page.keyboard.type("Sage check: this morning I walked to the market with Sam and we", { delay: 15 });
  await page.waitForTimeout(1200);
  ok("on: nothing is asked while writing", asks(from) === 0);
  ok("on: a pause brings one ask for word help", await waitFor(async () => asks(from) === 1, 10000));
  ok("on: …and a strip of words", await waitFor(async () => (await chips().count()) > 0, 25000));
  await page.screenshot({ path: `${OUT}/on-strip.png` });
  const offeredWords = await chips().evaluateAll((list) => list.map((chip) => chip.getAttribute("aria-label")));
  console.log("  offered:", JSON.stringify(offeredWords));
  const taken = (await chips().first().getAttribute("aria-label"))?.replace(/^Add “|”$/g, "") ?? "";
  await chips().first().click();
  await page.waitForTimeout(1000);
  ok("on: a tap puts the words in", (await words()).toLowerCase().includes(taken.toLowerCase()), JSON.stringify(await words()));
  if (prefs?.usePersonalization !== false) ok("on: words taken are noted, for Learn from my writing", await waitFor(async () => calls.slice(from).some((call) => call.path === "/_api/suggestions/event" && call.body.includes("accepted"))));
  await page.keyboard.type(" and then bought some bread for later", { delay: 15 });
  await page.waitForTimeout(4500);
  ok("on: no second ask so soon after", asks(from) === 1, `${asks(from)} asks`);
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(400);
  await press("Done");
  await page.waitForTimeout(3000);

  // Go deeper on a note opened to read: Sage's own question and no ask; another question asks, once.
  await openAt("/notes");
  from = calls.length;
  await page.getByRole("button", { name: new RegExp(ours[0]?.title ?? "Sage check") }).first().click();
  await waitEditor();
  await page.waitForTimeout(2500);
  ok("on: opening a note to read asks nothing of the AI", aiCalls(from).length === 0, aiCalls(from).map((call) => call.path).join(", "));
  ok("on: Go deeper offers Sage's own question first", (await text()).includes(OWN_FIRST));
  await btn("Another question").click();
  ok("on: another question asks the AI about the note, once", await waitFor(async () => asks(from) === 1, 10000));
  ok("on: …and the AI's question comes", await waitFor(async () => /Go deeper/.test(await text()) && !(await text()).includes(OWN_FIRST) && (await btn("Another question").isVisible().catch(() => false)), 25000));
  await page.screenshot({ path: `${OUT}/on-deeper.png` });
  await btn("Another question").click();
  await page.waitForTimeout(1200);
  ok("on: the next question comes without asking again", asks(from) === 1, `${asks(from)} asks`);
  await btn("Back").click();
  await page.waitForTimeout(2500);
  ok("on: leaving a note unchanged asks nothing more", aiCalls(from).length === 1, aiCalls(from).map((call) => call.path).join(", "));

  // Off again: back to nothing sent.
  await openAt("/settings");
  await page.getByRole("switch", { name: "AI help" }).click();
  await page.waitForTimeout(800);
  from = calls.length;
  await openAt(`/task/${taskId}`);
  await page.waitForTimeout(3000);
  await openAt("/notes");
  await page.getByRole("button", { name: new RegExp(ours[0]?.title ?? "Sage check") }).first().click();
  frame = await waitEditor();
  await frame.locator(".ProseMirror").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Off again, and writing on for long enough to be asked about.", { delay: 5 });
  await page.waitForTimeout(4500);
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(400);
  await press("Done");
  await page.waitForTimeout(5000);
  const offAgain = aiCalls(from);
  ok("turned off again, nothing goes to an AI endpoint", offAgain.length === 0, offAgain.map((call) => call.path).join(", "));

  const after = (await api("GET", "/_api/notes/list")).data.notes.filter((note) => !note.content.includes("Sage check")).map((note) => ({ id: note.id, title: note.title, content: note.content, updatedAt: String(note.updatedAt) }));
  ok("every other note left exactly as it was", JSON.stringify(after) === JSON.stringify(before));
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n")[0]);
  await page.screenshot({ path: `${OUT}/stopped.png` }).catch(() => {});
} finally {
  // Whatever happened, nothing of this run stays on the account.
  if (api) {
    for (const note of await oursNotes().catch(() => [])) await api("POST", "/_api/notes/delete", { id: note.id });
    const listed = await api("GET", "/_api/tasks/list").catch(() => null);
    for (const task of listed?.data?.tasks ?? []) if (task.text.startsWith("Sage check")) await api("POST", "/_api/tasks/delete", { id: task.id });
    for (const area of listed?.data?.projects ?? []) if (area.name === "Sage check") await api("POST", "/_api/projects/delete", { id: area.id });
  }
  const byPath = {};
  for (const call of calls) byPath[call.path] = (byPath[call.path] ?? 0) + 1;
  console.log("  requests:", JSON.stringify(byPath));
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
