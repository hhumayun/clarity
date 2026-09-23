import type { ProjectRecord, TaskRecord } from "../types";

export function sortTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].sort((a, b) => {
    if (a.status === "done" && b.status === "done") {
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    }
    const aDue = a.completeBy?.getTime();
    const bDue = b.completeBy?.getTime();
    if (aDue !== undefined && bDue !== undefined && aDue !== bDue) return aDue - bDue;
    if (aDue !== undefined && bDue === undefined) return -1;
    if (aDue === undefined && bDue !== undefined) return 1;
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
    if (task.status === "done" || !task.noteId) continue;
    counts.set(task.noteId, (counts.get(task.noteId) ?? 0) + 1);
  }
  return counts;
}
