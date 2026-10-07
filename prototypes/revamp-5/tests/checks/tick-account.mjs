// Ticking a task as the TEST account, in the web build (UX phase 4, T2, 2026-10-07): the change goes to
// the server and comes back a moment later, and the row must stay ticked meanwhile, never showing
// un-ticked for a frame as it leaves. The server's answer is held back 600 ms to widen the window.
// Writes one "Sage check" area and task, and removes them.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const LIVE = "https://clarity-notes-production.up.railway.app";
const APP = "http://localhost:8087";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
const TITLE = "Sage check: tick and hold";

let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const cors = { "access-control-allow-origin": APP, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };
// Until the task is made, the lists are held back, so the app keeps nothing stale (a reload uses what it kept).
let listsOpen = false;
await context.route(`${LIVE}/_api/**`, async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (!listsOpen && /\/_api\/(tasks\/list|notes\/list|focus\/summary)/.test(request.url())) return route.fulfill({ status: 503, headers: cors, body: "{}" });
  const response = await route.fetch();
  // The tick's answer, held back: a slow connection.
  if (new URL(request.url()).pathname === "/_api/tasks/update") await new Promise((resolve) => setTimeout(resolve, 600));
  return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const press = (name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: 30000 });
const text = () => page.evaluate(() => document.body.innerText);

let api;
const made = { area: null, task: null };
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
  if (session.data?.user?.email !== EMAIL) throw new Error("not the test account: stopping before any write");
  ok("signed in as the test account", true);

  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  const area = await api("POST", "/_api/projects/create", { id: randomUUID(), name: "Sage check" });
  if (area.status !== 200) throw new Error(`area not made: ${area.status} ${JSON.stringify(area.data).slice(0, 160)}`);
  made.area = area.data.project.id;
  made.task = randomUUID();
  const task = await api("POST", "/_api/tasks/create", { id: made.task, text: TITLE, projectId: made.area, completeBy: noon });
  if (task.status !== 200) throw new Error(`task not made: ${task.status} ${JSON.stringify(task.data).slice(0, 160)}`);
  listsOpen = true;

  await page.waitForFunction(() => /Write freely|Today/.test(document.body.innerText), null, { timeout: 60000 });
  if (/Write freely/.test(await text())) {
    await press("Skip");
    await page.waitForTimeout(1500);
    if (/Gentle help/.test(await text())) await press("Not now");
  }
  await page.goto(`${APP}/`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction((title) => document.body.innerText.includes(title), TITLE, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const watch = page.evaluate(
    (title) =>
      new Promise((resolve) => {
        const out = [];
        const start = performance.now();
        const frame = () => {
          const row = document.querySelector(`[data-testid="today"] [aria-label="Mark ${title} done"], [data-testid="today"] [aria-label="Mark ${title} not done"]`);
          out.push(row ? row.getAttribute("aria-checked") : null);
          if (performance.now() - start < 3500) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    TITLE,
  );
  await page.locator(`[data-testid="today"] [aria-label="Mark ${TITLE} done"]`).first().click();
  const seen = await watch;
  const states = seen.filter((v, i, list) => v !== list[i - 1]);
  ok("ticked, the row stays ticked until it's gone (never un-ticked as the server's answer comes)", JSON.stringify(states.slice(states.indexOf("true"))) === JSON.stringify(["true", null]), JSON.stringify(states));
  ok("…and the task is done on the server", await (async () => {
    for (let i = 0; i < 10; i++) {
      const listed = await api("GET", "/_api/tasks/list");
      if (listed.data.tasks.find((task) => task.id === made.task)?.status === "done") return true;
      await page.waitForTimeout(500);
    }
    return false;
  })());
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n")[0]);
  console.log("  on screen:", (await text().catch(() => "")).replace(/\n+/g, " | ").slice(0, 300));
  if (api && made.task) {
    const listed = await api("GET", "/_api/tasks/list").catch(() => null);
    const ours = listed?.data?.tasks?.find((task) => task.id === made.task);
    console.log("  on the server:", JSON.stringify(ours ? { text: ours.text, status: ours.status, completeBy: ours.completeBy, projectId: ours.projectId } : null));
  }
} finally {
  if (api) {
    if (made.task) await api("POST", "/_api/tasks/delete", { id: made.task }).catch(() => {});
    if (made.area) await api("POST", "/_api/projects/delete", { id: made.area }).catch(() => {});
  }
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
