/**
 * The outbox: every change the phone makes, in order, until the server has
 * it. Pure on purpose — no React Native, no storage, no network — so the
 * rules here can be tested on their own. store.ts keeps the queue and
 * runner.ts sends it.
 */

export type TaskStatusValue = "todo" | "in_progress" | "done";
export type ReminderRepeatValue = "daily" | "weekdays" | "weekly" | "monthly";

export type Op =
  | {
      kind: "note.create";
      body: {
        id: string;
        createdAt: Date;
        title: string;
        content: string;
        doc?: unknown;
        source?: "focus" | "page";
        taskId?: string;
        projectIds?: string[];
      };
    }
  | {
      kind: "note.update";
      /** `changedAt`: when the change was made here, so a change sent later keeps its time (revamp 5). */
      body: {
        id: string;
        title?: string;
        content?: string;
        doc?: unknown;
        archived?: boolean;
        projectIds?: string[];
        changedAt?: Date;
        /** Photos the writer took out of the note: bookkeeping, like `changedAt` (revamp 5). */
        removedPhotos?: string[];
      };
    }
  | { kind: "note.delete"; body: { id: string } }
  | {
      kind: "task.create";
      body: {
        id: string;
        createdAt: Date;
        text: string;
        description?: string;
        projectId: string;
        completeBy: Date | null;
        dueTime?: string | null;
        remindBefore?: number | null;
        remindRepeat?: ReminderRepeatValue | null;
        /** The reminder is for this time only (revamp 5). */
        remindOnce?: boolean;
        status: TaskStatusValue;
        noteId?: string | null;
      };
    }
  | {
      kind: "task.update";
      body: {
        id: string;
        text?: string;
        description?: string;
        projectId?: string;
        completeBy?: Date | null;
        dueTime?: string | null;
        remindBefore?: number | null;
        remindRepeat?: ReminderRepeatValue | null;
        /** The reminder is for this time only (revamp 5). */
        remindOnce?: boolean;
        status?: TaskStatusValue;
        /** The day it was planned for before a move pushed it on (revamp 5). */
        movedFrom?: Date | null;
        /** When the change was made here (revamp 5). */
        changedAt?: Date;
      };
    }
  | { kind: "task.delete"; body: { id: string } }
  | { kind: "task.link"; body: { taskId: string; noteId: string; linked: boolean } }
  | { kind: "tasks.clearDone"; body: { projectId?: string } }
  | { kind: "project.create"; body: { id: string; name: string } }
  | { kind: "project.update"; body: { id: string; name: string } }
  | { kind: "project.delete"; body: { id: string; moveTasksTo?: string } }
  | {
      kind: "focus.record";
      body: {
        id: string;
        taskId: string;
        plannedMinutes: number;
        focusedSeconds: number;
        firstStep: string;
        outcome: "finished" | "progress" | "stuck";
        leftOff: string;
        startedAt: Date;
        endedAt: Date;
      };
    }
  /**
   * A photo for the server (revamp 5): its bytes stay in the phone's photo
   * store, and the photo lane uploads them (editor/photoUpload.ts). It runs
   * apart from everything else, so it never holds a note or task back.
   */
  | { kind: "photo.upload"; body: { id: string; width?: number; height?: number } };

/**
 * A photo's progress, kept with its entry (revamp 5): not tried again before
 * `notBefore`, however often the lane is woken; `put` once its bytes went up,
 * so a retry confirms before uploading the whole file again; `waitingForRoom`
 * while the account's photo space is full.
 */
export type PhotoProgress = { notBefore: number; failures: number; put: boolean; waitingForRoom?: boolean };

export type Entry = { seq: number; op: Op; queuedAt: number; photo?: PhotoProgress };

/** "note:<id>", "task:<id>", "project:<id>": what an operation is about. */
export function subjectOf(op: Op): string | null {
  switch (op.kind) {
    case "note.create":
    case "note.update":
    case "note.delete":
      return `note:${op.body.id}`;
    case "task.create":
    case "task.update":
    case "task.delete":
      return `task:${op.body.id}`;
    case "task.link":
      return `task:${op.body.taskId}`;
    case "project.create":
    case "project.update":
    case "project.delete":
      return `project:${op.body.id}`;
    case "focus.record":
      return `focus:${op.body.id}`;
    case "photo.upload":
      // A photo isn't one note's (it can be in several): deleting a note leaves its upload alone.
      return `photo:${op.body.id}`;
    case "tasks.clearDone":
      return null;
  }
}

