import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { postFocusRecord } from "../api/focus";
import { postNoteCreate, postNoteDelete, postNoteUpdate } from "../api/notes";
import {
  postProjectCreate,
  postProjectDelete,
  postProjectUpdate,
  postTaskCreate,
  postTaskDelete,
  postTaskLink,
  postTasksClearDone,
  postTaskUpdate,
} from "../api/tasks";
import { getAttachmentUsage, type AttachmentUsage } from "../api/attachments";
import { photoLedger } from "../../editor/photoLedger";
import { photoStore } from "../../editor/photoStore";
import { SIGNED_OUT, uploadPhoto } from "../../editor/photoUpload";
import { remapProjectInCache } from "./cache";
import { backoffMs, classifyFailure, describeOp, photoFailure, type Entry, type Op } from "./outbox";
import { outbox } from "./store";

/**
 * Sends the outbox, oldest first, one at a time, whenever there is something
 * to send and a connection: on every new change, on reconnecting, on coming
 * back to the app, and on a backing-off timer after a failed try.
 *
 * Photos (revamp 5) go in a lane of their own, one at a time, each with its
 * own stored time for the next try: a slow or failing photo never holds back
 * a note or task, and waking the lane (every save does) never hurries a
 * photo that's waiting out a failure.
 */

let queryClient: QueryClient | null = null;
let notify: ((message: string) => void) | null = null;
let running = false;
let rerun = false;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function configureRunner(options: { queryClient: QueryClient; notify: (message: string) => void }) {
  queryClient = options.queryClient;
  notify = options.notify;
  outbox.setOnEnqueue(kick);
}

/** Try sending now (photos only as each one is due). */
export function kick() {
  kickPhotos();
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (running) {
    rerun = true;
    return;
  }
  void run();
}

/** The kinds of data an operation changes, for marking them out of date. */
function touchedData(op: Op): string[] {
  switch (op.kind) {
    case "note.create":
      // A thought parked during focus is also linked to its task.
      return op.body.taskId ? ["notes", "tasks", "task-notes"] : ["notes"];
    case "note.update":
    case "note.delete":
      return ["notes"];
    case "task.link":
      return ["tasks", "task-notes", "task-summary"];
    case "focus.record":
      return ["focus"];
    case "photo.upload":
      // A photo changes no list.
      return [];
    default:
      // Tasks, clearing done, and areas (which tasks carry by name).
      return ["tasks"];
  }
}

async function run() {
  if (!queryClient) return;
  running = true;
  let landed = false;
  const touched = new Set<string>();
  try {
    for (;;) {
      if (!onlineManager.isOnline()) break;
      const entry = outbox.head();
      if (!entry) break;
      outbox.markSending(entry.seq);
      try {
        await send(entry.op);
        outbox.remove(entry.seq);
        failures = 0;
        landed = true;
        for (const key of touchedData(entry.op)) touched.add(key);
      } catch (error) {
        outbox.markSending(null);
        const kind = classifyFailure(entry.op, error);
        if (kind === "retry") {
          failures += 1;
          retryTimer = setTimeout(kick, backoffMs(failures));
          break;
        }
        // Signed out (or the session lapsed): wait to be kicked once signed in.
        if (kind === "auth") break;
        outbox.remove(entry.seq);
        landed = true;
        // Dropped: what is on screen may now differ from the server's copy.
        for (const key of touchedData(entry.op)) touched.add(key);
        if (kind === "reject") {
          notify?.(`One change couldn't be saved: ${describeOp(entry.op)}.`);
        }
      }
    }
  } finally {
    outbox.markSending(null);
    running = false;
  }
  // Everything is in. The lists already show these changes, so nothing is
  // reloaded now (that redrew every list on every typing pause); the data
  // they touched is only marked out of date, and refreshes the next time a
  // screen showing it comes into view, the app comes back, or it reconnects.
  // (Photos waiting don't count: they change no list, revamp 5.)
  if (landed && outbox.pendingCount({ photos: false }) === 0) {
    for (const key of touched) {
      void queryClient.invalidateQueries({ queryKey: [key], refetchType: "none" });
    }
  }
  if (rerun) {
    rerun = false;
    kick();
  }
}

async function send(op: Op): Promise<void> {
  switch (op.kind) {
    case "note.create":
      void queueMissingPhotos((await postNoteCreate(op.body)).missingPhotos);
      return;
    case "note.update":
      void queueMissingPhotos((await postNoteUpdate(op.body)).missingPhotos);
      return;
    case "note.delete":
      await postNoteDelete(op.body);
      return;
    case "task.create":
      await postTaskCreate(op.body);
      return;
    case "task.update":
      await postTaskUpdate(op.body);
      return;
    case "task.delete":
      await postTaskDelete(op.body);
      return;
    case "task.link":
      await postTaskLink(op.body);
      return;
    case "tasks.clearDone":
      await postTasksClearDone(op.body);
      return;
    case "project.create": {
      const { project } = await postProjectCreate(op.body);
      if (project.id !== op.body.id) {
        outbox.remapProject(op.body.id, project.id);
        if (queryClient) remapProjectInCache(queryClient, op.body.id, project);
      }
      return;
    }
    case "project.update":
      await postProjectUpdate(op.body);
      return;
    case "project.delete":
      await postProjectDelete(op.body);
      return;
    case "focus.record":
      await postFocusRecord(op.body);
      return;
    case "photo.upload":
      // The photo lane sends these; the main lane never sees one.
      return;
  }
}

