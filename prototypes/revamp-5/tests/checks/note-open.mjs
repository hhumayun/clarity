// Opening a note, frame by frame, as the TEST account against the live server (web build): its title
// is there from the note page's first frame (not the "Title" placeholder first), Go deeper is there from
// the start rather than popping in under the words, and the words fade in without moving. Writes one
// "Sage check: opening" note and removes it.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const LIVE = "https://clarity-notes-production.up.railway.app";
const APP = "http://localhost:8087";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
const TITLE = "Sage check: opening";

let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const cors = { "access-control-allow-origin": APP, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };
await context.route(`${LIVE}/_api/**`, async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const response = await route.fetch();
  return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const press = (name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: 30000 });

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
    return { status: response.status, data: superjson.parse(await response.text()) };
  };
  const session = await api("GET", "/_api/auth/session");
  if (session.data?.user?.email !== EMAIL) throw new Error(`Signed in as ${session.data?.user?.email ?? "nobody"}, not the test account: stopping before any write.`);
  ok("signed in as the test account", true);
  const made = await api("POST", "/_api/notes/create", { id: randomUUID(), createdAt: new Date(), title: TITLE, content: "A few lines to open.\n\nAnd a second paragraph, so there's something to read." });
  ok("a note to open is made", made.status === 200, `status ${made.status}`);

  // Through the opening screens, then to Notes, where the note is listed.
  await page.waitForFunction(() => /Write freely/.test(document.body.innerText), null, { timeout: 60000 });
  await press("Skip");
  await page.waitForFunction(() => /Gentle help/.test(document.body.innerText), null, { timeout: 30000 });
  await press("Not now");
  await page.waitForFunction(() => /Today/.test(document.body.innerText), null, { timeout: 60000 });
  await page.getByRole("tab", { name: "Notes" }).first().click();
  // The Notes list's card (Search, drawn ahead, lists notes too).
  await page.waitForFunction((title) => !!document.querySelector(`[data-testid="notes-list"] [aria-label^="${title}"]`), TITLE, { timeout: 60000 });
  await page.waitForTimeout(1500);

  // Every frame from the press, for two seconds: the title field, Go deeper, and how the words show.
  await page.evaluate(() => {
    window.__frames = [];
    document.addEventListener("pointerdown", () => {
      const start = performance.now();
      const frame = () => {
        const input = document.querySelector('input[aria-label="Title"]');
        const iframe = document.querySelector('iframe[title="Note"]');
        let opacity = iframe ? 1 : 0;
        let moved = false;
        for (let el = iframe; el && el !== document.body; el = el.parentElement) {
          const style = getComputedStyle(el);
          opacity *= Number(style.opacity);
          if (style.transform && style.transform !== "none" && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(style.transform)) moved = moved || /matrix\(1, 0, 0, 1, 0, -?[1-9]/.test(style.transform);
        }
        window.__frames.push({ t: Math.round(performance.now() - start), page: !!input, title: input?.value ?? null, deeper: document.body.innerText.includes("Go deeper"), opacity: Math.round(opacity * 100) / 100, moved });
        if (performance.now() - start < 2000) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, { capture: true, once: true });
  });
  await page.locator(`[data-testid="notes-list"] [aria-label^="${TITLE}"]`).first().click();
  await page.waitForTimeout(2600);
  const frames = (await page.evaluate(() => window.__frames)).filter((f) => f.page);
  console.log(`  ${frames.length} frames of the note page; words visible from ${frames.find((f) => f.opacity > 0.95)?.t ?? "?"} ms`);
  ok("the title is there from the note page's first frame", frames.length > 0 && frames.every((f) => f.title === TITLE), JSON.stringify(frames.slice(0, 4)));
  ok("Go deeper is there from the first frame, not popping in", frames.length > 0 && frames.every((f) => f.deeper));
  const opacities = frames.map((f) => f.opacity);
  ok("the words only fade in (never back out)", opacities.every((o, i) => i === 0 || o >= opacities[i - 1] - 0.01), JSON.stringify(opacities));
  ok("…and don't move as they do", frames.every((f) => !f.moved));
  ok("…and end fully shown", (opacities.at(-1) ?? 0) > 0.99);
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n")[0]);
} finally {
  if (api) for (const note of await ours().catch(() => [])) await api("POST", "/_api/notes/delete", { id: note.id });
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
