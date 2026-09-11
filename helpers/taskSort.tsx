import type { ProjectRecord, TaskRecord } from "./TaskRecord";

/**
 * Stable ordering for the board so nothing jumps around under the reader's
 * finger. Open tasks: dated first (soonest at the top, overdue therefore
 * first), undated after, then oldest first. Done: most recently finished
 * at the top.
 */
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

/** Alphabetical, so filter chips and pickers keep a fixed order. */
export function sortProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return [...projects].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Open-task count per project id (done tasks excluded). */
export function openCountByProject(tasks: TaskRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === "done") continue;
    counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
  }
  return counts;
}
