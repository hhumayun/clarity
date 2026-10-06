// Removes what the tests made ("Sage check…" tasks and notes, "Sage check" and "Sage remap" areas) from the TEST account.
// Never anything else: the account also holds the user's own test items. Aborts unless signed in as the +clerk_test address.
import { createRequire } from "node:module";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const LIVE = "https://clarity-notes-production.up.railway.app";
const APP = "http://localhost:8087";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL?.includes("+clerk_test@")) throw new Error("not the test account");
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
await context.route(`${LIVE}/_api/**`, (route) => route.fulfill({ status: 503, body: "{}" }));
const page = await context.newPage();
const press = (name) => page.getByRole("button", { name, exact: true }).last().click({ timeout: 30000 });
await page.goto(`${APP}/`, { waitUntil: "load", timeout: 180000 });
await press("Continue with email");
await page.getByLabel("Email", { exact: true }).fill(EMAIL);
await press("Continue");
await press("Email me a code instead");
await page.getByLabel("The code from the email", { exact: true }).fill("424242");
await page.waitForFunction(() => window.Clerk?.session?.id, null, { timeout: 30000 });
const call = async (method, path, body) => {
  const token = await page.evaluate(() => window.Clerk.session.getToken());
  return superjson.parse(await (await fetch(`${LIVE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? superjson.stringify(body) : undefined })).text());
};
const session = await call("GET", "/_api/auth/session");
if (session.user?.email !== EMAIL) throw new Error(`signed in as ${session.user?.email}: stopping`);
const tasks = await call("GET", "/_api/tasks/list");
const notes = await call("GET", "/_api/notes/list");
console.log(`found ${tasks.tasks.length} tasks, ${tasks.projects.length} areas, ${notes.notes.length} notes`);
const ours = (text) => /^Sage check/.test(text);
for (const t of tasks.tasks) if (ours(t.text)) await call("POST", "/_api/tasks/delete", { id: t.id });
for (const n of notes.notes) if (/Sage check/.test(n.title) || /Sage check/.test(n.content)) await call("POST", "/_api/notes/delete", { id: n.id });
for (const p of tasks.projects) if (/^Sage (check|remap)/.test(p.name)) await call("POST", "/_api/projects/delete", { id: p.id });
const after = await call("GET", "/_api/tasks/list");
const notesAfter = await call("GET", "/_api/notes/list");
console.log(`left ${after.tasks.length} tasks, ${after.projects.length} areas, ${notesAfter.notes.length} notes`);
await browser.close();
