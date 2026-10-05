import { sql, type Kysely, type Transaction } from "kysely";
import type { DB } from "./schema";

/**
 * Every endpoint that returns tasks selects them the same way: the task, its
 * project's name, and the ids of every note it is linked to (oldest link
 * first). Soft-deleted tasks are left out.
 */
export function selectTaskRecords(executor: Kysely<DB> | Transaction<DB>, userId: number) {
  return executor
    .selectFrom("tasks")
    .innerJoin("projects", "projects.id", "tasks.projectId")
    .select([
      "tasks.id as id",
      "tasks.noteId as noteId",
      "tasks.projectId as projectId",
      "tasks.text as text",
      "tasks.description as description",
      "tasks.completeBy as completeBy",
      "tasks.dueTime as dueTime",
      "tasks.remindBefore as remindBefore",
      "tasks.remindRepeat as remindRepeat",
      "tasks.status as status",
      "tasks.completedAt as completedAt",
      "tasks.movedFrom as movedFrom",
      "tasks.createdAt as createdAt",
      "tasks.updatedAt as updatedAt",
      "projects.name as projectName",
      sql<string[]>`coalesce(
        (select array_agg(nt.note_id order by nt.created_at) from note_tasks nt where nt.task_id = tasks.id),
        '{}'
      )`.as("noteIds"),
    ])
    .where("tasks.userId", "=", userId)
    .where("tasks.deletedAt", "is", null);
}

/** Link a note and a task; linking twice is harmless. */
export async function linkNoteTask(
  executor: Kysely<DB> | Transaction<DB>,
  link: { noteId: string; taskId: string; userId: number },
) {
  await executor
    .insertInto("noteTasks")
    .values(link)
    .onConflict((conflict) => conflict.columns(["noteId", "taskId"]).doNothing())
    .execute();
}
