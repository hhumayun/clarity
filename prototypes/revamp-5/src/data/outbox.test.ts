// @ts-nocheck -- a plain script for Node, which runs .ts files directly.
// Run from the project root: /opt/node24/bin/node src/data/outbox.test.ts
// The outbox rules revamp 5 added to the main app's (src/core/sync/outbox.ts):
// a change's time (`changedAt`) is bookkeeping, and a move's `movedFrom` is
// never folded into a create, which can't take it. And the photo lane's
// (docs/photos-server.md 9.3 and 9.4): photos never fold, a note's delete
// leaves them, the main lane never sees them, and `removedPhotos` folds by
// its own rules.
import {
  addToQueue,
  countPending,
  mainHead,
  nextPhotoEntry,
  nextPhotoTime,
  photoFailure,
  PHOTOS_FULL_WAIT_MS,
  PHOTOS_UNAVAILABLE_WAIT_MS,
} from "../core/sync/outbox.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
const t = (minutes: number) => new Date(Date.UTC(2026, 9, 6, 9, minutes));
const create = { kind: "task.create", body: { id: "a", createdAt: t(0), text: "Call", projectId: "p", completeBy: null, status: "todo" } };

let q = addToQueue([], { kind: "task.update", body: { id: "a", text: "Call Ana", changedAt: t(1) } }, 1, null, 0);
q = addToQueue(q, { kind: "task.update", body: { id: "a", status: "done", changedAt: t(5) } }, 2, null, 0);
check("two edits fold into one", q.length === 1);
check("the folded edit keeps both fields and the later time", q[0].op.body.text === "Call Ana" && q[0].op.body.status === "done" && q[0].op.body.changedAt.getTime() === t(5).getTime());

q = addToQueue([], create, 1, null, 0);
q = addToQueue(q, { kind: "task.update", body: { id: "a", status: "done", changedAt: t(2) } }, 2, null, 0);
check("an edit still folds into its unsent create", q.length === 1 && q[0].op.kind === "task.create" && q[0].op.body.status === "done");
check("the create takes no changedAt", !("changedAt" in q[0].op.body));

q = addToQueue([], create, 1, null, 0);
q = addToQueue(q, { kind: "task.update", body: { id: "a", completeBy: t(60), movedFrom: t(0), changedAt: t(3) } }, 2, null, 0);
check("a move with movedFrom isn't folded into a create", q.length === 2 && q[1].op.kind === "task.update" && q[1].op.body.movedFrom.getTime() === t(0).getTime());

q = addToQueue([], { kind: "note.update", body: { id: "n", content: "one", changedAt: t(1) } }, 1, null, 0);
q = addToQueue(q, { kind: "note.update", body: { id: "n", content: "two", changedAt: t(4) } }, 2, null, 0);
check("a note's edits fold, the later words and time winning", q.length === 1 && q[0].op.body.content === "two" && q[0].op.body.changedAt.getTime() === t(4).getTime());

q = addToQueue([], { kind: "task.update", body: { id: "a", text: "x", changedAt: t(1) } }, 1, 1, 0);
q = addToQueue(q, { kind: "task.update", body: { id: "a", text: "y", changedAt: t(2) } }, 2, 1, 0);
check("an edit never folds into the one being sent", q.length === 2);

// ---- Photos ----
const photo = (id, extra = {}) => ({ kind: "photo.upload", body: { id, width: 800, height: 600, ...extra } });
const noteCreate = { kind: "note.create", body: { id: "n", createdAt: t(0), title: "", content: "![](attachment:photo-0001)" } };

q = addToQueue([], noteCreate, 1, null, 0);
q = addToQueue(q, photo("photo-0001"), 2, null, 0);
q = addToQueue(q, { kind: "note.update", body: { id: "n", content: "words ![](attachment:photo-0001)", changedAt: t(1) } }, 3, null, 0);
check("a photo is appended after its note and the note's edit still folds past it", q.length === 2 && q[0].op.kind === "note.create" && q[1].op.kind === "photo.upload" && q[0].op.body.content.startsWith("words"));
q = addToQueue(q, photo("photo-0002"), 4, null, 0);
check("a second photo is appended, never folded", q.length === 3 && q[2].op.body.id === "photo-0002");
q = addToQueue(q, photo("photo-0001"), 5, null, 0);
check("a photo already waiting isn't queued twice", q.length === 3);

q = addToQueue([], { kind: "note.update", body: { id: "n", content: "x", changedAt: t(1) } }, 1, null, 0);
q = addToQueue(q, photo("photo-0001"), 2, null, 0);
q = addToQueue(q, { kind: "note.delete", body: { id: "n" } }, 3, null, 0);
check("deleting a note leaves its photo's upload", q.some((e) => e.op.kind === "photo.upload") && q.some((e) => e.op.kind === "note.delete") && !q.some((e) => e.op.kind === "note.update"));

q = addToQueue([], photo("photo-0001"), 1, null, 0);
q = addToQueue(q, { kind: "task.update", body: { id: "a", text: "Call", changedAt: t(1) } }, 2, null, 0);
q = addToQueue(q, photo("photo-0002"), 3, null, 0);
check("the main lane's head is never a photo", mainHead(q)?.seq === 2);
check("with only photos left, the main lane has nothing", mainHead([q[0], q[2]]) === null);

