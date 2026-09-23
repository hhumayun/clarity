import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { NOTE_RECORD_COLUMNS } from "../../helpers/NoteRecord";
import type { OutputType } from "./export_GET.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);

    const [notes, entities, projects, tasks, focusSessions] = await Promise.all([
      db
        .selectFrom("notes")
        .select([...NOTE_RECORD_COLUMNS])
        .where("userId", "=", user.id)
        .orderBy("updatedAt", "desc")
        .execute(),
      db
        .selectFrom("noteEntities")
        .select(["noteId", "type", "name", "aliases"])
        .where("userId", "=", user.id)
        .execute(),
      db
        .selectFrom("projects")
        .select(["id", "name", "createdAt", "updatedAt"])
        .where("userId", "=", user.id)
        .orderBy("updatedAt", "desc")
        .execute(),
      db
        .selectFrom("tasks")
        .innerJoin("projects", "projects.id", "tasks.projectId")
        .select([
          "tasks.id as id", "tasks.noteId as noteId", "tasks.projectId as projectId",
          "tasks.text as text", "tasks.completeBy as completeBy", "tasks.status as status",
          "tasks.createdAt as createdAt", "tasks.updatedAt as updatedAt",
          "projects.name as projectName",
        ])
        .where("tasks.userId", "=", user.id)
        .where("tasks.deletedAt", "is", null)
        .orderBy("tasks.updatedAt", "desc")
        .execute(),
      db
        .selectFrom("focusSessions")
        .select([
          "id", "taskId", "plannedMinutes", "focusedSeconds", "firstStep",
          "outcome", "leftOff", "startedAt", "endedAt",
        ])
        .where("userId", "=", user.id)
        .orderBy("endedAt", "desc")
        .execute(),
    ]);

    return new Response(
      superjson.stringify({
        exportedAt: new Date(),
        notes,
        entities,
        projects,
        tasks,
        focusSessions,
      } satisfies OutputType),
    );
  } catch (error) {
    return endpointError(error);
  }
}