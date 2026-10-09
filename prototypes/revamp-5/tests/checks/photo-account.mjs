// Photos in an ACCOUNT note, in Sage's web build, against the LOCAL server
// (docs/photos-server.md, 11.3). The page is served at http://localhost:8095
// by a second scripts/web-proxy.mjs, which sends /_api to the local server on
// :3410 (local database, local bucket on :9400); signed in as the Clerk test
// account. Writes only "Sage check: photo" notes, in the local database.
// Nothing goes to the live server.
//
// Start the stack first (from /root/projects/clarity-revamp-5-ux/tests/photos):
//   ./stack.sh start && ./run-server.sh --background && ./stack.sh proxy
// then:
//   node tests/checks/photo-account.mjs          (OUT=<dir> for screenshots)
//
// Steps as in the design: 1 Photo tool and a chosen file; 2 drawn at once; 3 the outbox empties, the
// server has it; 4 another device draws it; 5 a slow upload holds nothing back; 6 typing doesn't hurry a
// failing photo; 7 lists refresh while a photo fails; 8 offline; 9 removing a photo says so; 10 photos
// off hides the tool; 12 deleting the note; 11 signing out with a photo waiting (last: it signs out).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { sql, signIn, headKey, superjson, APP, PORTS } from "/root/projects/clarity-revamp-5-ux/tests/photos/lib.mjs";

const OUT = process.env.OUT || "/tmp/clarity-revamp-5/photo-account";
mkdirSync(OUT, { recursive: true });
const TITLE = "Sage check: photo";
// Titles that don't start with TITLE, so a card for one is never taken for the check note's.
const OTHER_TITLE = "Sage other device check";
const DOWNLOAD_TITLE = "Sage download check";
const BUCKET_HOST = `http://127.0.0.1:${PORTS.s3}`;

let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
  return pass;
};

/** A plain PNG, standing in for a photo from the phone (as photo-flow.mjs). */
function png(width, height, tint = 80) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set([200, (tint + Math.floor((y / height) * 120)) & 255, 70], row + 1 + x * 3);
  }
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
const files = mkdtempSync(join(tmpdir(), "sage-photo-account-"));
const PHOTO = [1, 2, 3, 4, 5].map((n) => {
  const path = join(files, `photo-${n}.png`);
  writeFileSync(path, png(1200, 800, n * 30));
  return path;
});

// --- the page --------------------------------------------------------------------

const session = await signIn({ app: APP });
const { page, context, api } = session;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// Every /_api request the page makes, with its body; and every request to the bucket.
const sent = [];
page.on("request", (r) => {
  const url = r.url();
  if (url.includes("/_api/")) sent.push({ at: Date.now(), path: new URL(url).pathname, method: r.method(), body: r.postData() ?? "" });
  else if (url.startsWith(BUCKET_HOST)) sent.push({ at: Date.now(), path: "bucket", method: r.method(), body: "" });
});
const sentTo = (path, since = 0) => sent.filter((s) => s.path === path && s.at >= since);
const parsed = (body) => { try { return superjson.parse(body); } catch { return null; } };

const press = (name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: 30000 });
const btn = (name) => page.getByRole("button", { name, exact: false }).first();
const text = () => page.evaluate(() => document.body.innerText);
const editorFrame = () => page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1);
const waitEditor = async () => {
  await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return editorFrame();
};
const photosIn = (frame) =>
  frame.evaluate(() =>
    [...document.querySelectorAll(".ProseMirror .photo")].map((el) => {
      const img = el.querySelector("img");
      return { drawn: el.classList.contains("drawn"), height: el.getBoundingClientRect().height, width: img?.naturalWidth ?? 0 };
    }),
  );
