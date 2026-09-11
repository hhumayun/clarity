import type { TaskRecord } from "./TaskRecord";

/**
 * Due-date helpers for tasks. Dates are compared at day granularity in the
 * reader's local time, so "today" means today where they are.
 */

export type DueState = "overdue" | "today" | "tomorrow" | "week" | "later";

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const DAY_MS = 86_400_000;

/** Whole days from today to the given date (negative when in the past). */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.round((startOfLocalDay(date) - startOfLocalDay(now)) / DAY_MS);
}

export function dueState(date: Date, now: Date = new Date()): DueState {
  const days = daysUntil(date, now);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 7) return "week";
  return "later";
}

/** Short, friendly label for a due date. */
export function formatDue(date: Date, now: Date = new Date()): string {
  const state = dueState(date, now);
  if (state === "overdue") {
    const days = -daysUntil(date, now);
    return days === 1 ? "Yesterday" : `${days} days ago`;
  }
  if (state === "today") return "Today";
  if (state === "tomorrow") return "Tomorrow";
  if (state === "week") {
    return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** Full date for places where the short label is not enough (dialogs). */
export function formatDueLong(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

/**
 * One calm sentence for the top of the Life Center.
 *   "Nothing is due soon."
 *   "1 thing is due this week."
 *   "3 things are due this week · 1 is overdue."
 */
export function summarizeTasks(tasks: TaskRecord[], now: Date = new Date()): string {
  const open = tasks.filter((t) => t.status !== "done" && t.completeBy);
  let overdue = 0;
  let thisWeek = 0;
  for (const task of open) {
    const state = dueState(task.completeBy as Date, now);
    if (state === "overdue") overdue += 1;
    else if (state !== "later") thisWeek += 1;
  }
  if (overdue === 0 && thisWeek === 0) return "Nothing is due soon.";
  const parts: string[] = [];
  if (thisWeek > 0) {
    parts.push(`${thisWeek} ${thisWeek === 1 ? "thing is" : "things are"} due this week`);
  }
  if (overdue > 0) {
    parts.push(
      thisWeek > 0
        ? `${overdue} ${overdue === 1 ? "is" : "are"} overdue`
        : `${overdue} ${overdue === 1 ? "thing is" : "things are"} overdue`,
    );
  }
  return `${parts.join(" · ")}.`;
}
