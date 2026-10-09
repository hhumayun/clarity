// Integration checks for photos in notes (docs/photos-server.md, 11.2), against
// the REAL server.ts on http://localhost:3410 with the local database (PGlite,
// :5440) and the local bucket (versitygw, :9400). Signs in as the Clerk test
// account through Sage's web build on :8095 only to get tokens; every request
// goes to the local server, every row it writes is in the local database.
// Reads and moves rows in the local database directly where a check needs
// time to pass. Never calls /_api/account/delete (it would delete the Clerk
// user).
//
//   ./stack.sh start && ./run-server.sh --background && ./stack.sh proxy
//   node api-check.mjs                 checks 1-15, 18, 20, 21, then sweep-check.ts (16, 17, 24) and ai-clean.ts (19)
//   node api-check.mjs --only 2,3,9    just those groups (numbers as in the design)
//   node api-check.mjs --no-restarts   skip the groups that restart the server or stop the bucket (8's rate limit, 20, 21)
//
// Not here: 22 (the existing checks and typecheck: README), 23 (the main app, out of scope).
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  sql, ok, results, group, signIn, headKey, listKeys, putKey, emptyPrefix, photoBytes, newId,
  callHelper, restartServer, stack, sleep, HERE, ROOT, NODE, LOCAL, STACK_DIR, Bucket, CHECK_ENV,
} from "./lib.mjs";

const args = process.argv.slice(2);
const onlyArg = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const only = onlyArg ? new Set(onlyArg.split(",").map((n) => Number(n.trim()))) : null;
const restarts = !args.includes("--no-restarts");
const want = (n) => !only || only.has(n);

const TITLE = "Photo check";
const JPEG = "image/jpeg";
const MB = 1024 * 1024;

// --- client side of the API ------------------------------------------------------

let S; // the signed-in session
let api;
let me; // the test account's local users.id
let other; // a second local user that never signs in

// start/confirm share a per-user brake of 60 a minute in the server's memory.
// Keep under it everywhere except the check that hits it on purpose.
const uploadCalls = [];
async function throttle() {
  for (;;) {
    const now = Date.now();
    while (uploadCalls.length && uploadCalls[0] < now - 61_000) uploadCalls.shift();
    if (uploadCalls.length < 55) { uploadCalls.push(now); return; }
    await sleep(uploadCalls[0] + 61_000 - now);
  }
}
const start = async (id, bytes, contentType = JPEG, extra = {}) => { await throttle(); return api("POST", "/_api/attachments/start", { id, contentType, bytes, ...extra }); };
const confirm = async (id) => { await throttle(); return api("POST", "/_api/attachments/confirm", { id }); };
const view = (ids) => api("POST", "/_api/attachments/view", { ids });
const del = (id) => api("POST", "/_api/attachments/delete", { id });
const usage = () => api("GET", "/_api/attachments/usage");
const putTo = (upload, body, contentType) =>
  fetch(upload.url, { method: upload.method ?? "PUT", headers: { ...upload.headers, ...(contentType ? { "Content-Type": contentType } : {}) }, body }).then((r) => r.status);

/** A photo through start, PUT and confirm. */
async function readyPhoto(bytes = 2000, id = newId(), seed = 7) {
  const body = photoBytes(bytes, seed);
  const s = await start(id, bytes);
  if (s.status !== 200 || s.data?.status !== "pending") throw new Error(`start ${id}: ${s.status} ${s.text.slice(0, 160)}`);
  const put = await putTo(s.data.upload, body);
  if (put !== 200) throw new Error(`PUT ${id}: ${put}`);
  const c = await confirm(id);
  if (c.status !== 200) throw new Error(`confirm ${id}: ${c.status} ${c.text.slice(0, 160)}`);
  return { id, body, key: (await row(me, id)).storage_key };
}

const createNote = async (content, doc, extra = {}) => {
  const r = await api("POST", "/_api/notes/create", { id: randomUUID(), createdAt: new Date(), title: `${TITLE} ${Date.now().toString(36)}`, content, ...(doc ? { doc } : {}), ...extra });
  if (r.status !== 200) throw new Error(`notes/create: ${r.status} ${r.text.slice(0, 200)}`);
  return r;
};
const updateNote = (body) => api("POST", "/_api/notes/update", body);
const token = (id) => `![](attachment:${id})`;
const docWith = (text, ids = []) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...ids.map((id) => ({ type: "image", attrs: { src: `attachment:${id}` } }))],
});

// --- the local database ------------------------------------------------------------