const markdown = (frame) => frame.evaluate(() => document.querySelector(".ProseMirror").editor.getMarkdown().replace(/\n+$/, ""));
const idsIn = (md) => [...md.matchAll(/attachment:([A-Za-z0-9-]{8,64})/g)].map((m) => m[1]);
const toolNames = () => page.getByTestId("note-tools").evaluate((tools) => [...tools.querySelectorAll('[role="button"]')].map((el) => el.getAttribute("aria-label"))).catch(() => []);
const until = async (what, fn, ms = 60000, every = 500) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn().catch((e) => { last = e; return null; });
    if (last) return last;
    await page.waitForTimeout(every);
  }
  return null;
};
/** Puts the cursor at the end of the note (the photo goes on a line after it). */
const toEnd = async (frame) => {
  await frame.locator(".ProseMirror").click();
  await frame.evaluate(() => {
    const editor = document.querySelector(".ProseMirror").editor;
    editor.chain().focus().setTextSelection(editor.state.doc.content.size - 1).run();
  });
  await page.waitForTimeout(300);
};
const addPhoto = async (path) => {
  const chooser = page.waitForEvent("filechooser", { timeout: 15000 });
  chooser.catch(() => {}); // if the click fails, that error is the one to report
  await btn("Photo").click({ timeout: 15000 });
  await (await chooser).setFiles(path);
};
const leave = async () => {
  await btn("Put the keyboard away").click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  await btn("Done").click();
  await page.waitForTimeout(1500);
  // Done leaves 300 ms after the press. If the note page is still there, say so (a later step would
  // otherwise stop on a tab it can't find), and press Done once more so the run carries on.
  const left = await until("left", async () => !new URL(page.url()).pathname.startsWith("/note/"), 5000, 250);
  if (!left) {
    ok("Done leaves the note page", false, `still at ${new URL(page.url()).pathname} 6.5 s after the press`);
    await page.screenshot({ path: `${OUT}/done-stuck.png` }).catch(() => {});
    await btn("Done").click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
};
const openNotes = async () => {
  await page.getByRole("tab", { name: "Notes" }).first().click();
  await page.waitForTimeout(800);
};
const openNote = async (title = TITLE) => {
  await openNotes();
  const card = page.locator(`[data-testid="notes-list"] [aria-label^="${title}"]`).first();
  await card.waitFor({ timeout: 60000 });
  await card.click();
  return waitEditor();
};
const idb = (key) => page.evaluate((k) => new Promise((resolve) => {
  const request = indexedDB.open("clarity-photos");
  request.onsuccess = () => {
    try {
      const store = request.result.transaction("photos").objectStore("photos");
      const get = k ? store.get(k) : store.count();
      get.onsuccess = () => resolve(k ? typeof get.result === "string" && get.result.length > 100 : get.result);
      get.onerror = () => resolve(k ? false : -1);
    } catch { resolve(k ? false : 0); }
  };
  request.onerror = () => resolve(k ? false : -1);
}), key ?? null);
/** The page's stored outbox and unsent-photo ledger (AsyncStorage is localStorage on the web). */
const stored = () => page.evaluate(() => {
  const read = (prefix) => Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } });
  // The outbox is kept as superjson ({ json: [...], meta }), the ledger as plain JSON.
  const size = (v) => (Array.isArray(v) ? v.length : Array.isArray(v?.json) ? v.json.length : 0);
  return {
    outbox: read("clarity:outbox:v1:").reduce((n, v) => n + size(v), 0),
    waiting: read("clarity:photos-unsent:v1:").reduce((n, v) => n + Object.values(v ?? {}).filter((m) => m === "waiting").length, 0),
  };
});

// --- the local database ------------------------------------------------------------

const me = (await sql`select id from users where email = ${session.email}`)[0]?.id;
const ourNotes = () => sql`select id, title, content from notes where user_id = ${me} and title = ${TITLE}`;
const row = async (id) => (await sql`select * from attachments where user_id = ${me} and id = ${id}`)[0];
const linksOf = async (noteId) => (await sql`select attachment_id from note_attachments where note_id = ${noteId}`).map((r) => r.attachment_id);

// Answers held or refused through Playwright, switched by these.
let holdPuts = 0; // ms to hold each PUT to the bucket
let failStart = false; // start answers 503
let photosOff = false; // usage answers enabled: false
let holdGets = 0; // ms to hold each GET from the bucket
await context.route(`${BUCKET_HOST}/**`, async (route) => {
  const method = route.request().method();
  const wait = method === "PUT" ? holdPuts : method === "GET" ? holdGets : 0;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return route.continue().catch(() => {});
});
await context.route("**/_api/attachments/start", async (route) => {
  if (failStart) return route.fulfill({ status: 503, contentType: "application/json", body: superjson.stringify({ error: "Busy just now." }) });
  return route.continue();
});
await context.route("**/_api/attachments/usage", async (route) => {
  if (!photosOff) return route.continue();
  return route.fulfill({ status: 200, contentType: "application/json", body: superjson.stringify({ enabled: false, usedBytes: 0, quotaBytes: 1073741824, maxPhotoBytes: 10485760, photos: 0, maxPhotos: 10000 }) });
});

