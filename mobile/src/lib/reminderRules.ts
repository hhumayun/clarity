/**
 * When reminders go off. Pure date rules with no React Native imports, so
 * they can be tested on their own. Everything is in the phone's local time,
 * so a 9:00 reminder stays at 9:00 when the clocks change.
 *
 * A reminder is a time on a task: `remindAt`, and for a repeating one
 * `remindRepeat`, with `remindAt` the time its series counts from.
 */
import type { ReminderRepeat, TaskRecord, TaskStatus } from "../types";
import { atNoon, dateChipLabel, formatClockTime, isSameDay } from "./dates";

export type { ReminderRepeat };
export const REMINDER_REPEATS = ["daily", "weekdays", "weekly", "monthly"] as const satisfies readonly ReminderRepeat[];

export const REPEAT_LABELS: Record<ReminderRepeat, string> = {
  daily: "Daily",
  weekdays: "Weekdays",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** How many times of a repeating reminder wait on the phone at once. */
export const TIMES_PER_TASK = 6;
/**
 * iOS keeps at most 64 notifications waiting for an app; reminders stay well
 * under it, leaving room for focus time's alert.
 */
export const MAX_WAITING = 50;

type ReminderTask = {
  id: string;
  status: string;
  remindAt?: Date | null;
  remindRepeat?: ReminderRepeat | null;
};

/** `time`'s hour and minute on `day`'s date. */
export function onDay(day: Date, time: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes(), 0, 0);
}

function wholeMinute(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), 0, 0);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** The series' time `months` months on from its start; a day the month lacks becomes its last. */
function monthsOn(start: Date, months: number): Date {
  const month = new Date(start.getFullYear(), start.getMonth() + months, 1);
  const day = Math.min(start.getDate(), daysInMonth(month.getFullYear(), month.getMonth()));
  return new Date(month.getFullYear(), month.getMonth(), day, start.getHours(), start.getMinutes(), 0, 0);
}

function fallsOn(repeat: Exclude<ReminderRepeat, "monthly">, day: Date, start: Date): boolean {
  switch (repeat) {
    case "daily":
      return true;
    case "weekdays":
      return day.getDay() !== 0 && day.getDay() !== 6;
    case "weekly":
      return day.getDay() === start.getDay();
  }
}

/**
 * The first time a reminder goes off after `after`: a one-off's own time if
 * it is still to come; for a repeating one, the first time in its series
 * (which never starts before `remindAt`) that is.
 */
export function nextOccurrence(remindAt: Date, repeat: ReminderRepeat | null | undefined, after: Date): Date | null {
  if (!repeat) return remindAt.getTime() > after.getTime() ? remindAt : null;
  const start = wholeMinute(remindAt);
  if (repeat === "monthly") {
    let months = Math.max(
      0,
      (after.getFullYear() - start.getFullYear()) * 12 + (after.getMonth() - start.getMonth()),
    );
    for (;;) {
      const time = monthsOn(start, months);
      if (time.getTime() > after.getTime()) return time;
      months += 1;
    }
  }
  // Day by day from the later of the series' first day and `after`'s day; a
  // week always holds the next one.
  const from = after.getTime() > start.getTime() ? after : start;
  for (let days = 0; days <= 8; days++) {
    const time = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + days,
      start.getHours(),
      start.getMinutes(),
      0,
      0,
    );
    if (time.getTime() > after.getTime() && time.getTime() >= start.getTime() && fallsOn(repeat, time, start)) {
      return time;
    }
  }
  return null;
}

/** The next `count` times a reminder goes off after `after`, soonest first. */
export function upcomingOccurrences(
  remindAt: Date,
  repeat: ReminderRepeat | null | undefined,
  after: Date,
  count: number,
): Date[] {
  const times: Date[] = [];
  let from = after;
  while (times.length < count) {
    const next = nextOccurrence(remindAt, repeat, from);
    if (!next) break;
    times.push(next);
    if (!repeat) break;
    from = next;
  }
  return times;
}

/** The next time a task's reminder goes off, if it has one still to come. */
export function upcomingReminder(task: ReminderTask, now: Date = new Date()): Date | null {
  if (!task.remindAt || task.status === "done") return null;
  return nextOccurrence(task.remindAt, task.remindRepeat, now);
}

export type WantedReminder = { key: string; taskId: string; at: number };

/**
 * Every reminder that should be waiting on the phone: each open task's next
 * time, or a repeating task's next few, soonest first and at most
 * MAX_WAITING. `key` names one time of one task.
 */
export function wantedReminders(tasks: ReminderTask[], now: Date = new Date()): WantedReminder[] {
  const wanted: WantedReminder[] = [];
  for (const task of tasks) {
    if (!task.remindAt || task.status === "done") continue;
    for (const time of upcomingOccurrences(task.remindAt, task.remindRepeat, now, TIMES_PER_TASK)) {
      const at = time.getTime();
      wanted.push({ key: `${task.id}:${at}`, taskId: task.id, at });
    }
  }
  return wanted.sort((a, b) => a.at - b.at).slice(0, MAX_WAITING);
}

