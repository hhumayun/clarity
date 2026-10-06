// @ts-nocheck -- a plain script for Node, which runs .ts files directly.
// Run from the project root: /opt/node24/bin/node --import ./scripts/ts-resolve.mjs src/data/reminders.test.ts
// Repeats and reminders are separate (revamp 5): a repeating task's reminder
// goes off each time it repeats, or just this once (src/core/lib/reminderRules.ts).
import { reminderTimes, withReminders } from "../core/lib/reminderRules.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
const now = new Date(2026, 9, 6, 8, 0);
const day = new Date(2026, 9, 6, 12, 0);
const task = { id: "t", status: "todo", completeBy: day, dueTime: "10:00", remindBefore: 15, remindRepeat: "daily" };

check("a repeating task's reminder goes off each time it repeats", reminderTimes(task, now).length === 6);
check("…or once, when it's for this time only", reminderTimes({ ...task, remindOnce: true }, now).length === 1);
check("a task that doesn't repeat reminds once either way", reminderTimes({ ...task, remindRepeat: null }, now).length === 1);
check("a repeat with no reminder reminds nothing", reminderTimes({ ...task, remindBefore: null }, now).length === 0);

const ticked = withReminders({ id: "t", status: "done" }, { status: "todo", completeBy: day, remindRepeat: "daily", remindOnce: true }, now);
check("ticked off, a repeating task comes back the next day", ticked.rolledTo?.getDate() === 7 && ticked.change.status === undefined);
check("…without a reminder that was for this time only", ticked.change.remindBefore === null && ticked.change.remindOnce === false);
const every = withReminders({ id: "t", status: "done" }, { status: "todo", completeBy: day, remindRepeat: "daily", remindOnce: false }, now);
check("…and keeps one that was for each time", every.change.remindBefore === undefined && every.change.remindOnce === undefined);
const plain = withReminders({ id: "t", status: "done" }, { status: "todo", completeBy: day, remindRepeat: null, remindOnce: false }, now);
check("a task that doesn't repeat is simply done", plain.change.status === "done" && plain.rolledTo === null);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