/** Every thing an operation touches: its subject and the things it points at. */
export function touches(op: Op): string[] {
  const subject = subjectOf(op);
  const all = subject ? [subject] : [];
  switch (op.kind) {
    case "note.create":
      if (op.body.taskId) all.push(`task:${op.body.taskId}`);
      for (const id of op.body.projectIds ?? []) all.push(`project:${id}`);
      break;
    case "note.update":
      for (const id of op.body.projectIds ?? []) all.push(`project:${id}`);
      break;
    case "task.create":
      all.push(`project:${op.body.projectId}`);
      if (op.body.noteId) all.push(`note:${op.body.noteId}`);
      break;
    case "task.update":
      if (op.body.projectId) all.push(`project:${op.body.projectId}`);
      break;
    case "task.link":
      all.push(`note:${op.body.noteId}`);
      break;
    case "project.delete":
      if (op.body.moveTasksTo) all.push(`project:${op.body.moveTasksTo}`);
      break;
    case "focus.record":
      all.push(`task:${op.body.taskId}`);
      break;
    default:
      break;
  }
  return all;
}

const isCreate = (op: Op) => op.kind.endsWith(".create");
const isUpdate = (op: Op) => op.kind.endsWith(".update");
/** A photo upload, which the photo lane sends, apart from everything else (revamp 5). */
export const isPhoto = (op: Op) => op.kind === "photo.upload";

// Bookkeeping, not fields: never a reason not to fold (revamp 5).
const BOOKKEEPING = new Set(["id", "changedAt", "removedPhotos"]);

// What each create can carry. An update with only these fields can be folded
// into its still-unsent create.
const CREATE_FIELDS: Record<string, Set<string>> = {
  "note.create": new Set(["title", "content", "doc", "projectIds"]),
  "task.create": new Set(["text", "description", "projectId", "completeBy", "dueTime", "remindBefore", "remindRepeat", "remindOnce", "status"]),
  "project.create": new Set(["name"]),
};

// Fields that point at other things. Moving them earlier in the queue could
// put a reference ahead of the create it points at.
const REFERENCE_FIELDS = new Set(["projectId", "projectIds", "noteId", "taskId", "moveTasksTo"]);

/**
 * Add an operation, keeping the queue short:
 * - an update folds into the latest unsent create or update of the same thing
 *   (field by field, the later value winning), unless that would carry a
 *   reference ahead of what it points at, or a field the create cannot take;
 * - a delete drops everything still queued for that thing, and is itself
 *   dropped if the create never left the phone (nothing to delete);
 * - anything else is appended.
 * `sending` is the entry the runner is sending right now; it is never changed.
 */
