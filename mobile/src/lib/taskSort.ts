import { minutesOf } from "./reminderRules";
import { linkedNoteIds } from "./taskLinks";
import type { ProjectRecord, TaskRecord } from "../types";

// A task's day as a number that sorts (its local calendar day, as shown),
// and its time on that day: ones with a time first, in time order.
const dayNumber = (date: Date) => date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate();
const timeNumber = (task: TaskRecord) => minutesOf(task.dueTime) ?? 24 * 60;

export function sortTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].sort((a, b) => {
    if (a.status === "done" && b.status === "done") {
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    }
    const aDue = a.completeBy ? dayNumber(a.completeBy) : undefined;
    const bDue = b.completeBy ? dayNumber(b.completeBy) : undefined;
    if (aDue !== undefined && bDue !== undefined && aDue !== bDue) return aDue - bDue;
    if (aDue !== undefined && bDue === undefined) return -1;
    if (aDue === undefined && bDue !== undefined) return 1;
    if (aDue !== undefined && timeNumber(a) !== timeNumber(b)) return timeNumber(a) - timeNumber(b);
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function sortProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return [...projects].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export function openCountByProject(tasks: TaskRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === "done") continue;
    counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
  }
  return counts;
}

/** Open tasks per source note, for the "1 task in Life Center" tag. */
export function taskCountByNote(tasks: TaskRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === "done") continue;
    for (const noteId of linkedNoteIds(task)) counts.set(noteId, (counts.get(noteId) ?? 0) + 1);
  }
  return counts;
}
