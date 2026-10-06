// Exercises migration 014's API changes against a server (local by default, API=live for the deployed one), as the TEST account only.
// Signs in through revamp 5's web build with Clerk's test code, takes session tokens from Clerk, and
// cleans up everything it creates. Aborts before any write unless the account is the test address.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

// API=live checks the deployed server; otherwise the local one, or any address given.
const API = process.env.API === "live" ? "https://clarity-notes-production.up.railway.app" : process.env.API || "http://localhost:3334";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
const near = (a, b, ms = 2000) => a && b && Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= ms;

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 } })).newPage();
const created = { notes: [], tasks: [], projects: [] };
let api;
try {
  // Sign in as the test account: email, "Email me a code instead", Clerk's test code.
  await page.goto("http://localhost:8087/", { waitUntil: "load", timeout: 180000 });
  await page.getByRole("button", { name: "Continue with email", exact: true }).click({ timeout: 60000 });
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Email me a code instead", exact: true }).click({ timeout: 30000 });
  await page.getByLabel("The code from the email", { exact: true }).fill("424242", { timeout: 30000 });
  await page.waitForFunction(() => window.Clerk?.session?.id, null, { timeout: 30000 });

  api = async (method, path, body) => {
    const token = await page.evaluate(() => window.Clerk.session.getToken());
    const response = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : superjson.stringify(body) });
    const text = await response.text();
    let data;
    try {
      data = superjson.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data };
  };

  // The hard stop: never write to any account but the test one.
  const session = await api("GET", "/_api/auth/session");
  const email = session.data?.user?.email;
  if (email !== EMAIL) throw new Error(`Signed in as ${email ?? "nobody"}, not the test account: stopping before any write.`);
  check("signed in as the test account", true, email);
  const before = await api("GET", "/_api/tasks/list");
  const beforeNotes = await api("GET", "/_api/notes/list");
  const projectsBefore = new Set(before.data.projects.map((project) => project.id));

  // Today's page: a note can be the day's page.
  const pageId = randomUUID();
  const made = await api("POST", "/_api/notes/create", { id: pageId, title: "Sage check: today's page", content: "> What would make today feel well spent?\n\nA slow morning.", source: "page" });
  created.notes.push(pageId);
  check("a note can be made as the day's page", made.status === 200 && made.data.note?.source === "page", `status ${made.status}, source ${made.data.note?.source}`);

  // When a task was done, and the day it moved from.
  const taskId = randomUUID();
  const task = await api("POST", "/_api/tasks/create", { id: taskId, text: "Sage check: a task", projectName: "Sage checks" });
  created.tasks.push(taskId);
  if (task.data.task?.projectId && !projectsBefore.has(task.data.task.projectId)) created.projects.push(task.data.task.projectId);
  check("a new task has no done time and no moved-from day", task.status === 200 && task.data.task.completedAt === null && task.data.task.movedFrom === null, `status ${task.status}`);

  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
  const done = await api("POST", "/_api/tasks/update", { id: taskId, status: "done", changedAt: tenMinutesAgo });
  check("done offline 10 minutes ago keeps that time", near(done.data.task?.completedAt, tenMinutesAgo) && near(done.data.task?.updatedAt, tenMinutesAgo), `completedAt ${done.data.task?.completedAt?.toISOString?.()}`);

  const again = await api("POST", "/_api/tasks/update", { id: taskId, status: "done", changedAt: new Date(Date.now() - 60_000) });
  check("done again (a replayed change) doesn't move the done time", near(again.data.task?.completedAt, tenMinutesAgo));

  const reopened = await api("POST", "/_api/tasks/update", { id: taskId, status: "todo" });
  check("reopening clears the done time", reopened.data.task?.completedAt === null);

  const noon = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(12, 0, 0, 0);
    return d;
  };
  const moved = await api("POST", "/_api/tasks/update", { id: taskId, completeBy: noon(1), movedFrom: noon(0) });
  check("a move keeps the day it moved from", near(moved.data.task?.movedFrom, noon(0)) && near(moved.data.task?.completeBy, noon(1)));

  const future = await api("POST", "/_api/tasks/update", { id: taskId, text: "Sage check: a task, renamed", changedAt: new Date(Date.now() + 3_600_000) });
  check("an edit time in the future is held to now", new Date(future.data.task?.updatedAt).getTime() <= Date.now() + 2000);

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
  const edited = await api("POST", "/_api/notes/update", { id: pageId, content: "> What would make today feel well spent?\n\nA slow morning, and a walk.", changedAt: fiveMinutesAgo });
  check("a note edited offline 5 minutes ago keeps that time", near(edited.data.note?.updatedAt, fiveMinutesAgo), `updatedAt ${edited.data.note?.updatedAt?.toISOString?.()}`);

  // Find tasks' suggestions, kept until decided.
  const errandsId = randomUUID();
  await api("POST", "/_api/notes/create", { id: errandsId, title: "Sage check: errands", content: "Tomorrow I need to call the dentist about the crown. I should also buy a birthday card for Sam, and email Ana the brief by Friday." });
  created.notes.push(errandsId);
  const found = await api("POST", "/_api/tasks/extract", { noteId: errandsId });
  const offered = found.data.suggested ?? [];
  check("Find tasks offers suggestions", found.status === 200 && offered.length >= 2, `${offered.length} offered: ${offered.map((s) => s.text).join(" | ")}`);

  const texts = (list) => (list ?? []).map((item) => item.text).sort().join(" | ");
  const listed = await api("GET", `/_api/tasks/list?noteId=${errandsId}`);
  check("the note's tasks come with its undecided suggestions", texts(listed.data.pending) === texts(offered));

  const unchanged = await api("POST", "/_api/tasks/extract", { noteId: errandsId });
  check("an unchanged note offers them again, not 'nothing new'", unchanged.data.unchanged === false && texts(unchanged.data.suggested) === texts(offered));

  if (offered.length >= 2) {
    const [notNow, chosen] = offered;
    const dismissed = await api("POST", "/_api/tasks/dismiss_suggestion", { noteId: errandsId, text: notNow.text });
    const afterDismiss = await api("GET", `/_api/tasks/list?noteId=${errandsId}`);
    check("Not now takes a suggestion away", dismissed.data.dismissed === true && !afterDismiss.data.pending.some((item) => item.text === notNow.text));

    const added = await api("POST", "/_api/tasks/add", { noteId: errandsId, tasks: [chosen] });
    for (const t of added.data.tasks ?? []) {
      created.tasks.push(t.id);
      if (!projectsBefore.has(t.projectId) && !created.projects.includes(t.projectId)) created.projects.push(t.projectId);
    }
    const afterAdd = await api("GET", `/_api/tasks/list?noteId=${errandsId}`);
    check("an added suggestion becomes a task and stops waiting", added.data.added === 1 && afterAdd.data.tasks.some((t) => t.text === chosen.text.trim().replace(/\s+/g, " ")) && !afterAdd.data.pending.some((item) => item.text === chosen.text));

    await api("POST", "/_api/notes/update", { id: errandsId, content: "Tomorrow I need to call the dentist about the crown. I should also buy a birthday card for Sam, and email Ana the brief by Friday. And water the plants." });
    const fresh = await api("POST", "/_api/tasks/extract", { noteId: errandsId });
    const freshTexts = (fresh.data.suggested ?? []).map((item) => item.text.toLowerCase());
    check("after an edit, a fresh look leaves out what was dismissed or added", fresh.status === 200 && !freshTexts.includes(notNow.text.toLowerCase()) && !freshTexts.includes(chosen.text.toLowerCase()), freshTexts.join(" | "));
  }

  // Back to how the test account was.
  for (const id of created.tasks) await api("POST", "/_api/tasks/delete", { id });
  for (const id of created.notes) await api("POST", "/_api/notes/delete", { id });
  for (const id of created.projects) await api("POST", "/_api/projects/delete", { id });
  const after = await api("GET", "/_api/tasks/list");
  const afterNotes = await api("GET", "/_api/notes/list");
  check("the test account is back as it was", after.data.tasks.length === before.data.tasks.length && after.data.projects.length === before.data.projects.length && afterNotes.data.notes.length === beforeNotes.data.notes.length, `tasks ${after.data.tasks.length}/${before.data.tasks.length}, projects ${after.data.projects.length}/${before.data.projects.length}, notes ${afterNotes.data.notes.length}/${beforeNotes.data.notes.length}`);
} catch (error) {
  failed += 1;
  console.log("STOPPED", error.message.split("\n")[0]);
  if (api) {
    for (const id of created.tasks) await api("POST", "/_api/tasks/delete", { id }).catch(() => {});
    for (const id of created.notes) await api("POST", "/_api/notes/delete", { id }).catch(() => {});
    for (const id of created.projects) await api("POST", "/_api/projects/delete", { id }).catch(() => {});
  }
}
await browser.close();
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
