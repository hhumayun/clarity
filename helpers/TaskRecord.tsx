import type { Selectable } from "kysely";
import type { Projects, ReminderRepeat, Tasks, TaskStatus } from "./schema";

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

export const REMINDER_REPEAT_VALUES = ["daily", "weekdays", "weekly", "monthly"] as const satisfies readonly ReminderRepeat[];

/** A task's time on its day: "HH:MM", 24-hour. */
export const DUE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The longest a reminder can come before its task: a year, in minutes. */
export const MAX_REMIND_BEFORE = 525_600;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};
