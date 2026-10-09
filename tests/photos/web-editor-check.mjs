// The WEB APP's note editor with photos (docs/photos-server.md 10.2): pages/note.$noteId.tsx and
// the notes list in pages/_index.tsx, in Chrome, against the local server. The web app shows a
// photo as its raw `![](attachment:<id>)` text (a non-goal to show it), so what matters is that
// it never loses one it didn't mean to, removes one only when its writer took it out, and never
// shows the link text in a preview.
//
//   ./stack.sh start && ./run-server.sh --background && ./stack.sh web
//   node web-editor-check.mjs
//
// Signs in to the web app (Vite on :9401, /_api to :3410) as the Clerk test account. Notes and
// photos it makes are in the local database and bucket only, titled "Web editor check", and
// removed at the end.
import { randomUUID } from "node:crypto";
import {
  sql, ok, results, section, chromium, CHROME_ARGS, testEmail, makeApi, photoBytes, newId,
  s3, Bucket, superjson, sleep,
} from "./lib.mjs";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";

const WEB = process.env.WEB || "http://localhost:9401";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(WEB)) throw new Error(`WEB must be local, not ${WEB}`);
const TITLE = "Web editor check";
const token = (id) => `![](attachment:${id})`;
// Endpoints that need OpenRouter, which the local server deliberately doesn't have: their
// failures are expected here and are listed, not counted.
const AI_ENDPOINTS = ["/_api/suggestions/generate", "/_api/notes/reindex", "/_api/notes/suggest_title", "/_api/tasks/extract", "/_api/tasks/summary", "/_api/tasks/first_steps", "/_api/tasks/parse"];

let browser;
let me;
const made = { notes: [], photos: [] };

const noteRow = async (id) => (await sql`select content, doc, updated_at from notes where id = ${id}`)[0];
const links = async (noteId) => (await sql`select attachment_id from note_attachments where note_id = ${noteId} order by 1`).map((r) => r.attachment_id);
const mark = async (id) => (await sql`select orphaned_since from attachments where user_id = ${me} and id = ${id}`)[0]?.orphaned_since ?? null;

