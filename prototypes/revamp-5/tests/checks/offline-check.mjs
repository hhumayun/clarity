// Phase 4's offline checks, in the web build, as the TEST account only, against the live server.
// 1. Airplane mode: tick, Catch up, add a task and write today's page offline; on reconnecting each
//    change arrives once, keeping the time it was made, and Catch up's move keeps its moved-from day.
// 2. A restart while the server can't be reached: nothing is lost, and it all goes once it can.
// 3. An area made offline that the server already has: the task lands in the server's area.
// Playwright passes the app's API requests to the live server itself (its CORS list lacks the web build).
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const LIVE = "https://clarity-notes-production.up.railway.app";
const APP = "http://localhost:8087";
const OUT = "/root/projects/clarity-design-research/revamp-5/offline";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
mkdirSync(OUT, { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  ok ? (passed += 1) : (failed += 1);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const cors = { "access-control-allow-origin": APP, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };
let serverReachable = true;
let listsOpen = false;
await context.route(`${LIVE}/_api/**`, async (route) => {
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  // Until the test account is seeded, the lists are held back, so the app keeps nothing stale on the phone.
  if (!listsOpen && /\/_api\/(tasks\/list|notes\/list|focus\/summary)/.test(route.request().url())) return route.fulfill({ status: 503, headers: cors, body: "{}" });
  if (!serverReachable) return route.abort("internetdisconnected");
  const response = await route.fetch();
  return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let n = 0;
const shot = async (name) => {
  n += 1;
  await page.screenshot({ path: `${OUT}/${String(n).padStart(2, "0")}_${name}.png` });
};
const text = () => page.evaluate(() => document.body.innerText);
const press = (name) => page.getByRole("button", { name, exact: true }).last().click({ timeout: 30000 });
const waitText = (pattern, timeout = 30000) => page.waitForFunction((source) => new RegExp(source).test(document.body.innerText), pattern.source, { timeout });

const made = { notes: [], tasks: [], projects: [] };
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
    return { status: response.status, data: superjson.parse(await response.text()) };
  };
  const session = await api("GET", "/_api/auth/session");
  if (session.data?.user?.email !== EMAIL) throw new Error(`Signed in as ${session.data?.user?.email ?? "nobody"}, not the test account: stopping before any write.`);
  check("signed in as the test account", true);
  startCounts = await (async () => { const t = (await api("GET", "/_api/tasks/list")).data; const n = (await api("GET", "/_api/notes/list")).data; return { tasks: t.tasks.length, areas: t.projects.length, notes: n.notes.length }; })();
  const tasksNow = async () => (await api("GET", "/_api/tasks/list")).data;

  // Seed: an area, a task for today, one that slipped.
  const noon = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(12, 0, 0, 0);
    return d;
  };
  const area = (await api("POST", "/_api/projects/create", { id: randomUUID(), name: "Sage check" })).data.project;
  made.projects.push(area.id);
  const water = randomUUID();
  await api("POST", "/_api/tasks/create", { id: water, text: "Sage check: water the plants", projectId: area.id, completeBy: noon(0) });
  const car = randomUUID();
  await api("POST", "/_api/tasks/create", { id: car, text: "Sage check: book the car service", projectId: area.id, completeBy: noon(-1) });
  made.tasks.push(water, car);

  await page.waitForFunction(() => /Write freely|Tasks/.test(document.body.innerText), null, { timeout: 30000 });
  if (/Write freely/.test(await text())) await press("Skip");
  // Then AI help, asked about once (2026-10-06): off for these checks.
  await page.waitForFunction(() => /Gentle help|Tasks/.test(document.body.innerText), null, { timeout: 30000 });
  if (/Gentle help/.test(await text())) await press("Not now");
  // Seeded: the lists may come now, and the app fetches them fresh.
  listsOpen = true;
  await page.reload({ waitUntil: "load" });
  await waitText(/water the plants/);
  await page.waitForTimeout(1500);

  // 1. Airplane mode.
  await context.setOffline(true);
  await waitText(/Offline\. Changes will sync\./, 8000).catch(() => {});
  check("going offline says so, quietly", /Offline\. Changes will sync\./.test(await text()));
  await shot("offline_notice");

  const tickedAt = new Date();
  await page.getByRole("checkbox", { name: "Mark Sage check: water the plants done" }).click();
  await page.waitForTimeout(1800);
  check("a tick shows at once, offline", !(await page.getByRole("checkbox", { name: "Mark Sage check: water the plants done" }).count()));

  await page.getByRole("button", { name: "Catch up on what slipped" }).first().click({ timeout: 30000 });
  await page.waitForTimeout(800);
  // Only the test's own task is moved: anything else on the account (the user's own test items) is skipped.
  for (let i = 0; i < 8 && !/book the car service/.test(await text()); i++) {
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.waitForTimeout(700);
  }
  await waitText(/book the car service/);
  const movedAt = new Date();
  await page.getByRole("button", { name: "Tomorrow", exact: true }).click();
  await page.waitForTimeout(1500);
  await shot("catch_up_offline");
  await page.getByRole("button", { name: /Close|Done|Back to Today/ }).first().click().catch(() => {});
  await page.waitForTimeout(1200);

  await press("Add task");
  await page.getByRole("textbox", { name: "New task" }).fill("Sage check: added offline");
  await page.waitForTimeout(300);
  await press("Add task");
  await page.waitForTimeout(1500);
  check("a task added offline shows at once", /Sage check: added offline/.test(await text()));

  await page.getByRole("button", { name: /Today's page|What can you set down|Still up|What would make|Good (morning|afternoon|evening)/ }).first().click();
  // Today's page opens in the editor with the cursor under its question.
  await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror blockquote"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.keyboard.type("Sage check: written on a plane.", { delay: 5 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Put the keyboard away" }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await press("Done");
  await page.waitForTimeout(1500);
  await shot("today_offline");
  const unsentMarks = await page.getByLabel("Not sent yet").count();
  check("things not yet sent carry a small cloud", unsentMarks > 0, `${unsentMarks} marked`);

  await sleep(6000);
  const before = await tasksNow();
  check("nothing reached the server while offline", before.tasks.find((t) => t.id === water)?.status !== "done" && !before.tasks.some((t) => t.text === "Sage check: added offline"));

  const backAt = new Date();
  await context.setOffline(false);
  let after = null;
  for (let i = 0; i < 40; i++) {
    await sleep(750);
    after = await tasksNow();
    const ok = after.tasks.find((t) => t.id === water)?.status === "done" && after.tasks.some((t) => t.text === "Sage check: added offline") && after.tasks.find((t) => t.id === car)?.movedFrom;
    if (ok) break;
  }
  const w = after.tasks.find((t) => t.id === water);
  const c = after.tasks.find((t) => t.id === car);
  const added = after.tasks.filter((t) => t.text === "Sage check: added offline");
  for (const t of added) made.tasks.push(t.id);
  check("the tick arrived", w?.status === "done");
  check("the tick kept the time it was made, not when it arrived", w && Math.abs(new Date(w.updatedAt) - tickedAt) < 4000 && new Date(w.updatedAt) < backAt, `made ${tickedAt.toISOString()}, kept ${w && new Date(w.updatedAt).toISOString()}, back online ${backAt.toISOString()}`);
  check("the done time is when it was ticked", w && Math.abs(new Date(w.completedAt) - tickedAt) < 4000);
  check("Catch up's move arrived with its moved-from day", c && new Date(c.completeBy).toDateString() === noon(1).toDateString() && c.movedFrom && new Date(c.movedFrom).toDateString() === noon(-1).toDateString());
  check("Catch up's move kept its time", c && Math.abs(new Date(c.updatedAt) - movedAt) < 5000);
  check("the task added offline arrived once", added.length === 1);
  const notes = (await api("GET", "/_api/notes/list")).data.notes;
  const pageNote = notes.find((note) => note.content.includes("written on a plane"));
  if (pageNote) made.notes.push(pageNote.id);
  check("today's page written offline arrived, as a page", pageNote?.source === "page" && /^> /.test(pageNote.content));
  await waitText(/All changes saved/, 8000).catch(() => {});
  check("back online, it says everything is saved", /All changes saved/.test(await text()));

  // 2. A restart while the server can't be reached.
  serverReachable = false;
  await press("Add task");
  await page.getByRole("textbox", { name: "New task" }).fill("Sage check: survives a restart");
  await page.waitForTimeout(300);
  await press("Add task");
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "load" });
  await waitText(/survives a restart/, 30000).catch(() => {});
  await page.waitForTimeout(1500);
  check("after a restart with no server, the change is still there", /survives a restart/.test(await text()));
  await shot("after_restart");
  serverReachable = true;
  // The outbox tries again when the connection comes back.
  await context.setOffline(true);
  await sleep(500);
  await context.setOffline(false);
  let survived = [];
  for (let i = 0; i < 40 && survived.length === 0; i++) {
    await sleep(750);
    survived = (await tasksNow()).tasks.filter((t) => t.text === "Sage check: survives a restart");
  }
  for (const t of survived) made.tasks.push(t.id);
  check("once the server is back, it arrives once", survived.length === 1);

  // 3. An area made offline that the server already has.
  const remap = (await api("POST", "/_api/projects/create", { id: randomUUID(), name: "Sage remap" })).data.project;
  made.projects.push(remap.id);
  await context.setOffline(true);
  await press("Add task");
  await page.getByRole("textbox", { name: "New task" }).fill("Sage check: in the remap area");
  await page.getByRole("button", { name: /^Area: / }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "New area" }).click();
  await page.getByLabel("New area name").fill("Sage remap");
  await page.getByLabel("New area name").press("Enter");
  await page.waitForTimeout(500);
  await press("Add task");
  await page.waitForTimeout(1200);
  await context.setOffline(false);
  let landed = null;
  for (let i = 0; i < 40 && !landed; i++) {
    await sleep(750);
    landed = (await tasksNow()).tasks.find((t) => t.text === "Sage check: in the remap area") ?? null;
  }
  if (landed) made.tasks.push(landed.id);
  const remapAreas = (await tasksNow()).projects.filter((p) => p.name === "Sage remap");
  check("a task in an area made offline lands in the server's area of that name", landed?.projectId === remap.id && remapAreas.length === 1, `task in ${landed?.projectId}, server's ${remap.id}, ${remapAreas.length} area(s) of that name`);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (error) {
  failed += 1;
  console.log("STOPPED", error.message.split("\n")[0]);
  await shot("stopped").catch(() => {});
}
// Leave the test account as it was.
if (api) {
  serverReachable = true;
  await context.setOffline(false).catch(() => {});
  const all = await api("GET", "/_api/tasks/list").catch(() => null);
  for (const t of all?.data?.tasks ?? []) if (/^Sage check/.test(t.text) && !made.tasks.includes(t.id)) made.tasks.push(t.id);
  for (const p of all?.data?.projects ?? []) if (/^Sage (check|remap)/.test(p.name) && !made.projects.includes(p.id)) made.projects.push(p.id);
  const notes = await api("GET", "/_api/notes/list").catch(() => null);
  for (const note of notes?.data?.notes ?? []) if (/Sage check/.test(note.content) && !made.notes.includes(note.id)) made.notes.push(note.id);
  for (const id of made.tasks) await api("POST", "/_api/tasks/delete", { id }).catch(() => {});
  for (const id of made.notes) await api("POST", "/_api/notes/delete", { id }).catch(() => {});
  for (const id of made.projects) await api("POST", "/_api/projects/delete", { id }).catch(() => {});
  const left = await api("GET", "/_api/tasks/list").catch(() => null);
  const leftNotes = await api("GET", "/_api/notes/list").catch(() => null);
  const now = { tasks: left?.data?.tasks?.length, areas: left?.data?.projects?.length, notes: leftNotes?.data?.notes?.length };
  check("the test account is left as it was", !!startCounts && now.tasks === startCounts.tasks && now.areas === startCounts.areas && now.notes === startCounts.notes, `tasks ${now.tasks}/${startCounts?.tasks}, areas ${now.areas}/${startCounts?.areas}, notes ${now.notes}/${startCounts?.notes}`);
}
await browser.close();
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
