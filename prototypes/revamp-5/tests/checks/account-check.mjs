// Revamp 5 in account mode, in the web build, as the TEST account only, against the live server.
// The live server doesn't accept the web build's origin (CORS), so Playwright passes the app's API
// requests to it itself. Seeds a few clearly labelled "Sage check" items, screenshots the screens,
// saves two changes through the UI and confirms them on the server, then removes everything it made.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const LIVE = "https://clarity-notes-production.up.railway.app";
const APP = "http://localhost:8087";
const OUT = "/root/projects/clarity-design-research/revamp-5/account";
const scheme = process.env.SCHEME || "light";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
mkdirSync(OUT, { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  ok ? (passed += 1) : (failed += 1);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
const cors = { "access-control-allow-origin": APP, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };
const apiCalls = [];
let listsOpen = false;
await context.route(`${LIVE}/_api/**`, async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  // Until the test account is seeded, the lists are held back, so the app keeps nothing stale on the phone.
  if (!listsOpen && /\/_api\/(tasks\/list|notes\/list|focus\/summary)/.test(route.request().url())) return route.fulfill({ status: 503, headers: cors, body: "{}" });
  apiCalls.push(`${request.method()} ${new URL(request.url()).pathname}`);
  const response = await route.fetch();
  return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let n = 0;
const shot = async (name) => {
  n += 1;
  await page.screenshot({ path: `${OUT}/${String(n).padStart(2, "0")}_${name}_${scheme}.png` });
  console.log(`shot ${name}: ${(await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 200)}`);
};
const press = (name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: 30000 });
const text = () => page.evaluate(() => document.body.innerText);

const created = { notes: [], tasks: [], projects: [] };
let api;
let startCounts = null;
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
  check("signed in as the test account", true);
  startCounts = await (async () => { const t = (await api("GET", "/_api/tasks/list")).data; const n = (await api("GET", "/_api/notes/list")).data; return { tasks: t.tasks.length, areas: t.projects.length, notes: n.notes.length }; })();

  // First run, once per browser: skip it.
  await page.waitForFunction(() => /Write freely|Today/.test(document.body.innerText), null, { timeout: 30000 });
  if (/Write freely/.test(await text())) await press("Skip");
  await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot("today_empty");
  check("a new account's Today is empty, not the samples", !/Walk at lunch|Send the brief to Ana/.test(await text()));

  // A few labelled items on the test account.
  const noon = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(12, 0, 0, 0);
    return d;
  };
  const project = await api("POST", "/_api/projects/create", { id: randomUUID(), name: "Sage check" });
  created.projects.push(project.data.project.id);
  const areaId = project.data.project.id;
  const task = async (text, extra) => {
    const id = randomUUID();
    const made = await api("POST", "/_api/tasks/create", { id, text, projectId: areaId, ...extra });
    created.tasks.push(id);
    return made.data.task;
  };
  await task("Sage check: call the dentist", { completeBy: noon(0), dueTime: "15:00" });
  const water = await task("Sage check: water the plants", { completeBy: noon(0) });
  await task("Sage check: send the brief", { completeBy: noon(1) });
  await task("Sage check: book the car service", { completeBy: noon(-1) });
  const run = await task("Sage check: morning run", { completeBy: noon(0) });
  await api("POST", "/_api/tasks/update", { id: run.id, status: "done" });
  const pageNote = randomUUID();
  await api("POST", "/_api/notes/create", { id: pageNote, title: "", content: "> What would make today feel well spent?\n\nA slow morning, and the dentist at three.", source: "page", projectIds: [areaId] });
  created.notes.push(pageNote);
  const shelves = randomUUID();
  await api("POST", "/_api/notes/create", { id: shelves, title: "Sage check: kitchen shelves", content: "Measure the wall first.\n\n- [ ] Buy brackets\n- [x] Pick the wood\n\nThe oak looked best.", projectIds: [areaId] });
  created.notes.push(shelves);

  // The app fetches again on reload.
  // Seeded: the lists may come now, and the app fetches them fresh.
  listsOpen = true;
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => /dentist/.test(document.body.innerText), null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot("today");
  const today = await text();
  check("Today shows the account's tasks for today", /Sage check: call the dentist/.test(today) && /Sage check: water the plants/.test(today));
  check("Today's done task sits in Done, not the list", !/Mark Sage check: morning run done/.test(await page.content()));
  check("the day's page counts as written", /written|Read today/i.test(today) || !/Still up\?|What would make today/.test(today.split("Tasks")[0] ?? ""), today.split("Tasks")[0]?.replace(/\s+/g, " ").slice(0, 120));
  check("a slipped task offers Catch up", /Catch up/.test(today));

  // Moving by taps, as a person would: reloading the whole app per screen runs the tab out of memory here.
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.waitForTimeout(2000);
  await shot("notes");
  check("Notes lists the account's notes", /kitchen shelves/i.test(await text()));

  await page.getByRole("button", { name: /kitchen shelves/ }).first().click();
  await page.waitForTimeout(2000);
  await shot("note");
  const note = await text();
  check("a note opens with its words and checklist", /Measure the wall first/.test(note) && /Buy brackets/.test(note) && /The oak looked best/.test(note));

  await page.getByRole("button", { name: "Back" }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("tab", { name: "Life" }).click();
  await page.waitForTimeout(2000);
  await shot("life");
  check("Life Center groups the account's tasks", /send the brief/i.test(await text()) && /A few things slipped/.test(await text()));

  await page.getByRole("tab", { name: "Search" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("searchbox").or(page.locator("input")).first().fill("dentist");
  await page.waitForTimeout(1500);
  await shot("search");
  check("Search finds the account's note and task", /call the dentist/i.test(await text()) && /slow morning/i.test(await text()));

  await page.getByRole("tab", { name: "Today" }).click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.waitForTimeout(2000);
  await shot("settings");
  check("Settings says the test account saves, and has no sample reset", /A test account\./.test(await text()) && !/Reset sample data/.test(await text()));

  // Two changes through the UI, confirmed on the server.
  await page.getByRole("button", { name: "Done", exact: true }).first().click();
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => /water the plants/.test(document.body.innerText), null, { timeout: 30000 });
  await page.getByRole("checkbox", { name: "Mark Sage check: water the plants done" }).click();
  let saved = false;
  for (let i = 0; i < 20 && !saved; i++) {
    await page.waitForTimeout(500);
    const list = await api("GET", "/_api/tasks/list");
    saved = list.data.tasks.some((t) => t.id === water.id && t.status === "done");
  }
  check("ticking a task saves it on the server", saved);

  await page.getByRole("button", { name: "Add task", exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("textbox", { name: "New task" }).fill("Sage check: added in the app");
  await page.waitForTimeout(300);
  // Today's own "Add task" is under the sheet; the sheet's comes last.
  await page.getByRole("button", { name: "Add task", exact: true }).last().click({ timeout: 30000 });
  let added = null;
  for (let i = 0; i < 20 && !added; i++) {
    await page.waitForTimeout(500);
    const list = await api("GET", "/_api/tasks/list");
    added = list.data.tasks.find((t) => t.text === "Sage check: added in the app") ?? null;
  }
  if (added) created.tasks.push(added.id);
  check("a task added in the app reaches the server", !!added, added ? `in ${added.projectName}` : "");
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (error) {
  failed += 1;
  console.log("STOPPED", error.message.split("\n")[0]);
  await shot("stopped").catch(() => {});
}
// Everything made here goes, so the test account is left as it was.
if (api) {
  const all = await api("GET", "/_api/tasks/list").catch(() => null);
  for (const t of all?.data?.tasks ?? []) if (t.text.startsWith("Sage check") && !created.tasks.includes(t.id)) created.tasks.push(t.id);
  for (const id of created.tasks) await api("POST", "/_api/tasks/delete", { id }).catch(() => {});
  for (const id of created.notes) await api("POST", "/_api/notes/delete", { id }).catch(() => {});
  for (const id of created.projects) await api("POST", "/_api/projects/delete", { id }).catch(() => {});
  const after = await api("GET", "/_api/tasks/list").catch(() => null);
  const notesAfter = await api("GET", "/_api/notes/list").catch(() => null);
  const now = { tasks: after?.data?.tasks?.length, areas: after?.data?.projects?.length, notes: notesAfter?.data?.notes?.length };
  check("the test account is left as it was", !!startCounts && now.tasks === startCounts.tasks && now.areas === startCounts.areas && now.notes === startCounts.notes, `tasks ${now.tasks}/${startCounts?.tasks}, areas ${now.areas}/${startCounts?.areas}, notes ${now.notes}/${startCounts?.notes}`);
}
console.log(`API calls the app made: ${[...new Set(apiCalls)].join(", ")}`);
await browser.close();
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