const row = async (userId, id) => (await sql`select * from attachments where user_id = ${userId} and id = ${id}`)[0];
const links = async (noteId) => (await sql`select attachment_id from note_attachments where note_id = ${noteId} order by 1`).map((r) => r.attachment_id);
const noteRow = async (noteId) => (await sql`select content, doc, title, archived from notes where id = ${noteId}`)[0];
const queued = async (key) => (await sql`select * from storage_deletions where storage_key = ${key}`)[0];
const docOf = (value) => (typeof value === "string" ? JSON.parse(value) : value);
const near = (date, ms, slack = 90_000) => Math.abs(new Date(date).getTime() - (Date.now() + ms)) < slack;

/** Clears this check's rows and objects for both local users (the local database only). */
async function reset() {
  for (const u of [me, other]) {
    await sql`delete from note_attachments where user_id = ${u}`;
    await sql`delete from attachments where user_id = ${u}`;
    await sql`delete from storage_deletions where storage_key like ${`u/${u}/%`}`;
    await emptyPrefix(`u/${u}/`);
  }
  await sql`delete from notes where user_id in (${me}, ${other}) and title like ${TITLE + "%"}`;
}

const sweep = (extraEnv = {}, opts = {}) => {
  return callHelper("helpers/attachmentSweep.tsx", "sweepAttachments", [opts], { extraEnv, photos: extraEnv.__photosOff ? false : true });
};
const freeLeases = () => sql`delete from maintenance_leases where name = 'attachment-sweep'`;

// --- the run --------------------------------------------------------------------------