/**
 * A repeating task ticked off: its reminder moves on to the next time in its
 * series after both now and the time just done, and its day, if it has one,
 * moves with it.
 */
export function rollForward(
  task: { remindAt: Date; remindRepeat: ReminderRepeat; completeBy: Date | null },
  now: Date = new Date(),
): { remindAt: Date; completeBy: Date | null } {
  const after = task.remindAt.getTime() > now.getTime() ? task.remindAt : now;
  const next = nextOccurrence(task.remindAt, task.remindRepeat, after) ?? task.remindAt;
  return {
    remindAt: next,
    completeBy: task.completeBy ? atNoon(next.getFullYear(), next.getMonth(), next.getDate()) : null,
  };
}

/**
 * Where a reminder set for `time` (an hour and minute) falls: on the task's
 * day, if it has one today or later; otherwise the next time that clock time
 * comes round.
 */
export function reminderFor(dueDay: Date | null, time: Date, now: Date = new Date()): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (dueDay && new Date(dueDay.getFullYear(), dueDay.getMonth(), dueDay.getDate()).getTime() >= today.getTime()) {
    return onDay(dueDay, time);
  }
  const todayAt = onDay(now, time);
  return todayAt.getTime() > now.getTime() ? todayAt : onDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1), time);
}

/**
 * The time a new reminder starts at: 9:00 on a day still to come, or the
 * next whole hour today (9:00 tomorrow if that is too late in the evening).
 */
export function defaultReminderTime(dueDay: Date | null, now: Date = new Date()): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (dueDay && new Date(dueDay.getFullYear(), dueDay.getMonth(), dueDay.getDate()).getTime() > today.getTime()) {
    return new Date(dueDay.getFullYear(), dueDay.getMonth(), dueDay.getDate(), 9, 0, 0, 0);
  }
  const nextHour = now.getHours() + 1;
  if (nextHour <= 21) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), nextHour, 0, 0, 0);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
}

/**
 * A reminder's time in words: just "9:00 am" when it is on the task's own
 * day (shown beside it), else with its day: "Tomorrow, 9:00 am".
 */
export function reminderTimeLabel(at: Date, dueDay: Date | null, now: Date = new Date()): string {
  const time = formatClockTime(at);
  return dueDay && isSameDay(dueDay, at) ? time : `${dateChipLabel(at, now)}, ${time}`;
}

/** The reminder as its chip says it: "9:00 am", "Tomorrow, 9:00 am", "Daily · 9:00 am". */
export function reminderLabel(
  remindAt: Date,
  repeat: ReminderRepeat | null | undefined,
  dueDay: Date | null,
  now: Date = new Date(),
): string {
  if (repeat) return `${REPEAT_LABELS[repeat]} · ${formatClockTime(remindAt)}`;
  return reminderTimeLabel(remindAt, dueDay, now);
}

/** A change to a task, as the tasks hook takes it. */
export type TaskChange = {
  id: string;
  text?: string;
  description?: string;
  projectId?: string;
  completeBy?: Date | null;
  remindAt?: Date | null;
  remindRepeat?: ReminderRepeat | null;
  status?: TaskStatus;
};

const sameTime = (a: Date | null | undefined, b: Date | null | undefined) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * What a change really does once reminders are taken into account:
 * - a repeating task marked done is not finished but moves on to its next
 *   time (its day too, if it has one), and stays open;
 * - a task moved to another day takes its reminder with it, at the same time
 *   of day, unless the change sets a new reminder itself;
 * - no reminder means nothing to repeat.
 * A change that repeats the task's current reminder (the edit form sends
 * everything) counts as leaving it alone. `rolledTo` is the next time, when
 * a repeating task moved on.
 */
export function withReminders(
  change: TaskChange,
  task: Pick<TaskRecord, "status" | "completeBy" | "remindAt" | "remindRepeat"> | undefined,
  now: Date = new Date(),
): { change: TaskChange; rolledTo: Date | null } {
  const keepsReminder =
    !task ||
    ((change.remindAt === undefined || sameTime(change.remindAt, task.remindAt)) &&
      (change.remindRepeat === undefined || change.remindRepeat === (task.remindRepeat ?? null)));

  if (task?.remindAt && task.remindRepeat && keepsReminder && change.status === "done" && task.status !== "done") {
    const next = rollForward({ remindAt: task.remindAt, remindRepeat: task.remindRepeat, completeBy: task.completeBy }, now);
    const { status: _done, ...rest } = change;
    return {
      change: { ...rest, remindAt: next.remindAt, ...(task.completeBy ? { completeBy: next.completeBy } : {}) },
      rolledTo: next.remindAt,
    };
  }

  let result = change;
  const movedDay =
    task && change.completeBy && !(task.completeBy && isSameDay(change.completeBy, task.completeBy));
  if (movedDay && keepsReminder && task.remindAt && change.completeBy) {
    result = { ...result, remindAt: onDay(change.completeBy, task.remindAt) };
  }
  if (result.remindAt === null && result.remindRepeat === undefined) result = { ...result, remindRepeat: null };
  return { change: result, rolledTo: null };
}
