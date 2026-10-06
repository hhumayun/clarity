// The note page with the built-in editor, as the TEST account, against the live server (web build).
// Writes a "Sage check: editor" note with formatting, reopens it from the server's copy, ticks a
// checklist row, then deletes it from its menu. Leaves every other item on the account as it was.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const LIVE = "https://clarity-notes-production.up.railway.app";
const APP = "http://localhost:8087";
const OUT = "/root/projects/clarity-design-research/revamp-5/shots/editor";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
mkdirSync(OUT, { recursive: true });
const TITLE = "Sage check: editor";

let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const cors = { "access-control-allow-origin": APP, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };
const writes = [];
await context.route(`${LIVE}/_api/**`, async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (request.method() === "POST") writes.push({ path: new URL(request.url()).pathname, body: request.postData() ?? "" });
  const response = await route.fetch();
  return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (/\[editor\]/.test(m.text())) console.log("  console:", m.text().slice(0, 300)); });
const press = (name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: 30000 });
const btn = (name) => page.getByRole("button", { name, exact: false }).first();
const editorFrame = () => page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1);
const waitEditor = async () => {
  await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return editorFrame();
};

let api;
const ours = async () => (await api("GET", "/_api/notes/list")).data.notes.filter((note) => note.title === TITLE);
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

  await page.waitForFunction(() => /Write freely|Today|Tasks/.test(document.body.innerText), null, { timeout: 30000 });
  if (/Write freely/.test(await page.evaluate(() => document.body.innerText))) await press("Skip");
  await page.waitForTimeout(1500);

  // 1. A new note: title, a checklist and bold words, saved through the outbox.
  await btn("New note or task").click();
  await page.waitForTimeout(600);
  await btn("New note").click();
  let frame = await waitEditor();
  await page.getByLabel("Title").fill(TITLE);
  await frame.locator(".ProseMirror").click();
  await page.waitForTimeout(300);
  await btn("Checklist").click();
  await page.keyboard.type("milk", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("eggs", { delay: 10 });
  await btn("Indent").click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Some ", { delay: 10 });
  await btn("Bold").click();
  await page.keyboard.type("strong", { delay: 10 });
  await btn("Bold").click();
  await page.keyboard.type(" words.", { delay: 10 });
  await page.keyboard.press("Enter");
  await btn("Bulleted list").click();
  await page.keyboard.type("moved in", { delay: 10 });
  // The first item: the whole list moves in, which only the rich text keeps.
  await btn("Indent").click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/account-new.png` });
  // While writing: the note is made once its first words settle, and nothing more is sent.
  const madeBody = writes.find((write) => write.path === "/_api/notes/create" && write.body.includes(TITLE))?.body;
  const madeId = madeBody ? superjson.parse(madeBody).id : null;
  ok("while writing, the note is made on the server", !!madeId);
  ok("…and no saves follow while writing (they wait for the minute or for leaving)", writes.filter((write) => write.path === "/_api/notes/update" && madeId && write.body.includes(madeId)).length === 0);
  ok("no word about saving or syncing on the note page", !/Saved on this phone|Saving|All changes saved/.test(await page.evaluate(() => document.body.innerText)));
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(400);
  await btn("Done").click();
  await page.waitForTimeout(3000);

  ok("leaving sends the words once", writes.filter((write) => write.path === "/_api/notes/update" && madeId && write.body.includes(madeId)).length === 1);
  let saved = await ours();
  ok("the note reached the server, once", saved.length === 1, `${saved.length} found`);
  const id = saved[0]?.id;
  ok("its words went as Markdown", saved[0]?.content === "- [ ] milk\n  - [ ] eggs\n\nSome **strong** words.\n\n- moved in", JSON.stringify(saved[0]?.content));
  let full = (await api("GET", `/_api/notes/get?id=${id}`)).data?.note;
  ok("its rich text went with them, stored as a document (encoded once)", typeof full?.doc === "object" && full.doc?.type === "doc" && JSON.stringify(full.doc).includes("taskList"), `doc=${JSON.stringify(full?.doc)?.slice(0, 80)}`);
  for (const write of writes.filter((w) => w.path.startsWith("/_api/notes/"))) {
    const parsed = (() => { try { return superjson.parse(write.body); } catch { return null; } })();
    console.log("  sent", write.path, parsed ? JSON.stringify({ title: parsed.title, content: parsed.content, doc: parsed.doc ? "yes" : parsed.doc === null ? "null" : "absent", changedAt: !!parsed.changedAt }) : write.body.slice(0, 120));
  }
  const create = writes.find((write) => write.path === "/_api/notes/create" && write.body.includes(TITLE));
  ok("it was made once (later words folded into it or sent as updates)", writes.filter((write) => write.path === "/_api/notes/create" && write.body.includes(TITLE)).length === 1 && !!create);

  // 2. Reopened from Notes: the checklist as it was; ticking a row is saved.
  await page.getByRole("tab", { name: "Notes" }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: new RegExp(`^${TITLE}`) }).first().click();
  frame = await waitEditor();
  ok("reopened, the checklist is there, nested", (await frame.locator('ul[data-type="taskList"] ul[data-type="taskList"] li').count()) === 1);
  ok("…and the list moved in is still in: the rich text was used, not only the Markdown", (await frame.locator('ul[data-indent="1"]').count()) === 1);
  await frame.locator('ul[data-type="taskList"] input[type="checkbox"]').first().click();
  await page.waitForTimeout(2500);
  await btn("Put the keyboard away").click().catch(() => {});
  await page.waitForTimeout(400);
  await btn("Done").click();
  await page.waitForTimeout(3000);
  full = (await api("GET", `/_api/notes/get?id=${id}`)).data?.note;
  ok("the tick reached the server", full?.content?.startsWith("- [x] milk"), JSON.stringify(full?.content));
  const update = writes.filter((write) => write.path === "/_api/notes/update" && write.body.includes(id)).at(-1);
  ok("the update carried the rich text and when it was made", !!update && update.body.includes('"doc"') && update.body.includes("changedAt"));

  // 3. Deleted from its menu: gone from the server.
  await page.getByRole("button", { name: new RegExp(`^${TITLE}`) }).first().click();
  await waitEditor();
  await btn("More: archive or delete this note").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/account-menu.png` });
  await press("Delete");
  await page.waitForTimeout(400);
  await press("Delete");
  await page.waitForTimeout(3000);
  saved = await ours();
  ok("deleted from its menu, it's gone from the server", saved.length === 0, `${saved.length} left`);

  // Everything else on the account as it was.
  const after = (await api("GET", "/_api/notes/list")).data.notes.map((note) => ({ id: note.id, title: note.title, content: note.content, updatedAt: String(note.updatedAt) }));
  ok("every other note left exactly as it was", JSON.stringify(after) === JSON.stringify(before));
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n")[0]);
  await page.screenshot({ path: `${OUT}/account-stopped.png` }).catch(() => {});
} finally {
  // Whatever happened, nothing of this run stays on the account.
  if (api) {
    for (const note of await ours().catch(() => [])) await api("POST", "/_api/notes/delete", { id: note.id });
  }
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
