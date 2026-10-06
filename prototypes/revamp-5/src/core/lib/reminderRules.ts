/**
 * When reminders go off, and how tasks repeat. Pure date rules with no React
 * Native imports, so they can be tested on their own. Everything is in the
 * phone's local time, so a 9:00 reminder stays at 9:00 when the clocks change.
 *
 * A task can have a time on its day (`dueTime`, "HH:MM"). A reminder counts
 * back from it: `remindBefore` minutes before that time or, for a task with
 * no time, before 9:00 on its day. Being relative, a reminder follows its
 * task to another day or time. A repeating task (`remindRepeat`) comes back
 * on its next day each time it is ticked off.
 */
import type { ReminderRepeat, TaskRecord, TaskStatus } from "../types";
import { atNoon, formatClockTime, isSameDay } from "./dates";

export type { ReminderRepeat };
export const REMINDER_REPEATS = ["daily", "weekdays", "weekly", "monthly"] as const satisfies readonly ReminderRepeat[];

export const REPEAT_LABELS: Record<ReminderRepeat, string> = {
  daily: "Daily",
  weekdays: "Weekdays",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** How many times of a repeating task's reminder wait on the phone at once. */
export const TIMES_PER_TASK = 6;
/**
 * iOS keeps at most 64 notifications waiting for an app; reminders stay well
 * under it, leaving room for focus time's alert.
 */
export const MAX_WAITING = 50;

export const DAY_MINUTES = 24 * 60;
const WEEK_MINUTES = 7 * DAY_MINUTES;
/** What a reminder for a task with no time counts back from: 9:00 on its day. */
export const ALL_DAY_AT = 9 * 60;
/** The longest a reminder can come before its task: a year. */
export const MAX_REMIND_BEFORE = 365 * DAY_MINUTES;

type Schedule = { completeBy: Date | null; dueTime?: string | null };
type ReminderTask = Schedule & {
  id: string;
  status: string;
  remindBefore?: number | null;
  remindRepeat?: ReminderRepeat | null;
  /** The reminder is for this time only, not each time the task comes back (revamp 5). */
  remindOnce?: boolean;
};

/** "HH:MM" as minutes after midnight; null if it is not a time. */
export function minutesOf(time: string | null | undefined): number | null {
  const match = time ? /^(\d{2}):(\d{2})$/.exec(time) : null;
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** Minutes after midnight, or a Date's hour and minute, as "HH:MM". */
export function timeOf(value: number | Date): string {
  const minutes = typeof value === "number" ? value : value.getHours() * 60 + value.getMinutes();
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "15:00" as "3:00 pm". */
export function dueTimeLabel(time: string): string {
  const minutes = minutesOf(time) ?? 0;
  return formatClockTime(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

/** A "HH:MM" as a Date today, for a time picker. */
export function timeToday(time: string, now: Date = new Date()): Date {
  const minutes = minutesOf(time) ?? ALL_DAY_AT;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, minutes, 0, 0);
}

/**
 * When a reminder `before` minutes ahead of a task goes off, for the task on
 * `day`: counted on the clock, so "1 day before" 9:00 is 9:00 the day before
 * even across a clock change.
 */
export function reminderAt(day: Date, dueTime: string | null | undefined, before: number): Date {
  const at = minutesOf(dueTime) ?? ALL_DAY_AT;
  const days = Math.floor(before / DAY_MINUTES);
  const rest = before % DAY_MINUTES;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - days, 0, at - rest, 0, 0);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * The next day a task repeating by `repeat` comes back on, after `day` (at
 * noon, like every task's day). Monthly keeps `monthDay`, or takes the
 * month's last day when it is shorter.
 */
export function nextRepeatDay(day: Date, repeat: ReminderRepeat, monthDay: number = day.getDate()): Date {
  const y = day.getFullYear();
  const m = day.getMonth();
  const d = day.getDate();
  switch (repeat) {
    case "daily":
      return atNoon(y, m, d + 1);
    case "weekly":
      return atNoon(y, m, d + 7);
    case "weekdays": {
      let next = atNoon(y, m, d + 1);
      while (next.getDay() === 0 || next.getDay() === 6) next = atNoon(next.getFullYear(), next.getMonth(), next.getDate() + 1);
      return next;
    }
    case "monthly": {
      const month = new Date(y, m + 1, 1);
      return atNoon(month.getFullYear(), month.getMonth(), Math.min(monthDay, daysInMonth(month.getFullYear(), month.getMonth())));
    }
  }
}

export type ReminderTime = { at: Date; day: Date };

/**
 * The times a task's reminder goes off after `now`, soonest first, each with
 * the day it is for: one for a task that does not repeat, the next `count`
 * for one that does (counting on from its day, ticked off or not).
 */
export function reminderTimes(task: ReminderTask, now: Date = new Date(), count = TIMES_PER_TASK): ReminderTime[] {
  if (task.status === "done" || task.remindBefore == null || !task.completeBy) return [];
  const times: ReminderTime[] = [];
  const monthDay = task.completeBy.getDate();
  let day = task.completeBy;
  // A long-missed daily task walks forward to now; a few years at most.
  for (let step = 0; step < 2000 && times.length < count; step++) {
    const at = reminderAt(day, task.dueTime, task.remindBefore);
    if (at.getTime() > now.getTime()) times.push({ at, day });
    // A reminder for this time only goes off once, though the task repeats (revamp 5).
    if (!task.remindRepeat || task.remindOnce) break;
    day = nextRepeatDay(day, task.remindRepeat, monthDay);
  }
  return times;
}

/** The next time a task's reminder goes off, if it has one still to come. */
export function upcomingReminder(task: ReminderTask, now: Date = new Date()): Date | null {
  return reminderTimes(task, now, 1)[0]?.at ?? null;
}

export type WantedReminder = { key: string; taskId: string; at: number; day: Date };

/**
 * Every reminder that should be waiting on the phone: each open task's next
 * time, or a repeating task's next few, soonest first and at most
 * MAX_WAITING. `key` names one time of one task.
 */
export function wantedReminders(tasks: ReminderTask[], now: Date = new Date()): WantedReminder[] {
  const wanted: WantedReminder[] = [];
  for (const task of tasks) {
    for (const { at, day } of reminderTimes(task, now)) {
      wanted.push({ key: `${task.id}:${at.getTime()}`, taskId: task.id, at: at.getTime(), day });
    }
  }
  return wanted.sort((a, b) => a.at - b.at).slice(0, MAX_WAITING);
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * A repeating task ticked off: the next day it comes back on, after both its
 * own day and today (ticking off a late one counts for today too).
 */
export function rollForward(task: { completeBy: Date; remindRepeat: ReminderRepeat }, now: Date = new Date()): Date {
  const today = startOfDay(now).getTime();
  const monthDay = task.completeBy.getDate();
  let day = nextRepeatDay(task.completeBy, task.remindRepeat, monthDay);
  for (let step = 0; step < 2000 && startOfDay(day).getTime() <= today; step++) {
    day = nextRepeatDay(day, task.remindRepeat, monthDay);
  }
  return day;
}

/**
 * The choices a reminder offers, in minutes before the task: with a time,
 * at the time, 15 and 30 minutes before, or the day before; without one, the
 * day before (at 9:00). Anything else is "Custom".
 */
export function reminderChoices(timed: boolean): number[] {
  return timed ? [0, 15, 30, DAY_MINUTES] : [DAY_MINUTES];
}

export type ReminderUnit = "minutes" | "hours" | "days" | "weeks";
export const UNIT_MINUTES: Record<ReminderUnit, number> = {
  minutes: 1,
  hours: 60,
  days: DAY_MINUTES,
  weeks: WEEK_MINUTES,
};

/** The units a custom reminder can be counted in: whole days for a task with no time. */
export function reminderUnits(timed: boolean): ReminderUnit[] {
  return timed ? ["minutes", "hours", "days"] : ["days", "weeks"];
}

/** A reminder offset as an amount of the largest unit that fits it exactly. */
export function splitBefore(before: number, timed: boolean): { amount: number; unit: ReminderUnit } {
  const units = [...reminderUnits(timed)].reverse();
  for (const unit of units) {
    if (before >= UNIT_MINUTES[unit] && before % UNIT_MINUTES[unit] === 0) return { amount: before / UNIT_MINUTES[unit], unit };
  }
  const smallest = reminderUnits(timed)[0];
  return { amount: Math.round(before / UNIT_MINUTES[smallest]), unit: smallest };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A reminder in words, as its chip or a row says it ("15 min before", "1 day
 * before"), or in full for the list of choices ("15 minutes before").
 */
export function reminderLabel(before: number, timed: boolean, full = false): string {
  if (before === 0) return timed ? "At the time" : "On the day";
  if (before % WEEK_MINUTES === 0) return `${plural(before / WEEK_MINUTES, "week", "weeks")} before`;
  if (before % DAY_MINUTES === 0) return `${plural(before / DAY_MINUTES, "day", "days")} before`;
  const hours = Math.floor(before / 60);
  const minutes = before % 60;
  const parts = [
    hours > 0 ? plural(hours, full ? "hour" : "hr", full ? "hours" : "hrs") : "",
    minutes > 0 ? plural(minutes, full ? "minute" : "min", full ? "minutes" : "min") : "",
  ].filter(Boolean);
  return `${parts.join(" ")} before`;
}

/** A change to a task, as the tasks hook takes it. */
export type TaskChange = {
  id: string;
  text?: string;
  description?: string;
  projectId?: string;
  completeBy?: Date | null;
  dueTime?: string | null;
  remindBefore?: number | null;
  remindRepeat?: ReminderRepeat | null;
  /** The reminder is for this time only (revamp 5). */
  remindOnce?: boolean;
  status?: TaskStatus;
  /** The day it was planned for before this move (revamp 5); null clears it. */
  movedFrom?: Date | null;
};

/**
 * What a change really does once times and repeats are taken into account:
 * - a repeating task marked done is not finished but comes back on its next
 *   day, keeping its time and reminder (unless the reminder was for that time
 *   only, revamp 5), and stays open;
 * - a task with no day has no time either.
 * A change that repeats the task's own day and repeat (the edit form sends
 * everything) counts as leaving them alone. `rolledTo` is the next day, when
 * a repeating task moved on.
 */
export function withReminders(
  change: TaskChange,
  task: Pick<TaskRecord, "status" | "completeBy" | "remindRepeat" | "remindOnce"> | undefined,
  now: Date = new Date(),
): { change: TaskChange; rolledTo: Date | null } {
  const keepsRepeat =
    !task || change.remindRepeat === undefined || change.remindRepeat === (task.remindRepeat ?? null);
  const keepsDay =
    !task ||
    change.completeBy === undefined ||
    (change.completeBy !== null && task.completeBy !== null && isSameDay(change.completeBy, task.completeBy));

  if (task?.remindRepeat && task.completeBy && keepsRepeat && keepsDay && change.status === "done" && task.status !== "done") {
    const next = rollForward({ completeBy: task.completeBy, remindRepeat: task.remindRepeat }, now);
    const { status: _done, ...rest } = change;
    // A reminder for this time only doesn't come back with it (revamp 5).
    const reminder = task.remindOnce ? { remindBefore: null, remindOnce: false } : {};
    return { change: { ...rest, ...reminder, completeBy: next }, rolledTo: next };
  }

  // No day, no time: whatever time came with the change.
  if (change.completeBy === null) return { change: { ...change, dueTime: null }, rolledTo: null };
  return { change, rolledTo: null };
}