try {
  S = await signIn();
  api = S.api;
  me = (await sql`select id from users where email = ${S.email}`)[0]?.id;
  if (!me) throw new Error("the local server didn't make the test account's users row");
  other = (await sql`
    insert into users (clerk_id, email, display_name) values ('local-other', 'other@local.test', 'Other (local only)')
    on conflict (clerk_id) do update set email = excluded.email returning id`)[0].id;
  console.log(`test account: local user ${me}; other user ${other}`);
  await reset();

  if (want(1)) await group("1. usage", async () => {
    const u = await usage();
    ok("200, enabled, nothing used", u.status === 200 && u.data?.enabled === true && u.data?.usedBytes === 0 && u.data?.photos === 0, u.text.slice(0, 200));
    ok("says the limits: 1 GB, 10 MB, 10,000", u.data?.quotaBytes === 1024 * MB && u.data?.maxPhotoBytes === 10 * MB && u.data?.maxPhotos === 10_000, u.text.slice(0, 200));
  });

  let shared; // { id, body, upload } from check 2, used by 3-5
  if (want(2) || want(3) || want(4) || want(5)) await group("2. start", async () => {
    const id = newId();
    const body = photoBytes(3000, 2);
    const s = await start(id, body.length, JPEG, { width: 40, height: 30 });
    ok("pending, with an upload link", s.status === 200 && s.data?.status === "pending" && typeof s.data?.upload?.url === "string", s.text.slice(0, 200));
    const url = new URL(s.data.upload.url);
    const signed = url.searchParams.get("X-Amz-SignedHeaders") ?? "";
    ok("the link signs content-length and content-type", signed.includes("content-length") && signed.includes("content-type"), signed);
    ok("PUT with the Content-Type it was given", s.data.upload.method === "PUT" && s.data.upload.headers?.["Content-Type"] === JPEG);
    ok("the link lasts 15 minutes", url.searchParams.get("X-Amz-Expires") === "900" && near(s.data.upload.expiresAt, 15 * 60_000));
    const r = await row(me, id);
    ok("a pending row, key under u/<id>/", r?.status === "pending" && r.storage_key.startsWith(`u/${me}/${id}/`) && r.bytes === body.length && r.width === 40, JSON.stringify(r));
    ok("the link is for that key", decodeURIComponent(url.pathname).endsWith(r.storage_key));
    shared = { id, body, upload: s.data.upload };
  });

  if (want(3) || want(4)) await group("3-4. PUT and confirm", async () => {
    const { id, body, upload } = shared;
    const c0 = await confirm(id);
    ok("4. confirm before any PUT: 409 NOT_UPLOADED", c0.status === 409 && c0.data?.code === "NOT_UPLOADED", `${c0.status} ${c0.text.slice(0, 120)}`);
    ok("3. one byte more: 403", (await putTo(upload, Buffer.concat([body, Buffer.from([0])]))) === 403);
    ok("3. one byte less: 403", (await putTo(upload, body.subarray(1))) === 403);
    ok("3. as text/html: 403", (await putTo(upload, body, "text/html")) === 403);
    ok("3. the right bytes: 200", (await putTo(upload, body)) === 200);
    const c = await confirm(id);
    ok("4. confirm after: ready", c.status === 200 && c.data?.attachment?.id === id && !!c.data?.attachment?.confirmedAt, c.text.slice(0, 200));
    const r = await row(me, id);
    ok("4. row ready, confirmed_at set, orphaned_since set (no note names it)", r?.status === "ready" && !!r.confirmed_at && !!r.orphaned_since, JSON.stringify(r));
  });

  if (want(5)) await group("5. start and confirm again for a ready photo", async () => {
    const { id, body } = shared;
    const s = await start(id, body.length);
    ok("start: ready, no link", s.status === 200 && s.data?.status === "ready" && !s.data?.upload && s.data?.attachment?.id === id, s.text.slice(0, 200));
    const c = await confirm(id);
    ok("confirm: the same answer", c.status === 200 && c.data?.attachment?.id === id);
  });

  if (want(6)) await group("6. old links can't grow a photo", async () => {
    const id = newId();
    const big = photoBytes(10 * MB, 6);
    const s1 = await start(id, big.length);
    ok("start at 10 MB: pending", s1.status === 200 && s1.data?.status === "pending", s1.text.slice(0, 160));
    const keyBefore = (await row(me, id))?.storage_key;
    const s2 = await start(id, 1);
    ok("start again at 1 byte: 409 UPLOAD_CHANGED", s2.status === 409 && s2.data?.code === "UPLOAD_CHANGED", `${s2.status} ${s2.text.slice(0, 120)}`);
    const s2b = await start(id, big.length, "image/png");
    ok("start again as PNG: 409 UPLOAD_CHANGED", s2b.status === 409 && s2b.data?.code === "UPLOAD_CHANGED", `${s2b.status}`);
    ok("the row still says 10 MB", (await row(me, id))?.bytes === big.length);
    const s3 = await start(id, big.length);
    ok("start again with the same values: the same key", s3.status === 200 && (await row(me, id))?.storage_key === keyBefore && decodeURIComponent(new URL(s3.data.upload.url).pathname).endsWith(keyBefore));
    ok("PUT 10 MB through the first link: 200", (await putTo(s1.data.upload, big)) === 200);
    const c = await confirm(id);
    ok("confirm: ready at 10 MB", c.status === 200 && c.data?.attachment?.bytes === big.length, c.text.slice(0, 160));
    const head = await headKey(keyBefore);
    ok("the bucket object's size equals the row's", head?.bytes === big.length, JSON.stringify(head));
  });

  if (want(7)) await group("7. size and id rules", async () => {
    const tooBig = await start(newId(), 10 * MB + 1);
    ok("over 10 MB: 413 TOO_LARGE", tooBig.status === 413 && tooBig.data?.code === "TOO_LARGE", `${tooBig.status} ${tooBig.text.slice(0, 120)}`);
    for (const bad of ["../x", "abcdefg", "a".repeat(65), "has space1"]) {
      const r = await start(bad, 100);
      ok(`bad id ${JSON.stringify(bad.length > 12 ? bad.slice(0, 8) + "…(" + bad.length + ")" : bad)}: 400`, r.status === 400, `${r.status}`);
    }
    const gif = await start(newId(), 100, "image/gif");
    ok("a GIF: 400", gif.status === 400, `${gif.status}`);
  });

  if (want(8)) await group("8. limits", async () => {
    await reset();
    // Quota: 102 photos of 10 MB, then a pending one of 3 MB: 1 MB left.
    await sql`insert into attachments (user_id, id, content_type, bytes, storage_key, status, confirmed_at)
      select ${me}, 'fill-' || lpad(g::text, 4, '0'), 'image/jpeg', 10485760, ${`u/${me}/fill-`}::text || g::text || '/x', 'ready', now() from generate_series(1, 102) g`;
    const x = newId();
    const sx = await start(x, 3 * MB);
    ok("a 3 MB start with 4 MB left: pending", sx.status === 200 && sx.data?.status === "pending", `${sx.status} ${sx.text.slice(0, 120)}`);
    const again = await start(x, 3 * MB);
    ok("restarting that pending photo doesn't count it twice", again.status === 200 && again.data?.status === "pending", `${again.status} ${again.text.slice(0, 120)}`);
    const over = await start(newId(), 2 * MB);
    ok("a new 2 MB photo with 1 MB left: 413 QUOTA_FULL", over.status === 413 && over.data?.code === "QUOTA_FULL", `${over.status} ${over.text.slice(0, 120)}`);
    const u = await usage();
    ok("usage counts pending and ready", u.data?.usedBytes === 102 * 10485760 + 3 * MB && u.data?.photos === 103, u.text.slice(0, 200));
    // A photo deleted in the last 20 minutes still counts (an old link may still put it back).
    await del(x);
    const afterDelete = await start(newId(), 2 * MB);
    ok("a 2 MB start with a 3 MB photo deleted just now: 413 QUOTA_FULL", afterDelete.status === 413 && afterDelete.data?.code === "QUOTA_FULL", `${afterDelete.status} ${afterDelete.text.slice(0, 120)}`);
    await sql`update storage_deletions set not_before = now() - interval '1 minute' where user_id = ${me}`;
    const afterLinks = await start(newId(), 2 * MB);
    ok("…once its links can't be used any more: pending", afterLinks.status === 200 && afterLinks.data?.status === "pending", `${afterLinks.status} ${afterLinks.text.slice(0, 120)}`);
    await reset();

    // 20 pending.
    await sql`insert into attachments (user_id, id, content_type, bytes, storage_key)
      select ${me}, 'pend-' || lpad(g::text, 4, '0'), 'image/jpeg', 1000, ${`u/${me}/pend-`}::text || g::text || '/x' from generate_series(1, 20) g`;
    const p21 = await start(newId(), 1000);
    ok("a 21st new id with 20 pending: 429 TOO_MANY_PENDING", p21.status === 429 && p21.data?.code === "TOO_MANY_PENDING", `${p21.status} ${p21.text.slice(0, 120)}`);
    const p1 = await start("pend-0001", 1000);
    ok("restarting one of the 20 works", p1.status === 200 && p1.data?.status === "pending", `${p1.status} ${p1.text.slice(0, 120)}`);
    await reset();

    // 10,000 photos.
    await sql`insert into attachments (user_id, id, content_type, bytes, storage_key, status, confirmed_at)
      select ${me}, 'many-' || lpad(g::text, 5, '0'), 'image/jpeg', 1, ${`u/${me}/many-`}::text || g::text || '/x', 'ready', now() from generate_series(1, 10000) g`;
    const lim = await start(newId(), 1000);
    ok("a new id at 10,000 photos: 413 PHOTO_LIMIT", lim.status === 413 && lim.data?.code === "PHOTO_LIMIT", `${lim.status} ${lim.text.slice(0, 120)}`);
    await reset();

    if (restarts) {
      // A fresh server forgets the brake, so the count starts at 0.
      restartServer();
      uploadCalls.length = 0;
      const id = newId();
      let first429 = 0;
      for (let i = 1; i <= 61; i++) {
        const r = await api("POST", "/_api/attachments/start", { id, contentType: JPEG, bytes: 1000 });
        if (r.status === 429 && !first429) { first429 = i; ok("…the refusal is RATE_LIMITED", r.data?.code === "RATE_LIMITED", r.text.slice(0, 120)); }
      }
      ok("61 starts in a minute: the 61st gives 429", first429 === 61, `first 429 at call ${first429 || "none"}`);
      restartServer();
      uploadCalls.length = 0;
    } else {
      console.log("  (rate limit skipped: --no-restarts)");
    }
  });

  if (want(9)) await group("9. view", async () => {
    await reset();
    const a = await readyPhoto(2500, newId(), 9);
    const pendingId = newId();
    await start(pendingId, 1000);
    const theirs = newId();
    await sql`insert into attachments (user_id, id, content_type, bytes, storage_key, status, confirmed_at) values (${other}, ${theirs}, 'image/jpeg', 10, ${`u/${other}/${theirs}/x`}, 'ready', now())`;
    const unknown = newId();
    const v = await view([a.id, pendingId, unknown, "abc", "../x", theirs]);
    ok("200", v.status === 200, `${v.status} ${v.text.slice(0, 160)}`);
    const p = v.data?.photos ?? {};
    ok("every asked id is a key", [a.id, pendingId, unknown, "abc", "../x", theirs].every((k) => k in p));
    ok("a link for the ready photo, with its type", typeof p[a.id]?.url === "string" && p[a.id]?.contentType === JPEG);
    ok("null for pending, unknown, malformed and the other user's", [pendingId, unknown, "abc", "../x", theirs].every((k) => p[k] === null), JSON.stringify(p).slice(0, 300));
    const got = await fetch(p[a.id].url);
    const bytes = Buffer.from(await got.arrayBuffer());
    ok("the link downloads the same bytes", got.status === 200 && bytes.equals(a.body), `${got.status} ${bytes.length}`);
    ok("the link lasts 10 minutes", new URL(p[a.id].url).searchParams.get("X-Amz-Expires") === "600");
    const many = await view(Array.from({ length: 101 }, (_, i) => `id-${i}-xxxxxxxx`));
    ok("101 ids: 400", many.status === 400, `${many.status}`);
    const short = callHelper("helpers/bucket.tsx", "presignView", ["$bucket", a.key, 1]);
    await sleep(2500);
    const late = await fetch(short.url);
    ok("a link signed for 1 s fails after it", late.status === 403, `${late.status}`);
  });

  if (want(10)) await group("10. another user's photos", async () => {
    await reset();
    const id = newId();
    await sql`insert into attachments (user_id, id, content_type, bytes, storage_key) values (${other}, ${id}, 'image/jpeg', 1234, ${`u/${other}/${id}/x`})`;
    const c = await confirm(id);
    ok("their id through confirm: 404 NOT_FOUND", c.status === 404 && c.data?.code === "NOT_FOUND", `${c.status} ${c.text.slice(0, 120)}`);
    const d = await del(id);
    ok("their id through delete: { deleted: true }", d.status === 200 && d.data?.deleted === true, `${d.status} ${d.text.slice(0, 120)}`);
    ok("…and their row is untouched", (await row(other, id))?.bytes === 1234);
    const s = await start(id, 1000);
    ok("starting the same id: works", s.status === 200 && s.data?.status === "pending", `${s.status}`);
    const mine = await row(me, id);
    ok("…a separate row and key", !!mine && mine.storage_key !== (await row(other, id)).storage_key && mine.storage_key.startsWith(`u/${me}/`));
  });

  if (want(11)) await group("11. note saves keep links", async () => {
    await reset();
    const a = await readyPhoto(1500, newId(), 11);
    const b = newId(); // named only in the doc, never uploaded
    const made = await createNote(`Words before.\n\n${token(a.id)}\n\nWords after.`, docWith("Words before.", [b]));
    const noteId = made.data.note.id;
    ok("create: a link for each (one in Markdown, one only in the doc)", JSON.stringify(await links(noteId)) === JSON.stringify([a.id, b].sort()), JSON.stringify(await links(noteId)));
    ok("create: missingPhotos lists the one not uploaded", JSON.stringify(made.data?.missingPhotos) === JSON.stringify([b]), JSON.stringify(made.data?.missingPhotos));
    ok("the named photo's mark is cleared", (await row(me, a.id))?.orphaned_since === null);

    const up = await updateNote({ id: noteId, content: "Words before.\n\nWords after.", doc: docWith("Words before.", [b]), removedPhotos: [a.id] });
    ok("update with one removed and listed in removedPhotos: 200", up.status === 200, `${up.status} ${up.text.slice(0, 160)}`);
    ok("…one link left", JSON.stringify(await links(noteId)) === JSON.stringify([b]), JSON.stringify(await links(noteId)));
    ok("…the removed photo gets orphanedSince", !!(await row(me, a.id))?.orphaned_since);
    ok("…and isn't put back", !(await noteRow(noteId)).content.includes(a.id));

    await updateNote({ id: noteId, content: `Again ${token(a.id)}`, doc: docWith("Again", [a.id, b]) });
    ok("named again: the mark is cleared", (await row(me, a.id))?.orphaned_since === null);

    const second = await createNote(`Also here ${token(a.id)}`);
    await updateNote({ id: second.data.note.id, content: "Not any more", removedPhotos: [a.id] });
    ok("the same photo in two notes, removed from one: not marked", (await row(me, a.id))?.orphaned_since === null);

    // More than 200 ids: the words are kept, only the first 200 (sorted) get links, nothing is put back.
    const manyIds = Array.from({ length: 201 }, (_, i) => `many-${String(i).padStart(4, "0")}-ids`);
    const tooMany = manyIds.map(token).join("\n\n");
    const r201 = await updateNote({ id: noteId, content: tooMany });
    ok("a save naming 201 ids: 200, the words kept", r201.status === 200 && (await noteRow(noteId)).content === tooMany, `${r201.status} ${r201.text.slice(0, 120)}`);
    ok("…links for the first 200 only", JSON.stringify(await links(noteId)) === JSON.stringify(manyIds.slice(0, 200)), `${(await links(noteId)).length} links`);
    const c201 = await api("POST", "/_api/notes/create", { id: randomUUID(), title: `${TITLE} 201`, content: tooMany });
    ok("a new note naming 201 ids: 200, 200 links", c201.status === 200 && (await links(c201.data?.note?.id)).length === 200, `${c201.status}`);
  });

  if (want(12)) await group("12. saves that don't say they removed a photo", async () => {
    await reset();
    const p = await readyPhoto(1200, newId(), 12);
    const made = await createNote(`First words.\n\n${token(p.id)}`, docWith("First words.", [p.id]));
    const noteId = made.data.note.id;

    const oldClient = await updateNote({ id: noteId, content: "First words. And more typed on an old client." });
    ok("an old-client save without the token: 200", oldClient.status === 200, `${oldClient.status} ${oldClient.text.slice(0, 160)}`);
    let n = await noteRow(noteId);
    ok("…the typed words are kept", n.content.startsWith("First words. And more typed on an old client."));
    ok("…the stored content ends with the photo", n.content.trimEnd().endsWith(token(p.id)), JSON.stringify(n.content.slice(-80)));
    ok("…the link stays", (await links(noteId)).includes(p.id));
    ok("…the answer is the stored note", oldClient.data?.note?.content === n.content);

    // An editor that keeps a doc but doesn't know photos: the image node comes back too.
    await updateNote({ id: noteId, content: `Rich words.\n\n${token(p.id)}`, doc: docWith("Rich words.", [p.id]) });
    await updateNote({ id: noteId, content: "Rich words, edited.", doc: docWith("Rich words, edited.") });
    n = await noteRow(noteId);
    const d = docOf(n.doc);
    ok("a doc save without the image: the doc ends with the image node", d?.content?.at(-1)?.type === "image" && d.content.at(-1).attrs?.src === `attachment:${p.id}`, JSON.stringify(d?.content?.at(-1)));
    ok("…and the Markdown with the token", n.content.trimEnd().endsWith(token(p.id)));

    // The web app: content only (doc cleared), token kept.
    const webContent = `Web words.\n\n${token(p.id)}\n\nMore web words.`;
    await updateNote({ id: noteId, content: webContent });
    n = await noteRow(noteId);
    ok("a web-app content-only save with the token kept: nothing appended", n.content === webContent, JSON.stringify(n.content.slice(-60)));
    ok("…the link stays", (await links(noteId)).includes(p.id));

    // A stale second device: older content without p2 (added since), removing p.
    const p2 = await readyPhoto(1300, newId(), 13);
    await updateNote({ id: noteId, content: `${webContent}\n\n${token(p2.id)}` });
    const stale = await updateNote({ id: noteId, content: "Stale words from another device.", removedPhotos: [p.id] });
    n = await noteRow(noteId);
    ok("a stale save: 200", stale.status === 200);
    ok("…the newer photo comes back", n.content.includes(token(p2.id)) && (await links(noteId)).includes(p2.id));
    ok("…the listed one goes", !n.content.includes(p.id) && !(await links(noteId)).includes(p.id));

    const beforeTitle = n.content;
    await updateNote({ id: noteId, title: `${TITLE} renamed` });
    await updateNote({ id: noteId, archived: true });
    n = await noteRow(noteId);
    ok("a title-only update and an archive: nothing appended", n.content === beforeTitle && n.archived === true);
    ok("…links kept", (await links(noteId)).includes(p2.id));
  });

  if (want(13)) await group("13. note delete", async () => {
    await reset();
    const solo = await readyPhoto(1000, newId(), 21);
    const both = await readyPhoto(1000, newId(), 22);
    const n1 = await createNote(`${token(solo.id)}\n\n${token(both.id)}`);
    await createNote(token(both.id));
    const d = await api("POST", "/_api/notes/delete", { id: n1.data.note.id });
    ok("delete: 200", d.status === 200, `${d.status} ${d.text.slice(0, 120)}`);
    ok("its links are gone", (await links(n1.data.note.id)).length === 0);
    ok("a photo only that note named is marked", !!(await row(me, solo.id))?.orphaned_since);
    ok("one another note names is not", (await row(me, both.id))?.orphaned_since === null);
  });

  if (want(14)) await group("14. delete", async () => {
    await reset();
    const linked = await readyPhoto(1000, newId(), 31);
    await createNote(token(linked.id));
    const r1 = await del(linked.id);
    ok("a photo a link names: 409 IN_USE", r1.status === 409 && r1.data?.code === "IN_USE", `${r1.status} ${r1.text.slice(0, 120)}`);
    const textOnly = await readyPhoto(1000, newId(), 32);
    await createNote(token(textOnly.id));
    await sql`delete from note_attachments where user_id = ${me} and attachment_id = ${textOnly.id}`;
    const r2 = await del(textOnly.id);
    ok("no link but named in a note's text: 409 IN_USE", r2.status === 409 && r2.data?.code === "IN_USE", `${r2.status} ${r2.text.slice(0, 120)}`);
    const free = await readyPhoto(1000, newId(), 33);
    const r3 = await del(free.id);
    ok("unnamed: { deleted: true }", r3.status === 200 && r3.data?.deleted === true, `${r3.status} ${r3.text.slice(0, 120)}`);
    ok("…row gone", !(await row(me, free.id)));
    ok("…object gone", !(await headKey(free.key)));
    const q = await queued(free.key);
    ok("…queued, not before about 20 minutes from now", !!q && near(q.not_before, 20 * 60_000), JSON.stringify(q));
    const r4 = await del(free.id);
    ok("again: { deleted: true }", r4.status === 200 && r4.data?.deleted === true);
    // A pending upload goes even when a note names it (its upload can start afresh).
    const pendingId = newId();
    await start(pendingId, 1000);
    await createNote(token(pendingId));
    const r5 = await del(pendingId);
    ok("a pending photo a note names: { deleted: true }", r5.status === 200 && r5.data?.deleted === true && !(await row(me, pendingId)), `${r5.status} ${r5.text.slice(0, 120)}`);
  });

  if (want(15)) await group("15. a link used after delete", async () => {
    await reset();
    const id = newId();
    const body = photoBytes(1800, 15);
    const s = await start(id, body.length);
    const key = (await row(me, id)).storage_key;
    await del(id);
    ok("a PUT through the old link still lands", (await putTo(s.data.upload, body)) === 200 && !!(await headKey(key)));
    ok("…its queue row is still there, with its owner and size", (await queued(key))?.user_id === me && (await queued(key))?.bytes === body.length, JSON.stringify(await queued(key)));
    await sql`update storage_deletions set not_before = now() - interval '1 minute' where storage_key = ${key}`;
    await freeLeases();
    sweep();
    ok("after not_before and a sweep: the object is gone", !(await headKey(key)));
    ok("…and the row", !(await queued(key)));
  });

  if (want(18)) await group("18. export", async () => {
    await reset();
    const named = await readyPhoto(1400, newId(), 41);
    const orphan = await readyPhoto(1400, newId(), 42);
    const pendingId = newId();
    await start(pendingId, 1000);
    const n = await createNote(`${token(named.id)}\n\n${token(pendingId)}`);
    const e = await api("GET", "/_api/account/export");
    ok("200", e.status === 200, `${e.status} ${e.text.slice(0, 120)}`);
    const photos = e.data?.photos ?? [];
    const mine = photos.find((p) => p.id === named.id);
    ok("lists the ready photo a note names, with noteIds", !!mine && JSON.stringify(mine.noteIds) === JSON.stringify([n.data.note.id]), JSON.stringify(mine));
    ok("the orphaned one is absent", !photos.some((p) => p.id === orphan.id));
    ok("the pending one is absent", !photos.some((p) => p.id === pendingId));
    ok("photoLinksExpireAt is about an hour away", !!e.data?.photoLinksExpireAt && near(e.data.photoLinksExpireAt, 60 * 60_000));
    ok("photoLinksNote is there", typeof e.data?.photoLinksNote === "string" && e.data.photoLinksNote.length > 10);
    // A signed link's path is the key itself, so the key may appear inside each url, nowhere else.
    const withoutUrls = JSON.stringify({ ...e.data, photos: photos.map(({ url, ...rest }) => rest) });
    ok("no storageKey anywhere in the body (outside the signed links)", !/storageKey|storage_key/.test(e.text) && !withoutUrls.includes(named.key));
    if (mine?.url) {
      ok("the link lasts 3600 s", new URL(mine.url).searchParams.get("X-Amz-Expires") === "3600");
      const got = await fetch(mine.url);
      const bytes = Buffer.from(await got.arrayBuffer());
      ok("it downloads the bytes", got.status === 200 && bytes.equals(named.body), `${got.status}`);
      ok("…as an attachment", /^attachment/.test(got.headers.get("content-disposition") ?? ""), got.headers.get("content-disposition") ?? "none");
    } else ok("each photo has a url", false);
  });

  if (want(20) && restarts) await group("20. the bucket down", async () => {
    await reset();
    const id = newId();
    const body = photoBytes(1000, 20);
    const s = await start(id, body.length);
    await putTo(s.data.upload, body);
    const logFile = join(STACK_DIR, "server.log");
    const leaks = new RegExp(`127\\.0\\.0\\.1|9400|${Bucket}`);
    const mark = statSync(logFile).size;
    stack("s3-stop");
    try {
      const c = await confirm(id);
      ok("confirm: 503 PHOTOS_UNAVAILABLE", c.status === 503 && c.data?.code === "PHOTOS_UNAVAILABLE", `${c.status} ${c.text.slice(0, 120)}`);
      ok("…the body names neither the host, the port nor the bucket", !leaks.test(c.text));
      const st = await start(newId(), 1000);
      ok("start (presigning is local) still works", st.status === 200 && st.data?.status === "pending", `${st.status}`);
      await sleep(500);
      const log = readFileSync(logFile, "utf8").slice(mark);
      const lines = log.split("\n").filter((l) => /bucket/i.test(l));
      ok("the server log says the error by name and status only", lines.length > 0 && lines.every((l) => /^bucket .+ failed: \S+ \S+$/.test(l.trim())) && !leaks.test(log), lines.slice(0, 3).join(" | ") || "no bucket line");
      await sql`insert into storage_deletions (storage_key, not_before) values (${`u/${me}/down-${Date.now()}/x`}, now() - interval '1 minute')`;
      await freeLeases();
      const t0 = Date.now();
      sweep({ ATTACHMENT_SWEEP_BUDGET_MS: "20000" });
      ok("a sweep run ends within its budget", Date.now() - t0 < 60_000, `${Date.now() - t0} ms`);
      const [lease] = await sql`select held_until <= now() as free from maintenance_leases where name = 'attachment-sweep'`;
      ok("…and releases the lease", lease?.free === true);
    } finally {
      stack("s3-start");
    }
  });

  if (want(21) && restarts) await group("21. photos off", async () => {
    await reset();
    restartServer(["--photos-off"]);
    try {
      const l = await api("GET", "/_api/notes/list");
      ok("the server starts; notes/list works", l.status === 200, `${l.status}`);
      const id = newId();
      const n = await createNote(`Photos off ${token(id)}`);
      ok("create works and still writes links", (await links(n.data.note.id)).includes(id));
      const u = await updateNote({ id: n.data.note.id, content: `Edited ${token(id)}` });
      ok("update works", u.status === 200);
      const g = await api("GET", `/_api/notes/get?id=${n.data.note.id}`);
      ok("notes/get works", g.status === 200 && g.data?.note?.content === `Edited ${token(id)}`, `${g.status}`);
      const tl = await api("GET", "/_api/tasks/list");
      ok("tasks/list works", tl.status === 200, `${tl.status} ${tl.text.slice(0, 100)}`);
      const tc = await api("POST", "/_api/tasks/create", { id: randomUUID(), text: `${TITLE} task, photos off`, projectName: `${TITLE} project`, noteId: n.data.note.id });
      ok("tasks/create works", tc.status === 200 && !!tc.data?.task?.id, `${tc.status} ${tc.text.slice(0, 100)}`);
      if (tc.data?.task?.id) {
        const tn = await api("GET", `/_api/tasks/notes?taskId=${tc.data.task.id}`);
        const preview = tn.data?.notes?.find((x) => x.id === n.data.note.id)?.preview;
        ok("tasks/notes works; its preview has no photo text", tn.status === 200 && typeof preview === "string" && !preview.includes("attachment:"), `${tn.status} ${JSON.stringify(preview ?? tn.text.slice(0, 100))}`);
        await api("POST", "/_api/tasks/delete", { id: tc.data.task.id });
        if (tc.data.task.projectId) await api("POST", "/_api/projects/delete", { id: tc.data.task.projectId });
      }
      const us = await usage();
      ok("usage: enabled false", us.status === 200 && us.data?.enabled === false, us.text.slice(0, 160));
      for (const [name, r] of [["start", await start(newId(), 1000)], ["confirm", await confirm(id)], ["view", await view([id])]]) {
        ok(`${name}: 503 PHOTOS_UNAVAILABLE`, r.status === 503 && r.data?.code === "PHOTOS_UNAVAILABLE", `${r.status} ${r.text.slice(0, 100)}`);
      }
      const free = newId();
      await sql`insert into attachments (user_id, id, content_type, bytes, storage_key, status, confirmed_at) values (${me}, ${free}, 'image/jpeg', 10, ${`u/${me}/${free}/x`}, 'ready', now())`;
      const d = await del(free);
      ok("delete works", d.status === 200 && d.data?.deleted === true && !(await row(me, free)), `${d.status}`);
      await updateNote({ id: n.data.note.id, content: `Edited ${token(free)}` });
      await sql`insert into attachments (user_id, id, content_type, bytes, storage_key, status, confirmed_at) values (${me}, ${free}, 'image/jpeg', 10, ${`u/${me}/${free}/y`}, 'ready', now())`;
      const e = await api("GET", "/_api/account/export");
      ok("export: url null", e.status === 200 && (e.data?.photos ?? []).length > 0 && e.data.photos.every((p) => p.url === null) && e.data.photoLinksExpireAt === null, e.text.slice(0, 160));
      await sql`update storage_deletions set not_before = now() - interval '1 minute' where storage_key = ${`u/${me}/${free}/x`}`;
      await freeLeases();
      sweep({ __photosOff: "1" });
      ok("the sweep queues but doesn't drain", !!(await queued(`u/${me}/${free}/x`)));
    } finally {
      restartServer();
      uploadCalls.length = 0;
    }
  });
} catch (error) {
  ok("the run reached its checks", false, String(error?.message ?? error).split("\n")[0]);
} finally {
  if (S) await S.close().catch(() => {});
  try { if (me) await reset(); } catch {}
  await sql.end();
}

// 16, 17, 24 and 19: in-process with tsx (the same local variables).
const sub = [];
if (!only || only.has(16) || only.has(17) || only.has(24)) sub.push("sweep-check.ts");
if (!only || only.has(19)) sub.push("ai-clean.ts");
let subFailed = 0;
for (const file of sub) {
  console.log(`\n== ${file}`);
  const env = { PATH: "/opt/node24/bin:/usr/bin:/bin", HOME: process.env.HOME, ...LOCAL, ...CHECK_ENV, ATTACHMENT_SWEEP_EVERY_MS: "0" };
  const out = spawnSync(NODE, [join(ROOT, "node_modules/.bin/tsx"), join(HERE, file)], { cwd: ROOT, env, stdio: "inherit", timeout: 600000 });
  if (out.status !== 0) subFailed++;
}

console.log(results.failed || subFailed ? `\napi-check: ${results.failed} FAILED, ${results.passed} passed${subFailed ? `; ${subFailed} sub-check file(s) failed` : ""}` : `\napi-check: all ${results.passed} passed`);
process.exit(results.failed || subFailed ? 1 : 0);
