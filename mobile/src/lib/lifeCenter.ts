import { dueState } from "./taskDates";
import { isSameDay } from "./dates";
import { sortTasks } from "./taskSort";
import type { TaskRecord } from "../types";

/**
 * Pure grouping for the Life Center screens. No React Native imports, so the
 * rules for what lands where can be checked on their own.
 *
 * Status tabs are gone from the design: "in progress" is simply open, and a
 * task is either done or not.
 */

export type AllTasksGroups = {
  /** Open and past their date. Shown as one quiet card, never as rows. */
  overdue: TaskRecord[];
  today: TaskRecord[];
  /** Tomorrow through the next seven days. */
  thisWeek: TaskRecord[];
  later: TaskRecord[];
  noDate: TaskRecord[];
  done: TaskRecord[];
};

export function groupAllTasks(tasks: TaskRecord[], now: Date = new Date()): AllTasksGroups {
  const groups: AllTasksGroups = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
    noDate: [],
    done: [],
  };
  for (const task of sortTasks(tasks)) {
    if (task.status === "done") {
      groups.done.push(task);
      continue;
    }
    if (!task.completeBy) {
      groups.noDate.push(task);
      continue;
    }
    const state = dueState(task.completeBy, now);
    if (state === "overdue") groups.overdue.push(task);
    else if (state === "today") groups.today.push(task);
    else if (state === "tomorrow" || state === "week") groups.thisWeek.push(task);
    else groups.later.push(task);
  }
  return groups;
}

export type TodayFocus = {
  /** Everything planned for today, done ones included, open first. */
  today: TaskRecord[];
  doneCount: number;
  overdueCount: number;
  /** The next few open tasks after today. */
  comingUp: TaskRecord[];
};

const COMING_UP_LIMIT = 3;

export function todayFocus(tasks: TaskRecord[], now: Date = new Date()): TodayFocus {
  const groups = groupAllTasks(tasks, now);
  const doneToday = groups.done.filter(
    (task) => task.completeBy && isSameDay(task.completeBy, now),
  );
  // Done ones settle to the bottom in the order they were finished, so the
  // open work stays at the top where the eye starts.
  const finished = [...doneToday].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
  return {
    today: [...groups.today, ...finished],
    doneCount: doneToday.length,
    overdueCount: groups.overdue.length,
    comingUp: [...groups.thisWeek, ...groups.later].slice(0, COMING_UP_LIMIT),
  };
}

/** Open tasks due today — the "2 things today" under the title. */
export function openTodayCount(tasks: TaskRecord[], now: Date = new Date()): number {
  return groupAllTasks(tasks, now).today.length;
}

/** Oldest first, so catching up starts with what has waited longest. */
export function overdueQueue(tasks: TaskRecord[], now: Date = new Date()): TaskRecord[] {
  return groupAllTasks(tasks, now).overdue;
}

export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The overdue card's line: "4 tasks slipped past their dates". */
export function slippedLabel(count: number, more = false): string {
  const noun = count === 1 ? "task" : "tasks";
  return more
    ? `${count} more slipped past ${count === 1 ? "its date" : "their dates"}`
    : `${count} ${noun} slipped past ${count === 1 ? "its date" : "their dates"}`;
}

// One dot colour per area, in the same order in both themes so an area keeps
// its hue when the theme changes. Teal, coral, purple and blue are the
// redesign's area dots and gold is its warm amber, deeper on Morning Paper
// (light) and softer on Evening Sage (dark). The design has no green or pink,
// so those two are unchanged.
const AREA_DOTS = {
  light: ["#2f8a80", "#c46a55", "#7d62b8", "#b7791f", "#4a73b0", "#8fbf8a", "#d58db0"],
  dark: ["#7fc1b9", "#e0a08f", "#b8a6de", "#dcaa62", "#94b4de", "#8fbf8a", "#d58db0"],
};

/**
 * A stable colour per area: hashed from its id, so adding or renaming an area
 * never repaints the others.
 */
export function areaColor(projectId: string, dark: boolean): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  const dots = dark ? AREA_DOTS.dark : AREA_DOTS.light;
  return dots[Math.abs(hash) % dots.length];
}