export function addToQueue(queue: Entry[], op: Op, seq: number, sending: number | null, now: number): Entry[] {
  const entry: Entry = { seq, op, queuedAt: now };
  const subject = subjectOf(op);

  // A photo already waiting to go up isn't queued twice (revamp 5).
  if (isPhoto(op)) return queue.some((candidate) => subjectOf(candidate.op) === subject) ? queue : [...queue, entry];

  if (isUpdate(op) && subject) {
    // When it was made, and which photos it took out, are bookkeeping, not fields: they never stop a fold (revamp 5).
    const fields = Object.keys(op.body).filter((key) => !BOOKKEEPING.has(key));
    const hasReferences = fields.some((key) => REFERENCE_FIELDS.has(key));
    for (let i = queue.length - 1; i >= 0; i--) {
      const candidate = queue[i];
      if (candidate.seq === sending) break;
      if (!touches(candidate.op).includes(subject)) continue;
      // Something else about this thing is in between (a link, a delete, a
      // task pointing at it): keep the order and append.
      if (subjectOf(candidate.op) !== subject || !(isCreate(candidate.op) || isUpdate(candidate.op))) break;
      const isLast = i === queue.length - 1;
      if (hasReferences && !isLast) break;
      if (isCreate(candidate.op)) {
        const allowed = CREATE_FIELDS[candidate.op.kind];
        if (!fields.every((key) => allowed?.has(key))) break;
      }
      // Folded together, the later change's time wins; a create keeps its own and takes none (revamp 5).
      const body: Record<string, unknown> = { ...candidate.op.body, ...op.body };
      if (isCreate(candidate.op)) delete body.changedAt;
      // Photos taken out: a note the server hasn't got yet has none to lose, so
      // a create takes none; two updates' lists are joined, so a removal from
      // an earlier visit survives a later one that never saw the photo (revamp 5).
      const removed = joinRemoved(candidate.op.body, op.body);
      if (isCreate(candidate.op) || !removed.length) delete body.removedPhotos;
      else body.removedPhotos = removed;
      const merged = { ...candidate, op: { ...candidate.op, body } as Op };
      return [...queue.slice(0, i), merged, ...queue.slice(i + 1)];
    }
    return [...queue, entry];
  }

  if (op.kind.endsWith(".delete") && subject) {
    let neverSent = false;
    const kept: Entry[] = [];
    for (const candidate of queue) {
      if (candidate.seq === sending) {
        kept.push(candidate);
        continue;
      }
      const candidateSubject = subjectOf(candidate.op);
      if (candidateSubject === subject) {
        if (isCreate(candidate.op)) neverSent = true;
        continue;
      }
      // A link to the deleted thing means nothing any more.
      if (candidate.op.kind === "task.link" && touches(candidate.op).includes(subject)) continue;
      // A task about to be created in a deleted note keeps the task, without the note.
      if (candidate.op.kind === "task.create" && subject === `note:${candidate.op.body.noteId}`) {
        kept.push({ ...candidate, op: { ...candidate.op, body: { ...candidate.op.body, noteId: null } } });
        continue;
      }
      kept.push(candidate);
    }
    return neverSent ? kept : [...kept, entry];
  }

  return [...queue, entry];
}

function joinRemoved(earlier: object, later: object): string[] {
  const listOf = (body: object) => {
    const list = (body as { removedPhotos?: unknown }).removedPhotos;
    return Array.isArray(list) ? (list as string[]) : [];
  };
  return [...new Set([...listOf(earlier), ...listOf(later)])];
}

/**
 * The server kept an existing project of the same name instead of the one
 * made here: point everything still queued at the server's id.
 */
export function remapProject(queue: Entry[], fromId: string, toId: string): Entry[] {
  const swap = (id: string | undefined) => (id === fromId ? toId : id);
  return queue.map((entry) => {
    const op = entry.op;
    switch (op.kind) {
      case "note.create":
      case "note.update":
        return op.body.projectIds
          ? { ...entry, op: { ...op, body: { ...op.body, projectIds: op.body.projectIds.map((id) => swap(id) as string) } } as Op }
          : entry;
      case "task.create":
        return { ...entry, op: { ...op, body: { ...op.body, projectId: swap(op.body.projectId) as string } } };
      case "task.update":
        return op.body.projectId ? { ...entry, op: { ...op, body: { ...op.body, projectId: swap(op.body.projectId) } } } : entry;
      case "tasks.clearDone":
        return op.body.projectId ? { ...entry, op: { ...op, body: { projectId: swap(op.body.projectId) } } } : entry;
      case "project.update":
        return { ...entry, op: { ...op, body: { ...op.body, id: swap(op.body.id) as string } } };
      case "project.delete":
        return {
          ...entry,
          op: { ...op, body: { id: swap(op.body.id) as string, ...(op.body.moveTasksTo ? { moveTasksTo: swap(op.body.moveTasksTo) } : {}) } },
        };
      default:
        return entry;
    }
  });
}

/**
 * What to do when sending fails:
 * - "retry": no connection, a timeout, rate limiting or a server fault; keep
 *   it and try again later;
 * - "auth": not signed in (any more); wait until the person is;
 * - "gone": the thing was deleted elsewhere; an update or link to it can go;
 * - "reject": the server will never accept it; drop it and say so.
 */
