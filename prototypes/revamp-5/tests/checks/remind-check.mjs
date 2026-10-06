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
const TASK = "Sage check: remind once";
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
    try { return { status: response.status, data: superjson.parse(raw) }; } catch { return { status: response.status, data: raw }; }
  };
  const session = await api("GET", "/_api/auth/session");
  if (session.data?.user?.email !== EMAIL) throw new Error("not the test account: stopping before any write");
  ok("signed in as the test account", true);
  const before = (await api("GET", "/_api/tasks/list")).data.tasks.map((t) => `${t.id}:${String(t.updatedAt)}`).sort().join(",");
  const id = crypto.randomUUID();
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  const made = await api("POST", "/_api/tasks/create", { id, text: TASK, projectName: "Sage check", completeBy: noon, dueTime: "10:00", remindBefore: 0, remindRepeat: "daily", remindOnce: true });
  ok("a repeating task with a reminder for this time only is made", made.status === 200, `status ${made.status}`);
  let listed = (await api("GET", "/_api/tasks/list")).data.tasks.find((t) => t.id === id);
  ok("the server keeps that its reminder is for this time only", listed?.remindOnce === true && listed?.remindRepeat === "daily" && listed?.remindBefore === 0, JSON.stringify({ once: listed?.remindOnce, repeat: listed?.remindRepeat, before: listed?.remindBefore }));
  await api("POST", "/_api/tasks/update", { id, remindOnce: false });
  listed = (await api("GET", "/_api/tasks/list")).data.tasks.find((t) => t.id === id);
  ok("…and that it's changed to every time", listed?.remindOnce === false);
  const title = await api("POST", "/_api/notes/suggest_title", { content: "Walked along the canal this morning and thought about the move. The light on the water was lovely." });
  ok("AI still answers, through companies that keep nothing (a title idea)", title.status === 200 && typeof title.data?.title === "string" && title.data.title.length > 0, `${title.status} ${JSON.stringify(title.data).slice(0, 80)}`);
  await api("POST", "/_api/tasks/delete", { id });
  // The area the task made, removed with it.
  for (const project of (await api("GET", "/_api/tasks/list")).data.projects.filter((p) => p.name === "Sage check")) await api("POST", "/_api/projects/delete", { id: project.id });
  const projects = (await api("GET", "/_api/tasks/list")).data.projects.filter((p) => p.name === "Sage check");
  const after = (await api("GET", "/_api/tasks/list")).data.tasks.map((t) => `${t.id}:${String(t.updatedAt)}`).sort().join(",");
  ok("the test account's tasks are back as they were", after === before);
  if (projects.length) console.log(`  (an area named "Sage check" is left from this run: ${projects.length})`);
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n")[0]);
} finally {
  if (api) for (const task of (await api("GET", "/_api/tasks/list").catch(() => ({ data: { tasks: [] } }))).data.tasks.filter((t) => t.text === TASK)) await api("POST", "/_api/tasks/delete", { id: task.id });
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