try {
  browser = await chromium().launch({ executablePath: "/opt/google/chrome/chrome", args: CHROME_ARGS });
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();

  // --- what the page does ---------------------------------------------------------
  const pageErrors = [];
  const consoleErrors = [];
  const badResponses = [];
  const expectedFailures = new Map();
  const saves = []; // notes/update and notes/create calls: { path, body, status, answer }
  let inflight = 0;
  page.on("pageerror", (e) => pageErrors.push(e.message.split("\n")[0]));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // A failed fetch logs "Failed to load resource" with the request's URL as its location.
    let path = "";
    try { path = new URL(m.location()?.url ?? "").pathname; } catch {}
    if (AI_ENDPOINTS.includes(path) && /^Failed to load resource/.test(m.text())) return;
    consoleErrors.push(`${m.text().split("\n")[0]}${path ? ` (${path})` : ""}`);
  });
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (path === "/_api/notes/update" || path === "/_api/notes/create") {
      inflight++;
      let body = null;
      try { body = superjson.parse(req.postData() ?? ""); } catch { body = null; }
      const entry = { path, body, status: null, answer: null };
      saves.push(entry);
      req.response().then(async (res) => {
        entry.status = res?.status() ?? 0;
        try { entry.answer = superjson.parse(await res.text()); } catch { entry.answer = null; }
      }).catch(() => { entry.status = 0; }).finally(() => { inflight--; });
    }
  });
  page.on("requestfailed", (req) => {
    const path = new URL(req.url()).pathname;
    if (path.startsWith("/_api/")) badResponses.push(`${path}: ${req.failure()?.errorText}`);
  });
  page.on("response", (res) => {
    const path = new URL(res.url()).pathname;
    if (!path.startsWith("/_api/") || res.status() < 400) return;
    if (AI_ENDPOINTS.includes(path)) expectedFailures.set(path, res.status());
    else badResponses.push(`${path}: ${res.status()}`);
  });

  const textarea = page.getByLabel("Note text", { exact: true });
  const lastSave = () => saves.filter((s) => s.path === "/_api/notes/update").at(-1);
  /** Waits for the editor's save to go out and come back. */
  async function settle() {
    await page.waitForTimeout(1500); // past the editor's 900 ms pause
    for (let i = 0; i < 200 && inflight > 0; i++) await sleep(100);
    await page.waitForFunction(() => document.querySelector('main header span[aria-live="polite"]')?.textContent === "Saved", null, { timeout: 20000 });
    for (let i = 0; i < 200 && inflight > 0; i++) await sleep(100);
  }
  const caretTo = (pos, end = pos) => textarea.evaluate((el, [a, b]) => { el.focus(); el.setSelectionRange(a, b); }, [pos, end]);
  const value = () => textarea.inputValue();

  // --- sign in to the web app -------------------------------------------------------
  section("sign in to the web app");
  await page.goto(`${WEB}/login`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => window.Clerk?.loaded, null, { timeout: 90000 });
  const signedIn = await page.evaluate(async (email) => {
    const clerk = window.Clerk;
    if (!clerk.session) {
      const attempt = await clerk.client.signIn.create({ identifier: email });
      const factor = attempt.supportedFirstFactors.find((f) => f.strategy === "email_code");
      await attempt.prepareFirstFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
      const done = await attempt.attemptFirstFactor({ strategy: "email_code", code: "424242" });
      await clerk.setActive({ session: done.createdSessionId });
    }
    window.localStorage.setItem("clarity:onboarding-done", "true");
    return clerk.user?.primaryEmailAddress?.emailAddress ?? null;
  }, testEmail());
  if (signedIn !== testEmail()) throw new Error(`signed in as ${signedIn ?? "nobody"}, not the test account: stopping`);
  const api = makeApi(() => page.evaluate(() => window.Clerk.session.getToken()));
  const session = await api("GET", "/_api/auth/session");
  if (session.data?.user?.email !== testEmail()) throw new Error("the local server doesn't see the test account");
  me = (await sql`select id from users where email = ${testEmail()}`)[0]?.id;
  ok("signed in as the test account; the local server knows it", !!me);

  // --- photos and notes, as Sage would make them ----------------------------------------
  async function readyPhoto(seed) {
    const id = newId("w");
    const bytes = photoBytes(1500, seed);
    const s = await api("POST", "/_api/attachments/start", { id, contentType: "image/jpeg", bytes: bytes.length });
    if (s.status !== 200) throw new Error(`start: ${s.status} ${s.text.slice(0, 120)}`);
    const put = await fetch(s.data.upload.url, { method: "PUT", headers: s.data.upload.headers, body: bytes });
    if (put.status !== 200) throw new Error(`PUT: ${put.status}`);
    const c = await api("POST", "/_api/attachments/confirm", { id });
    if (c.status !== 200) throw new Error(`confirm: ${c.status}`);
    made.photos.push(id);
    return id;
  }
  const p1 = await readyPhoto(31);
  const p2 = await readyPhoto(32);
  const p3 = await readyPhoto(33);
  const stamp = Date.now().toString(36);
  const t1 = `${TITLE} ${stamp} words`;
  const t2 = `${TITLE} ${stamp} photo only`;
  const content1 = `Before the photo.\n\n${token(p1)}\n\nAfter the photo.`;
  const doc1 = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Before the photo." }] },
      { type: "image", attrs: { src: `attachment:${p1}` } },
      { type: "paragraph", content: [{ type: "text", text: "After the photo." }] },
    ],
  };
  const n1 = randomUUID();
  const n2 = randomUUID();
  for (const [id, title, content, doc] of [[n1, t1, content1, doc1], [n2, t2, token(p3), { type: "doc", content: [{ type: "image", attrs: { src: `attachment:${p3}` } }] }]]) {
    const r = await api("POST", "/_api/notes/create", { id, createdAt: new Date(), title, content, doc });
    if (r.status !== 200) throw new Error(`notes/create: ${r.status} ${r.text.slice(0, 120)}`);
    made.notes.push(id);
  }
  ok("two notes naming photos, made through the API with a doc (as Sage saves them)", (await links(n1)).join() === p1 && (await links(n2)).join() === p3);

  // --- the notes list ------------------------------------------------------------------
  const card = (title) => page.getByRole("button", { name: `Open note: ${title}`, exact: true });
  async function checkPreviews(label, words) {
    await card(t1).waitFor({ timeout: 60000 });
    await card(t2).waitFor({ timeout: 60000 });
    const text1 = await card(t1).innerText();
    const spans1 = await card(t1).locator("span").allInnerTexts();
    const spans2 = await card(t2).locator("span").allInnerTexts();
    ok(`${label}: the note's preview shows its words`, words.every((w) => text1.includes(w)), JSON.stringify(spans1));
    ok(`${label}: …and no photo text ("attachment:", "![](")`, !/attachment|!\[\]\(/.test(text1), JSON.stringify(spans1));
    ok(`${label}: a note of only a photo has no preview line (title and date only)`, spans2.length === 2 && !/attachment|!\[/.test(spans2.join(" ")), JSON.stringify(spans2));
  }
  section("the notes list");
  await page.goto(`${WEB}/`, { waitUntil: "load" });
  await checkPreviews("list", ["Before the photo.", "After the photo."]);

  // --- opening the note -------------------------------------------------------------------
  section("opening a note that names a photo");
  await card(t1).click();
  await page.waitForURL(`**/note/${n1}`);
  await textarea.waitFor({ timeout: 30000 });
  ok("it opens, showing the photo as its link text", (await value()) === content1, JSON.stringify(await value()));
  await settle(); // the web app saves every note it opens (open question 2, out of scope)
  let row = await noteRow(n1);
  ok("the save on opening keeps the photo: content unchanged", row.content === content1, JSON.stringify(row.content));
  ok("…its link stays, the photo isn't marked", (await links(n1)).join() === p1 && !(await mark(p1)));
  ok("…and the save didn't say it removed anything", saves.every((s) => !s.body?.removedPhotos));

  // --- editing the words ------------------------------------------------------------------
  section("editing the words");
  await caretTo("Before the photo.".length);
  await page.keyboard.type(" Edited on the web.");
  await settle();
  let text = await value();
  row = await noteRow(n1);
  ok("the edit is saved", text.startsWith("Before the photo. Edited on the web.") && row.content === text, JSON.stringify(row.content));
  ok("…the photo reference is kept", row.content.includes(token(p1)) && (await links(n1)).join() === p1 && !(await mark(p1)));
  ok("…no removedPhotos sent, nothing appended by the server", !lastSave()?.body?.removedPhotos && lastSave()?.answer?.note?.content === text && lastSave()?.status === 200);
  ok("…missingPhotos is empty (the photo is uploaded)", Array.isArray(lastSave()?.answer?.missingPhotos) && lastSave().answer.missingPhotos.length === 0);

  // --- a token broken by hand ----------------------------------------------------------------
  section("a photo link broken by hand");
  const close = text.indexOf(token(p1)) + token(p1).length; // just past ")"
  await caretTo(close);
  await page.keyboard.press("Backspace");
  await settle();
  row = await noteRow(n1);
  ok("deleting the link's \")\" doesn't remove the photo (the loose rule still names it)", !row.content.includes(token(p1)) && row.content.includes(`attachment:${p1}`) && (await links(n1)).join() === p1 && !(await mark(p1)));
  ok("…and no removedPhotos was sent", !lastSave()?.body?.removedPhotos);
  await caretTo(close - 1);
  await page.keyboard.type(")");
  await settle();
  ok("typing it back restores the token", (await noteRow(n1)).content.includes(token(p1)));

  // --- taking the reference out -------------------------------------------------------------
  section("taking the photo reference out (10.2: the writer removed it)");
  text = await value();
  const at = text.indexOf(token(p1));
  await caretTo(at, at + token(p1).length + 2); // the token and the blank line after it
  await page.keyboard.press("Backspace");
  await settle();
  text = await value();
  row = await noteRow(n1);
  ok("the save lists it in removedPhotos", JSON.stringify(lastSave()?.body?.removedPhotos) === JSON.stringify([p1]), JSON.stringify(lastSave()?.body));
  ok("…the words are kept exactly; the photo is not put back", row.content === text && !row.content.includes(p1) && text.includes("Edited on the web.") && text.includes("After the photo."), JSON.stringify(row.content));
  ok("…its link goes and the photo is marked unused (swept in 7 days)", (await links(n1)).length === 0 && !!(await mark(p1)));

  section("typing the reference back");
  await caretTo(text.length);
  await page.keyboard.type(`\n\n${token(p1)}`);
  await settle();
  ok("the link is back and the mark cleared", (await links(n1)).join() === p1 && !(await mark(p1)));
  ok("…and the save didn't list it as removed", !lastSave()?.body?.removedPhotos);

  // --- a photo added elsewhere while the tab is open -------------------------------------------
  section("a photo added on another device while this tab is open (10.2: a stale tab can't remove it)");
  const fromPhone = `${await value()}\n\n${token(p2)}`;
  const phone = await api("POST", "/_api/notes/update", { id: n1, content: fromPhone, doc: { ...doc1, content: [...doc1.content, { type: "image", attrs: { src: `attachment:${p1}` } }, { type: "image", attrs: { src: `attachment:${p2}` } }] } });
  ok("another device adds a second photo", phone.status === 200 && (await links(n1)).join() === [p1, p2].sort().join());
  text = await value();
  const after = text.indexOf("After the photo.") + "After the photo.".length;
  await caretTo(after);
  await page.keyboard.type(" One more line from the stale tab.");
  await settle();
  row = await noteRow(n1);
  ok("the stale tab's save doesn't list the photo it never saw", !(lastSave()?.body?.removedPhotos ?? []).includes(p2), JSON.stringify(lastSave()?.body?.removedPhotos));
  ok("…its words are kept", row.content.includes("After the photo. One more line from the stale tab.") && row.content.includes(token(p1)));
  ok("…and the server puts the new photo back at the end", row.content.trimEnd().endsWith(token(p2)) && (await links(n1)).join() === [p1, p2].sort().join() && !(await mark(p2)), JSON.stringify(row.content.slice(-80)));
  ok("…the answer says what is stored", lastSave()?.answer?.note?.content === row.content);

  section("reopening shows the photo that was put back");
  await page.reload({ waitUntil: "load" });
  await textarea.waitFor({ timeout: 30000 });
  text = await value();
  ok("the reopened note has the typed words and both photos", text.includes("One more line from the stale tab.") && text.includes(token(p1)) && text.trimEnd().endsWith(token(p2)), JSON.stringify(text.slice(-120)));
  await settle();
  ok("…and its save on opening keeps both links", (await links(n1)).join() === [p1, p2].sort().join() && !(await mark(p1)) && !(await mark(p2)));

  // --- previews again ----------------------------------------------------------------------------
  section("the notes list after editing");
  await page.getByRole("button", { name: "Back to your notes" }).click();
  await page.waitForURL(`${WEB}/`);
  await checkPreviews("list after editing", ["Edited on the web.", "One more line from the stale tab."]);
  const text1 = await card(t1).innerText();
  ok("…no doubled spaces or stray punctuation where photos were", !/ {2}|\( |\)\s*\)/.test(text1), JSON.stringify(text1));

  // --- nothing errored ---------------------------------------------------------------------------
  section("errors");
  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  ok("every note save answered 200", saves.length > 0 && saves.every((s) => s.status === 200), JSON.stringify(saves.map((s) => s.status)));
  ok("no failed API calls (other than the AI ones the local server can't make)", badResponses.length === 0, badResponses.join(" | "));
  ok("no console errors (other than those failed AI calls)", consoleErrors.length === 0, consoleErrors.join(" | "));
  if (expectedFailures.size) console.log(`  (expected, no OpenRouter key locally: ${[...expectedFailures].map(([p, s]) => `${p} ${s}`).join(", ")})`);
} catch (error) {
  ok("the run reached its checks", false, String(error?.message ?? error).split("\n")[0]);
} finally {
  // Clean up: the check's notes, photos, bucket objects and queue rows (local only).
  try {
    if (me && made.notes.length) await sql`delete from notes where user_id = ${me} and id in ${sql(made.notes)}`;
    if (me && made.photos.length) {
      const keys = (await sql`select storage_key from attachments where user_id = ${me} and id in ${sql(made.photos)}`).map((r) => r.storage_key);
      await sql`delete from attachments where user_id = ${me} and id in ${sql(made.photos)}`;
      if (keys.length) {
        await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
        await sql`delete from storage_deletions where storage_key in ${sql(keys)}`;
      }
    }
  } catch (error) {
    console.log(`clean-up: ${error?.message ?? error}`);
  }
  if (browser) await browser.close().catch(() => {});
  await sql.end();
}
console.log(results.failed ? `\nweb-editor-check: ${results.failed} FAILED, ${results.passed} passed` : `\nweb-editor-check: all ${results.passed} passed`);
process.exit(results.failed ? 1 : 0);