// ---- The photo lane (revamp 5, docs/photos-server.md 9.4) ---------------------

let photoRunning = false;
let photoRerun = false;
let photoTimer: ReturnType<typeof setTimeout> | null = null;
let photoTimerAt = 0;
let fullSaid = false;

/**
 * A note saved names photos the server hasn't got: each one this phone has
 * goes up (one pasted in, or one the server let go while a note here still
 * had it). A photo the server refused for good isn't offered again.
 */
async function queueMissingPhotos(missing: string[] | undefined) {
  for (const id of missing ?? []) {
    try {
      if (outbox.isPending(`photo:${id}`) || photoLedger.isRejected(id)) continue;
      if (await photoStore.has(id)) {
        photoLedger.add(id);
        outbox.enqueue({ kind: "photo.upload", body: { id } });
      }
    } catch {
      // Not readable just now: the next save names it again.
    }
  }
}

/** Wake the photo lane: it sends whatever is due, and sleeps until the next one is. */
export function kickPhotos() {
  if (photoRunning) {
    photoRerun = true;
    return;
  }
  void runPhotos();
}

function sleepUntil(at: number) {
  // Already set for this time or sooner: keep it.
  if (photoTimer && photoTimerAt <= at) return;
  if (photoTimer) clearTimeout(photoTimer);
  photoTimerAt = at;
  photoTimer = setTimeout(
    () => {
      photoTimer = null;
      kickPhotos();
    },
    Math.max(0, at - Date.now()),
  );
}

async function runPhotos() {
  photoRunning = true;
  try {
    for (;;) {
      photoRerun = false;
      if (!onlineManager.isOnline()) break;
      const entry = outbox.nextPhoto(Date.now());
      if (!entry) {
        const next = outbox.nextPhotoAt();
        if (next !== null) sleepUntil(next);
        break;
      }
      if (entry.op.kind !== "photo.upload") break;
      const body = entry.op.body;
      let put = entry.photo?.put ?? false;
      // Whose photo this is: an upload outlives a sign-out (a 10 MB PUT), and
      // nothing it does afterwards may touch the next person's queue or account.
      const owner = outbox.owner();
      const stored = photoStore.generation();
      const stillCurrent = () => outbox.owner() === owner && photoStore.generation() === stored;
      try {
        await uploadPhoto(body, {
          put,
          stillCurrent,
          onPut: (value) => {
            put = value;
            if (stillCurrent()) outbox.patchPhoto(entry.seq, { notBefore: 0, failures: entry.photo?.failures ?? 0, put: value });
          },
        });
        if (!stillCurrent()) break;
        outbox.remove(entry.seq);
        photoLedger.remove(body.id);
      } catch (error) {
        // Signed out meanwhile: nothing here is this person's any more.
        if (!stillCurrent() || (error as { code?: unknown })?.code === SIGNED_OUT) break;
        const failures = (entry.photo?.failures ?? 0) + 1;
        const verdict = photoFailure(error, failures);
        if (verdict.kind === "retry") {
          outbox.patchPhoto(entry.seq, { notBefore: Date.now() + (verdict.waitMs ?? backoffMs(failures)), failures, put, waitingForRoom: verdict.full });
          if (verdict.full && !fullSaid) {
            fullSaid = true;
            notify?.("Your photos have used all your space. New photos stay on this phone.");
          }
          continue;
        }
        // Signed out (or the session lapsed): wait to be woken once signed in
        // (not by wake-ups that came while this try was out).
        if (verdict.kind === "auth") {
          photoRerun = false;
          break;
        }
        outbox.remove(entry.seq);
        if (verdict.kind === "gone") {
          photoLedger.remove(body.id);
        } else {
          photoLedger.reject(body.id);
          notify?.(`One change couldn't be saved: ${describeOp(entry.op)}.`);
        }
      }
    }
  } finally {
    photoRunning = false;
  }
  if (photoRerun) {
    photoRerun = false;
    kickPhotos();
  }
}

const hasRoom = (usage: AttachmentUsage | undefined) => !!usage?.enabled && usage.usedBytes < usage.quotaBytes && usage.photos < usage.maxPhotos;

/**
 * Coming back to the app with photos waiting for space: ask the server how
 * much there is, and send them now if there's room again.
 */
export async function checkPhotoRoom() {
  const waiting = outbox.photoEntries().filter((entry: Entry) => entry.photo?.waitingForRoom);
  if (!waiting.length || !queryClient || !onlineManager.isOnline()) return;
  try {
    const usage = await queryClient.fetchQuery({ queryKey: ["attachments-usage"], queryFn: () => getAttachmentUsage(), staleTime: 0 });
    if (!hasRoom(usage)) return;
    for (const entry of waiting) {
      if (entry.photo) outbox.patchPhoto(entry.seq, { ...entry.photo, notBefore: 0, waitingForRoom: false });
    }
    kickPhotos();
  } catch {
    // Asked again next time.
  }
}
