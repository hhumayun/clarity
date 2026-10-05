import { dateOf, dayLabel, daysBetween, lateLabel, today, type Day } from "../lib/dates";
import type { Note, Task } from "./model";

/** Open tasks: by day (no date last), timed before untimed, by time, then oldest first. */
export function byPlan(a: Task, b: Task): number {
  if (a.day !== b.day) {
    if (!a.day) return 1;
    if (!b.day) return -1;
    return a.day < b.day ? -1 : 1;
  }
  if ((a.time === null) !== (b.time === null)) return a.time === null ? 1 : -1;
  if (a.time !== null && b.time !== null && a.time !== b.time) return a.time - b.time;
  return a.createdAt - b.createdAt;
}

/** Done tasks: most recently ticked first. */
export const byDone = (a: Task, b: Task) => (b.doneAt ?? 0) - (a.doneAt ?? 0);

export type Groups = { slipped: Task[]; today: Task[]; week: Task[]; later: Task[]; undated: Task[]; done: Task[] };

/** Life Center's sections. */
export function groupTasks(tasks: Task[], area: string | null, t: Day = today()): Groups {
  const groups: Groups = { slipped: [], today: [], week: [], later: [], undated: [], done: [] };
  for (const task of tasks) {
    if (area && task.area !== area) continue;
    if (task.done) groups.done.push(task);
    else if (!task.day) groups.undated.push(task);
    else {
      const n = daysBetween(t, task.day);
      if (n < 0) groups.slipped.push(task);
      else if (n === 0) groups.today.push(task);
      else if (n <= 7) groups.week.push(task);
      else groups.later.push(task);
    }
  }
  for (const key of ["slipped", "today", "week", "later", "undated"] as const) groups[key].sort(byPlan);
  groups.done.sort(byDone);
  return groups;
}

/** Open tasks planned for a day. */
export const openOn = (tasks: Task[], day: Day) => tasks.filter((task) => !task.done && task.day === day).sort(byPlan);

/** Tasks finished on a day, in the order they were finished. */
export function doneOn(tasks: Task[], day: Day): Task[] {
  return tasks
    .filter((task) => task.done && task.doneAt !== null && sameDay(task.doneAt, day))
    .sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
}

export const slipped = (tasks: Task[], t: Day = today()) => tasks.filter((task) => !task.done && task.day !== null && task.day < t).sort(byPlan);

/** The next few dated tasks after today. */
export const comingUp = (tasks: Task[], count = 3, t: Day = today()) =>
  tasks.filter((task) => !task.done && task.day !== null && task.day > t).sort(byPlan).slice(0, count);

export const notesOn = (notes: Note[], day: Day) => notes.filter((note) => note.day === day);

export function sameDay(ms: number, day: Day): boolean {
  const date = new Date(ms);
  const d = dateOf(day);
  return date.getFullYear() === d.getFullYear() && date.getMonth() === d.getMonth() && date.getDate() === d.getDate();
}

/** "3:00 pm" */
export function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** A note's "16:05" as the rest of the app says times: "4:05 pm". */
export function noteTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  return clockLabel(h * 60 + m);
}

/** "Tomorrow, 3:00 pm", "Friday", "No date". */
export function whenLabel(task: Pick<Task, "day" | "time">, none = "No date"): string {
  if (!task.day) return none;
  const day = dayLabel(task.day);
  return task.time !== null ? `${day}, ${clockLabel(task.time)}` : day;
}

/** The due part of a row's meta line, and whether it's late. */
export function dueMeta(task: Task): { text: string; late: boolean } | null {
  if (!task.day || task.done) return null;
  const late = lateLabel(task.day);
  if (late) return { text: late, late: true };
  return { text: whenLabel(task), late: false };
}

/** "At the time", "On the day", "15 min before", "1 hr 30 min before", "1 day before", "2 weeks before". */
export function reminderLabel(remind: number | null, hasTime: boolean): string | null {
  if (remind === null) return null;
  if (remind === 0) return hasTime ? "At the time" : "On the day";
  const parts: string[] = [];
  if (remind % 10_080 === 0) return `${remind / 10_080} ${remind === 10_080 ? "week" : "weeks"} before`;
  if (remind % 1_440 === 0) return `${remind / 1_440} ${remind === 1_440 ? "day" : "days"} before`;
  const h = Math.floor(remind / 60);
  const m = remind % 60;
  if (h) parts.push(`${h} hr`);
  if (m) parts.push(`${m} min`);
  return `${parts.join(" ")} before`;
}

export const repeatLabels = { daily: "Daily", weekdays: "Weekdays", weekly: "Weekly", monthly: "Monthly" } as const;

/** "Sun 13 Sep" for footers and history. */
export function shortDate(ms: number | Day): string {
  const date = typeof ms === "number" ? new Date(ms) : dateOf(ms);
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** "today", "yesterday" or "Sun 13 Sep", for "last today". */
export function sinceLabel(ms: number): string {
  const n = daysBetween(dayOfMs(ms), today());
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  return `on ${shortDate(ms)}`;
}

function dayOfMs(ms: number): Day {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Note groups for the Notes list: "Today", "Yesterday", "Friday 2 October", "Earlier". */
export function noteGroup(day: Day, t: Day = today()): string {
  const n = daysBetween(day, t);
  if (n === 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n < 7) return dateOf(day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return "Earlier";
}