let noteId = null;
let firstId = null;
try {
  if (!me) throw new Error("the local server has no users row for the test account");
  // Leftovers of an earlier run (local database only).
  await sql`delete from notes where user_id = ${me} and (title like ${TITLE + "%"} or title like ${OTHER_TITLE + "%"} or title = ${DOWNLOAD_TITLE})`;

  // Through the opening screens.
  await page.waitForFunction(() => /Write freely|Today|Tasks/.test(document.body.innerText), null, { timeout: 60000 });
  if (/Write freely/.test(await text())) await press("Skip");
  await page.waitForFunction(() => /Gentle help|Today|Tasks/.test(document.body.innerText), null, { timeout: 30000 });
  if (/Gentle help/.test(await text())) await press("Not now");
  await page.waitForTimeout(1500);

  // 1. A new page; the Photo tool is there; a file is chosen.
  await btn("New note or task").click();
  await page.waitForTimeout(600);
  await btn("New note").click();
  let frame = await waitEditor();
  await page.getByLabel("Title").fill(TITLE);
  await frame.locator(".ProseMirror").click();
  await page.keyboard.type("A photo from the local check.", { delay: 10 });
  await page.waitForTimeout(400);
  const tools = await toolNames();
  ok("1. an account note offers the Photo tool (usage says enabled)", tools.includes("Photo"), tools.join(", "));
  await addPhoto(PHOTO[0]);

  // 2. Drawn at once, from the browser's own copy.
  const drawn = await until("drawn", async () => (await photosIn(frame)).some((p) => p.drawn), 20000);
  ok("2. the photo shows at once", !!drawn);
  firstId = idsIn(await markdown(frame))[0];
  ok("…the note names it by id", !!firstId);
  ok("…kept in IndexedDB", firstId ? await idb(firstId) : false);
  await page.keyboard.type("Under the photo.", { delay: 10 });
  await page.screenshot({ path: `${OUT}/1-added.png` });
  await leave();

  // 3. The outbox empties; the server has the note, the link, the ready photo and the object.
  const landed = await until("landed", async () => {
    const [n] = await ourNotes();
    const r = firstId ? await row(firstId) : null;
    const s = await stored();
    return n && r?.status === "ready" && s.outbox === 0 && s.waiting === 0 ? { n, r } : null;
  }, 90000, 1000);
  ok("3. the outbox empties and the photo is ready on the server", !!landed, JSON.stringify(await stored()));
  noteId = landed?.n.id ?? (await ourNotes())[0]?.id;
  ok("…the note has one link, to it", noteId && JSON.stringify(await linksOf(noteId)) === JSON.stringify([firstId]));
  ok("…the bucket has the object", !!(landed && (await headKey(landed.r.storage_key))));
  ok("…the ledger is empty", (await stored()).waiting === 0);
  const flow = sent.filter((s) => s.path === "/_api/attachments/start" || s.path === "/_api/attachments/confirm" || s.path === "bucket").map((s) => `${s.method} ${s.path}`);
  ok("…in order: start, PUT, confirm", flow.join(" > ").includes("POST /_api/attachments/start > PUT bucket > POST /_api/attachments/confirm"), flow.join(" > "));

  // 4. Another device: the browser's copy gone, the note opened again.
  await page.evaluate(() => new Promise((resolve) => { const r = indexedDB.deleteDatabase("clarity-photos"); r.onsuccess = r.onerror = r.onblocked = () => resolve(); }));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2500);
  frame = await openNote();
  const box = (await photosIn(frame))[0];
  ok("4. before it arrives, the box holds its shape", !!box && box.height > 40, JSON.stringify(box));
  const fetched = await until("fetched", async () => (await photosIn(frame)).find((p) => p.drawn && p.width > 0), 30000);
  ok("…then the photo is drawn, fetched from the server", !!fetched, JSON.stringify(await photosIn(frame)));
  ok("…through view", sentTo("/_api/attachments/view").length > 0);
  ok("…and kept in IndexedDB again", await until("kept", () => idb(firstId), 10000));
  await page.screenshot({ path: `${OUT}/4-another-device.png` });

  // 5. A slow upload holds nothing back.
  holdPuts = 10000;
  await toEnd(frame);
  await addPhoto(PHOTO[1]);
  await page.waitForTimeout(500);
  await page.keyboard.type("Words while the photo is slow.", { delay: 10 });
  await leave();
  const putAt = await until("PUT started", async () => sentTo("bucket").filter((s) => s.method === "PUT").at(-1)?.at, 15000);
  const wordsLanded = await until("words", async () => ((await ourNotes())[0]?.content ?? "").includes("Words while the photo is slow."), 9000);
  ok("5. the note's new words reach the server while the PUT is held", !!wordsLanded && !!putAt && Date.now() - putAt < 10000);
  holdPuts = 0;
  const secondId = idsIn((await ourNotes())[0]?.content ?? "").find((id) => id !== firstId);
  ok("…released, the photo lands", !!(await until("ready", async () => secondId && (await row(secondId))?.status === "ready", 40000)));

  // 6. Typing doesn't hurry a failing photo.
  failStart = true;
  frame = await openNote();
  await toEnd(frame);
  const since6 = Date.now();
  await addPhoto(PHOTO[2]);
  await page.waitForTimeout(500);
  for (let i = 0; i < 20; i++) {
    await page.keyboard.type(`Typing on ${i}. `, { delay: 30 });
    await page.waitForTimeout(400);
  }
  const startCalls = sentTo("/_api/attachments/start", since6).length;
  ok("6. 20 s of typing: start is asked at the backoff times only", startCalls >= 1 && startCalls <= 4, `${startCalls} calls`);
  await leave();
  ok("…the note's words saved meanwhile land", !!(await until("typed", async () => ((await ourNotes())[0]?.content ?? "").includes("Typing on 19."), 20000)));

  // 7. Lists refresh while a photo fails.
  const [other] = await sql`insert into notes (user_id, title, content) values (${me}, ${OTHER_TITLE}, 'Made elsewhere') returning id`;
  await sql`update notes set title = ${OTHER_TITLE + " renamed elsewhere"}, updated_at = now() where id = ${other.id}`;
  // Lists refresh once the outbox empties (src/core/sync/cache.ts); a waiting photo mustn't count.
  // So: one small edit, which goes through the outbox and empties it, then the list.
  frame = await openNote();
  await toEnd(frame);
  const since7 = Date.now();
  await page.keyboard.type(" One more word.", { delay: 10 });
  await leave();
  // Lists the outbox touched are marked out of date and refresh when the app comes back (or
  // reconnects, or a screen showing them mounts): the app going to the background and back.
  const setVisible = (visible) => page.evaluate((v) => {
    Object.defineProperty(document, "visibilityState", { value: v ? "visible" : "hidden", configurable: true });
    Object.defineProperty(document, "hidden", { value: !v, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event(v ? "focus" : "blur"));
  }, visible);
  await setVisible(false);
  await page.waitForTimeout(1500);
  await setVisible(true);
  await openNotes();
  let listed = await until("listed", async () => (await text()).includes("renamed elsewhere"), 30000, 1000);
  if (!listed) {
    console.log("  (coming back to the app didn't refresh the list; trying a reconnect)");
    await context.setOffline(true);
    await page.waitForTimeout(1500);
    await context.setOffline(false);
    listed = await until("listed", async () => (await text()).includes("renamed elsewhere"), 30000, 1000);
  }
  ok("7. with start still failing, a change from another device shows in the list", !!listed,
    `after the edit: ${sentTo("/_api/notes/update", since7).length} note saves, ${sentTo("/_api/notes/list", since7).length} list fetches, outbox ${JSON.stringify(await stored())}`);
  await sql`delete from notes where id = ${other.id}`;

  // 8. Offline: a photo still shows; nothing reaches the server; online again, it goes.
  failStart = false;
  frame = await openNote();
  await toEnd(frame);
  await context.setOffline(true);
  const rowsBefore = (await sql`select count(*)::int as n from attachments where user_id = ${me}`)[0].n;
  const idsBefore8 = idsIn(await markdown(frame));
  await addPhoto(PHOTO[3]);
  const offlineShown = await until("drawn offline", async () => (await photosIn(frame)).filter((p) => p.drawn).length >= idsBefore8.length + 1, 15000);
  ok("8. offline, the added photo shows", !!offlineShown, JSON.stringify(await photosIn(frame)));
  const offlineId = idsIn(await markdown(frame)).find((id) => !idsBefore8.includes(id));
  await page.keyboard.type("Offline words.", { delay: 10 });
  await leave();
  await page.waitForTimeout(3000);
  ok("…the note page works and nothing reaches the server", (await sql`select count(*)::int as n from attachments where user_id = ${me}`)[0].n === rowsBefore);
  await context.setOffline(false);
  const offlineUp = await until("offline photo up", async () => offlineId && (await row(offlineId))?.status === "ready", 120000, 2000);
  ok("…online again, it uploads", !!offlineUp, `id ${offlineId}; ${JSON.stringify(await stored())}`);
  // The one refused in 6 goes at its own backoff time, which by now can be minutes away: noted, not required.
  const all = idsIn((await ourNotes())[0]?.content ?? "");
  const readyNow = (await sql`select count(*)::int as n from attachments where user_id = ${me} and status = 'ready' and id in ${sql(all.length ? all : ["none"])}`)[0].n;
  console.log(`  (photos in the note: ${all.length}; ready on the server: ${readyNow})`);

  // 9. Removing a photo: the save says so; the server marks it and doesn't put it back.
  frame = await openNote();
  const since9 = Date.now();
  await frame.evaluate((id) => {
    const editor = document.querySelector(".ProseMirror").editor;
    let at = null;
    editor.state.doc.descendants((node, pos) => {
      if (at === null && node.type.name === "image" && node.attrs.src === `attachment:${id}`) at = pos;
    });
    if (at !== null) editor.chain().focus().setNodeSelection(at).run();
  }, firstId);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(400);
  if (idsIn(await markdown(frame)).includes(firstId)) {
    // The key didn't reach the editor's frame: take it out the way the editor's own Backspace would.
    console.log("  (Backspace didn't reach the editor; deleting the selected photo node directly)");
    await frame.evaluate(() => document.querySelector(".ProseMirror").editor.chain().focus().deleteSelection().run());
    await page.waitForTimeout(400);
  }
  ok("9. the photo is gone from the note", !idsIn(await markdown(frame)).includes(firstId));
  await leave();
  const removal = await until("removal sent", async () => sentTo("/_api/notes/update", since9).map((s) => parsed(s.body)).find((b) => b?.removedPhotos?.includes(firstId)), 40000);
  ok("…the save carries removedPhotos with its id", !!removal, `${sentTo("/_api/notes/update", since9).length} note saves since; outbox ${JSON.stringify(await stored())}; bodies ${sentTo("/_api/notes/update", since9).map((s) => JSON.stringify(parsed(s.body)?.removedPhotos ?? null)).join(" ")}`);
  ok("…its orphanedSince is set", !!(await until("marked", async () => (await row(firstId))?.orphaned_since, 15000)));
  ok("…and it isn't appended back", !((await ourNotes())[0]?.content ?? "").includes(firstId));

  // 10. Photos off: after a reload, no Photo tool.
  photosOff = true;
  // usage is kept fresh for 10 minutes in the stored query cache: start as a fresh app would (the
  // cache is cleared before the app's scripts run, so a write on unload can't put it back).
  await context.addInitScript(() => {
    if (window.name === "sage-check-fresh") {
      window.name = "";
      localStorage.removeItem("clarity:query-cache:v1");
    }
  });
  await page.evaluate(() => { window.name = "sage-check-fresh"; });
  const since10 = Date.now();
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2500);
  frame = await openNote();
  await toEnd(frame);
  await until("usage asked", async () => sentTo("/_api/attachments/usage", since10).length > 0, 15000);
  await page.waitForTimeout(800);
  const offTools = await toolNames();
  ok("10. photos off: the Photo tool isn't there", offTools.length > 0 && !offTools.includes("Photo"), offTools.join(", "));
  await leave();
  photosOff = false;
  // Photos on again, from a fresh answer (the off one would be kept for 10 minutes).
  await page.evaluate(() => { window.name = "sage-check-fresh"; });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2500);

  // 12. Deleting the note from its menu: its links go, its photos are marked.
  const before12 = idsIn((await ourNotes())[0]?.content ?? "");
  frame = await openNote();
  await btn("More: archive or delete this note").click();
  await page.waitForTimeout(400);
  await press("Delete");
  await page.waitForTimeout(300);
  await press("Delete");
  const gone = await until("deleted", async () => (await ourNotes()).length === 0, 30000);
  ok("12. deleted from its menu: the note is gone", !!gone);
  ok("…its links are gone", noteId ? (await linksOf(noteId)).length === 0 : false);
  const marks = await sql`select id, orphaned_since from attachments where user_id = ${me} and id in ${sql(before12.length ? before12 : ["none"])}`;
  ok("…its photos are marked", marks.length > 0 && marks.every((m) => m.orphaned_since), JSON.stringify(marks.map((m) => !!m.orphaned_since)));

  // 11. Signing out with a photo waiting: the warning says so; the photos go with the sign-out.
  failStart = true;
  await btn("New note or task").click();
  await page.waitForTimeout(600);
  await btn("New note").click();
  frame = await waitEditor();
  await page.getByLabel("Title").fill(TITLE);
  await frame.locator(".ProseMirror").click();
  await page.keyboard.type("A photo that won't go.", { delay: 10 });
  await addPhoto(PHOTO[4]);
  await page.waitForTimeout(1000);
  await leave();
  await until("waiting", async () => (await stored()).waiting > 0, 20000);
  // A download held across the sign-out: a note made "on another device" (straight through the
  // local server) whose photo this browser doesn't have, opened while bucket GETs are held.
  const otherId = `dl-${Date.now().toString(36)}`;
  const bytes = Buffer.from(await (await import("node:fs/promises")).readFile(PHOTO[0]));
  const st = await api("POST", "/_api/attachments/start", { id: otherId, contentType: "image/png", bytes: bytes.length });
  await fetch(st.data.upload.url, { method: "PUT", headers: st.data.upload.headers, body: bytes });
  await api("POST", "/_api/attachments/confirm", { id: otherId });
  await api("POST", "/_api/notes/create", { id: crypto.randomUUID(), title: DOWNLOAD_TITLE, content: `![](attachment:${otherId})` });
  holdGets = 8000;
  await page.reload({ waitUntil: "load" }); // the list picks up the note made elsewhere
  await page.waitForTimeout(2500);
  frame = await openNote(DOWNLOAD_TITLE);
  await until("view asked", async () => sentTo("/_api/attachments/view").some((s) => s.body.includes(otherId)), 15000);
  await leave();
  await page.getByRole("tab", { name: "Today" }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await btn("Settings").click();
  await page.waitForTimeout(800);
  await btn("Sign out").click();
  await page.waitForTimeout(500);
  const warning = await text();
  ok("11. the sign-out warning names unsent photos", /photos haven't reached the server/.test(warning), warning.slice(0, 200));
  await page.getByRole("button", { name: "Sign out", exact: true }).last().click();
  const emptied = await until("emptied", async () => (await idb()) <= 0, 10000);
  await page.screenshot({ path: `${OUT}/11-signed-out.png` });
  const signedOut = await page.evaluate(() => !window.Clerk?.session?.id);
  if (!signedOut) console.log("  (still signed in after pressing Sign out)");
  ok("…accepted: IndexedDB clarity-photos is empty", !!emptied, `${await idb()} photos left`);
  await page.waitForTimeout(holdGets + 1000);
  ok("…and a download in flight across the sign-out wrote nothing back", (await idb()) <= 0 && !(await idb(otherId)), `${await idb()} photos; the held one ${(await idb(otherId)) ? "written back" : "absent"}`);
  holdGets = 0;
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", String(error.message).split("\n").slice(0, 3).join(" | "));
  await page.screenshot({ path: `${OUT}/stopped.png` }).catch(() => {});
} finally {
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  // Leftovers in the local database only.
  await sql`delete from notes where user_id = ${me} and (title like ${TITLE + "%"} or title like ${OTHER_TITLE + "%"} or title = ${DOWNLOAD_TITLE})`.catch(() => {});
  await session.close().catch(() => {});
  await sql.end();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
