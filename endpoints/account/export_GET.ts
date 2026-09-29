import superjson from "superjson";
import { db } from "../../helpers/db";
import { selectTaskRecords } from "../../helpers/taskRecords";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { NOTE_RECORD_COLUMNS } from "../../helpers/NoteRecord";
import { attachProjectIds } from "../../helpers/noteProjects";
import type { OutputType } from "./export_GET.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);

    const [noteRows, entities, projects, tasks, focusSessions] = await Promise.all([
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
      selectTaskRecords(db, user.id)
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

    const notes = await attachProjectIds(db, noteRows, user.id);

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