export type FailureKind = "retry" | "auth" | "gone" | "reject";

export function classifyFailure(op: Op, error: unknown): FailureKind {
  const status = statusOf(error);
  if (status === null) return "retry";
  if (status === 401) return "auth";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  if (status === 404) return isCreate(op) || op.kind === "focus.record" ? "reject" : "gone";
  return "reject";
}

/** Wait before the next try: 2 s, doubling, at most a minute. */
export function backoffMs(failures: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, failures - 1));
}

// ---- The photo lane (revamp 5, docs/photos-server.md section 9.4) ----------

/** Photos off on the server, or its bucket failing: tried again after this. */
export const PHOTOS_UNAVAILABLE_WAIT_MS = 15 * 60_000;
/** The account's photo space is full: tried again after this, or sooner once there's room. */
export const PHOTOS_FULL_WAIT_MS = 60 * 60_000;

export type PhotoFailure = { kind: FailureKind; waitMs?: number; full?: boolean };

/**
 * What to do when a photo didn't go up. Unlike other changes, a 404 is tried
 * again (an older server without the photo routes, or a pending photo that
 * was swept): only the phone's own 410 (the file isn't here) is "gone".
 * `failures` counts this one.
 */
export function photoFailure(error: unknown, failures: number): PhotoFailure {
  const status = statusOf(error);
  const code =
    typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : null;
  if (status === null) return { kind: "retry", waitMs: backoffMs(failures) };
  if (status === 401) return { kind: "auth" };
  if (status === 410) return { kind: "gone" };
  if (code === "PHOTOS_UNAVAILABLE") return { kind: "retry", waitMs: PHOTOS_UNAVAILABLE_WAIT_MS };
  if (status === 413 && (code === "QUOTA_FULL" || code === "PHOTO_LIMIT")) return { kind: "retry", waitMs: PHOTOS_FULL_WAIT_MS, full: true };
  if (status === 408 || status === 429 || status === 404 || status >= 500) return { kind: "retry", waitMs: backoffMs(failures) };
  return { kind: "reject" };
}

function statusOf(error: unknown): number | null {
  return typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : null;
}

/** The main lane's next entry: the oldest that isn't a photo. */
export function mainHead(queue: Entry[]): Entry | null {
  return queue.find((entry) => !isPhoto(entry.op)) ?? null;
}

/** The photo lane's next entry: the oldest photo due by `now`. */
export function nextPhotoEntry(queue: Entry[], now: number): Entry | null {
  return queue.find((entry) => isPhoto(entry.op) && (entry.photo?.notBefore ?? 0) <= now) ?? null;
}

/** When the next photo is due, or null when none is waiting. */
export function nextPhotoTime(queue: Entry[]): number | null {
  let soonest: number | null = null;
  for (const entry of queue) {
    if (!isPhoto(entry.op)) continue;
    const at = entry.photo?.notBefore ?? 0;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest;
}

/** How many entries are waiting: all, or (`photos: false`) all but photos. */
export function countPending(queue: Entry[], options?: { photos?: boolean }): number {
  return options?.photos === false ? queue.filter((entry) => !isPhoto(entry.op)).length : queue.length;
}

/** Short words for a change the server would not take, for the toast. */
export function describeOp(op: Op): string {
  switch (op.kind) {
    case "note.create":
      return "a new note";
    case "note.update":
      return "a note's changes";
    case "note.delete":
      return "deleting a note";
    case "task.create":
      return `the task "${op.body.text}"`;
    case "task.update":
      return "a task's changes";
    case "task.delete":
      return "deleting a task";
    case "task.link":
      return op.body.linked ? "linking a note" : "unlinking a note";
    case "tasks.clearDone":
      return "clearing finished tasks";
    case "project.create":
      return `the area "${op.body.name}"`;
    case "project.update":
      return "renaming an area";
    case "project.delete":
      return "deleting an area";
    case "focus.record":
      return "a focus session";
    case "photo.upload":
      return "a photo";
  }
}