const waiting = [
  { seq: 1, op: photo("photo-0001"), queuedAt: 0, photo: { notBefore: 5_000, failures: 1, put: false } },
  { seq: 2, op: { kind: "task.delete", body: { id: "a" } }, queuedAt: 0 },
  { seq: 3, op: photo("photo-0002"), queuedAt: 0 },
];
check("nextPhoto takes the oldest photo that's due", nextPhotoEntry(waiting, 1_000)?.seq === 3);
check("a photo waiting out a failure is due at its time", nextPhotoEntry(waiting, 5_000)?.seq === 1);
check("nextPhoto never gives a note or task", nextPhotoEntry([waiting[1]], 10_000) === null);
check("nextPhotoAt is the soonest photo's time", nextPhotoTime(waiting) === 0 && nextPhotoTime([waiting[0], waiting[1]]) === 5_000 && nextPhotoTime([waiting[1]]) === null);
check("pendingCount counts photos by default", countPending(waiting) === 3);
check("pendingCount({ photos: false }) leaves photos out", countPending(waiting, { photos: false }) === 1);

const err = (status, code) => Object.assign(new Error("x"), { status, ...(code ? { code } : {}) });
check("photoFailure: 410 (not on this phone) is gone", photoFailure(err(410), 1).kind === "gone");
check("photoFailure: 404 is tried again", photoFailure(err(404, "NOT_FOUND"), 1).kind === "retry" && photoFailure(err(404), 3).waitMs === 8_000);
check("photoFailure: no connection is tried again with backoff", photoFailure(new TypeError("Network request failed"), 2).kind === "retry" && photoFailure(new TypeError("x"), 2).waitMs === 4_000);
check("photoFailure: 429 and 5xx are tried again", photoFailure(err(429, "RATE_LIMITED"), 1).kind === "retry" && photoFailure(err(502), 1).kind === "retry");
const unavailable = photoFailure(err(503, "PHOTOS_UNAVAILABLE"), 1);
check("photoFailure: PHOTOS_UNAVAILABLE waits 15 minutes", unavailable.kind === "retry" && unavailable.waitMs === PHOTOS_UNAVAILABLE_WAIT_MS && PHOTOS_UNAVAILABLE_WAIT_MS === 15 * 60_000);
const full = photoFailure(err(413, "QUOTA_FULL"), 1);
check("photoFailure: QUOTA_FULL waits 60 minutes, for room", full.kind === "retry" && full.waitMs === PHOTOS_FULL_WAIT_MS && PHOTOS_FULL_WAIT_MS === 60 * 60_000 && full.full === true);
check("photoFailure: PHOTO_LIMIT waits too", photoFailure(err(413, "PHOTO_LIMIT"), 1).waitMs === PHOTOS_FULL_WAIT_MS);
check("photoFailure: TOO_LARGE is refused", photoFailure(err(413, "TOO_LARGE"), 1).kind === "reject");
check("photoFailure: 422 is refused", photoFailure(err(422, "UPLOAD_MISMATCH"), 1).kind === "reject");
check("photoFailure: 401 waits for sign-in", photoFailure(err(401), 1).kind === "auth");

// removedPhotos (9.3)
q = addToQueue([], noteCreate, 1, null, 0);
q = addToQueue(q, { kind: "note.update", body: { id: "n", content: "gone", changedAt: t(1), removedPhotos: ["photo-0001"] } }, 2, null, 0);
check("removedPhotos never stops a fold into a create, and the create drops it", q.length === 1 && q[0].op.kind === "note.create" && q[0].op.body.content === "gone" && !("removedPhotos" in q[0].op.body));

q = addToQueue([], { kind: "note.update", body: { id: "n", content: "a", changedAt: t(1), removedPhotos: ["photo-0001"] } }, 1, null, 0);
q = addToQueue(q, { kind: "note.update", body: { id: "n", content: "b", changedAt: t(2), removedPhotos: ["photo-0002"] } }, 2, null, 0);
check("two updates' removedPhotos are joined", q.length === 1 && q[0].op.body.content === "b" && JSON.stringify([...q[0].op.body.removedPhotos].sort()) === JSON.stringify(["photo-0001", "photo-0002"]));
q = addToQueue(q, { kind: "note.update", body: { id: "n", content: "c", changedAt: t(3) } }, 3, null, 0);
check("a later update without removedPhotos keeps the earlier removals", q.length === 1 && q[0].op.body.removedPhotos.length === 2);

q = addToQueue([], { kind: "note.update", body: { id: "n", content: "a", changedAt: t(1), removedPhotos: ["photo-0001"] } }, 1, null, 0);
q = addToQueue(q, { kind: "note.update", body: { id: "n", content: "a", changedAt: t(1), removedPhotos: ["photo-0001"] } }, 2, null, 0);
check("the same removal twice is listed once", q.length === 1 && q[0].op.body.removedPhotos.length === 1);

q = addToQueue([], { kind: "note.update", body: { id: "n", content: "a", changedAt: t(1), removedPhotos: ["photo-0001"] } }, 1, 1, 0);
q = addToQueue(q, { kind: "note.update", body: { id: "n", content: "b", changedAt: t(2) } }, 2, 1, 0);
check("an update never folds into the one being sent, and keeps no stray removedPhotos", q.length === 2 && !("removedPhotos" in q[1].op.body));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
