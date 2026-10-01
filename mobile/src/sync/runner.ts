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
import { remapProjectInCache } from "./cache";
import { backoffMs, classifyFailure, describeOp, type Op } from "./outbox";
import { outbox } from "./store";

/**
 * Sends the outbox, oldest first, one at a time, whenever there is something
 * to send and a connection: on every new change, on reconnecting, on coming
 * back to the app, and on a backing-off timer after a failed try.
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

/** Try sending now. */
export function kick() {
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

async function run() {
  if (!queryClient) return;
  running = true;
  let landed = false;
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
        if (kind === "reject") {
          notify?.(`One change couldn't be saved: ${describeOp(entry.op)}.`);
        }
      }
    }
  } finally {
    outbox.markSending(null);
    running = false;
  }
  // Everything is in: let the server's copies replace the ones made here.
  if (landed && outbox.pendingCount() === 0) {
    for (const key of [["notes"], ["tasks"], ["focus"], ["task-notes"], ["task-summary"]]) {
      void queryClient.invalidateQueries({ queryKey: key });
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
      await postNoteCreate(op.body);
      return;
    case "note.update":
      await postNoteUpdate(op.body);
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
  }
}
