import type { Selectable } from "kysely";
import type { Projects, Tasks, TaskStatus } from "./schema";

export type ProjectRecord = Omit<
  Selectable<Projects>,
  "userId" | "normalizedName"
>;

export type TaskRecord = Omit<
  Selectable<Tasks>,
  "userId" | "sourceFingerprint" | "deletedAt"
> & {
  projectName: string;
  /**
   * Every note the task is linked to, oldest link first. `noteId` is only
   * the note it was found in (if any), which Find tasks uses to avoid
   * suggesting it twice.
   */
  noteIds: string[];
};

export const TASK_STATUS_VALUES = ["todo", "in_progress", "done"] as const;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};
