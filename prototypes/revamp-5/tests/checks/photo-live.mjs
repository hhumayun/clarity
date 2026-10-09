// Photos end to end against the LIVE server, after go-live (docs/photos-server.md 12 step 7), as the
// TEST account, in Sage's web build on 8087 (Metro). Run only with the user's OK, after the bucket, its
// variables, migration 017 and the server deploy (steps 1-6). Writes only one "Sage check: photo" note
// and its photo, and removes both:
//   - usage says enabled;
//   - a photo added to a new note goes up (start, PUT, confirm); view gives a link that downloads it;
//   - a fresh browser context (empty IndexedDB) opens the note and draws the photo;
//   - the note is deleted; delete for the photo (no note names it now) removes it; view gives null.
// Never touches "Good boy", the three "Dr Lee" tasks or the user's note; refuses to run unless the
// address contains +clerk_test@. If it crashes, clean-test-account.mjs removes "Sage check" notes, and
// a leftover photo is swept within 7 days.
//
//   set -a && . /root/.config/clarity-sage-test.env && set +a
//   node tests/checks/photo-live.mjs               (--cors-shim adds CORS for the bucket's host in
//                                                   Playwright, if bucket-cors.mjs didn't take)
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const LIVE = "https://clarity-notes-production.up.railway.app";
const APP = "http://localhost:8087";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
const TITLE = "Sage check: photo";
const corsShim = process.argv.includes("--cors-shim");

let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
  return pass;
};

