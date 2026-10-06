// @ts-nocheck -- a plain script for Node, which runs .ts files directly.
// Run from the project root: /opt/node24/bin/node src/data/outbox.test.ts
// The outbox rules revamp 5 added to the main app's (src/core/sync/outbox.ts):
// a change's time (`changedAt`) is bookkeeping, and a move's `movedFrom` is
// never folded into a create, which can't take it.
import { addToQueue } from "../core/sync/outbox.ts";

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

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