function png(width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set([90, (60 + y) & 255, 160], y * (width * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const FILE = join(mkdtempSync(join(tmpdir(), "sage-photo-live-")), "photo.png");
writeFileSync(FILE, png(900, 600));

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const cors = { "access-control-allow-origin": APP, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, PUT, OPTIONS" };
/** A browser context whose /_api calls (and, with --cors-shim, signed bucket requests) get CORS headers. */
async function newContext() {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.route(`${LIVE}/_api/**`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const response = await route.fetch();
    return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
  if (corsShim) {
    await context.route((url) => url.searchParams.has("X-Amz-Signature"), async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const response = await route.fetch();
      return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
    });
  }
  return context;
}
async function signIn(context) {
  const page = await context.newPage();
  const press = (name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: 30000 });
  await page.goto(`${APP}/`, { waitUntil: "load", timeout: 180000 });
  await press("Continue with email");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await press("Continue");
  await press("Email me a code instead");
  await page.getByLabel("The code from the email", { exact: true }).fill("424242", { timeout: 30000 });
  await page.waitForFunction(() => window.Clerk?.session?.id, null, { timeout: 30000 });
  await page.waitForFunction(() => /Write freely|Today|Tasks/.test(document.body.innerText), null, { timeout: 60000 });
  if (/Write freely/.test(await page.evaluate(() => document.body.innerText))) await press("Skip");
  await page.waitForFunction(() => /Gentle help|Today|Tasks/.test(document.body.innerText), null, { timeout: 30000 });
  if (/Gentle help/.test(await page.evaluate(() => document.body.innerText))) await press("Not now");
  await page.waitForTimeout(1500);
  return page;
}
const editorFrame = (page) => page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1);
const waitEditor = async (page) => {
  await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return editorFrame(page);
};
const drawnPhotos = (frame) => frame.evaluate(() => [...document.querySelectorAll(".ProseMirror .photo")].filter((el) => el.classList.contains("drawn") && (el.querySelector("img")?.naturalWidth ?? 0) > 0).length);

const errors = [];
let api;
let photoId = null;
const ours = async () => ((await api("GET", "/_api/notes/list")).data?.notes ?? []).filter((note) => note.title === TITLE);
try {
  const context = await newContext();
  const page = await signIn(context);
  page.on("pageerror", (e) => errors.push(e.message));
  const btn = (name) => page.getByRole("button", { name, exact: false }).first();
  api = async (method, path, body) => {
    const token = await page.evaluate(() => window.Clerk.session.getToken());
    const response = await fetch(`${LIVE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : superjson.stringify(body) });
    const raw = await response.text();
    try { return { status: response.status, data: superjson.parse(raw) }; } catch { return { status: response.status, data: raw }; }
  };
  const session = await api("GET", "/_api/auth/session");
  if (session.data?.user?.email !== EMAIL) throw new Error(`Signed in as ${session.data?.user?.email ?? "nobody"}, not the test account: stopping before any write.`);
  ok("signed in as the test account", true);

  const usage = await api("GET", "/_api/attachments/usage");
  ok("usage: enabled", usage.status === 200 && usage.data?.enabled === true, `${usage.status} ${JSON.stringify(usage.data).slice(0, 120)}`);

  // A new note with a photo, through the app.
  await btn("New note or task").click();
  await page.waitForTimeout(600);
  await btn("New note").click();
  const frame = await waitEditor(page);
  await page.getByLabel("Title").fill(TITLE);
  await frame.locator(".ProseMirror").click();
  await page.keyboard.type("A photo, end to end.", { delay: 10 });
  const chooser = page.waitForEvent("filechooser", { timeout: 15000 });
  await btn("Photo").click();
  await (await chooser).setFiles(FILE);
  await frame.waitForFunction(() => document.querySelector(".ProseMirror .photo.drawn"), null, { timeout: 20000 });
  photoId = (await frame.evaluate(() => document.querySelector(".ProseMirror").editor.getMarkdown())).match(/attachment:([A-Za-z0-9-]{8,64})/)?.[1] ?? null;
  ok("the photo is in the note", !!photoId);
  await btn("Put the keyboard away").click({ timeout: 3000 }).catch(() => {});
  await btn("Done").click();

  // Up: view answers a link that downloads it.
  let link = null;
  for (let i = 0; i < 60 && !link; i++) {
    await page.waitForTimeout(2000);
    link = (await api("POST", "/_api/attachments/view", { ids: [photoId] })).data?.photos?.[photoId] ?? null;
  }
  ok("the photo reached the server (view gives a link)", !!link?.url);
  if (link?.url) {
    const got = await fetch(link.url);
    ok("…which downloads it", got.status === 200 && (await got.arrayBuffer()).byteLength > 1000, `${got.status}`);
  }
  const [note] = await ours();
  ok("the note reached the server, naming the photo", !!note && note.content.includes(`attachment:${photoId}`));

  // Another device: a fresh context, empty IndexedDB, draws it.
  const fresh = await newContext();
  const other = await signIn(fresh);
  await other.getByRole("tab", { name: "Notes" }).first().click();
  const card = other.locator(`[data-testid="notes-list"] [aria-label^="${TITLE}"]`).first();
  await card.waitFor({ timeout: 60000 });
  await card.click();
  const otherFrame = await waitEditor(other);
  let drawn = 0;
  for (let i = 0; i < 30 && !drawn; i++) { await other.waitForTimeout(1000); drawn = await drawnPhotos(otherFrame); }
  ok("a fresh browser (empty IndexedDB) opens the note and draws the photo", drawn === 1);
  await fresh.close();
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", String(error.message).split("\n")[0]);
} finally {
  if (api) {
    for (const note of await ours().catch(() => [])) await api("POST", "/_api/notes/delete", { id: note.id });
    ok("the check note is deleted", (await ours().catch(() => [1])).length === 0);
    if (photoId) {
      const d = await api("POST", "/_api/attachments/delete", { id: photoId });
      ok("delete for the photo (no note names it now): deleted", d.status === 200 && d.data?.deleted === true, `${d.status} ${JSON.stringify(d.data).slice(0, 120)}`);
      const v = await api("POST", "/_api/attachments/view", { ids: [photoId] });
      ok("…view gives null", v.status === 200 && v.data?.photos?.[photoId] === null);
    }
  }
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
