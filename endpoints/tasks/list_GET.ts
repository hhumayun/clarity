import superjson from "superjson";
import { db } from "../../helpers/db";
import { selectTaskRecords } from "../../helpers/taskRecords";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { taskContentHash } from "../../helpers/taskContentHash";
import { pendingSuggestions, sameWords } from "../../helpers/taskSuggestions";
import { schema, type OutputType } from "./list_GET.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const input = schema.parse({ noteId: url.searchParams.get("noteId") ?? undefined });

    let extraction: OutputType["extraction"] = null;
    if (input.noteId) {
      const [note, record] = await Promise.all([
        db.selectFrom("notes").select(["title", "content"]).where("id", "=", input.noteId).where("userId", "=", user.id).executeTakeFirst(),
        db.selectFrom("taskExtractions").select(["contentHash"]).where("noteId", "=", input.noteId).where("userId", "=", user.id).executeTakeFirst(),
      ]);
      if (!note) {
        return new Response(superjson.stringify({ error: "That note could not be found." }), { status: 404 });
      }
      extraction = {
        hasExtracted: Boolean(record),
        needsRefresh: Boolean(record && record.contentHash !== taskContentHash(note.title, note.content)),
      };
    }

    // A note's tasks are every task linked to it: found in it, added to it,
    // linked from elsewhere, or parked from during focus time.
    let taskQuery = selectTaskRecords(db, user.id);
    if (input.noteId) {
      const noteId = input.noteId;
      taskQuery = taskQuery.where((eb) =>
        eb.exists(
          eb
            .selectFrom("noteTasks")
            .select("noteTasks.taskId")
            .whereRef("noteTasks.taskId", "=", "tasks.id")
            .where("noteTasks.noteId", "=", noteId),
        ),
      );
    }

    const [tasks, projects, kept] = await Promise.all([
      taskQuery.orderBy("tasks.updatedAt", "desc").execute(),
      db.selectFrom("projects").select(["id", "name", "createdAt", "updatedAt"]).where("userId", "=", user.id).orderBy("updatedAt", "desc").execute(),
      input.noteId ? pendingSuggestions(db, input.noteId, user.id) : Promise.resolve(null),
    ]);
    // A suggestion already among the note's tasks, by the same words, isn't offered.
    const taken = new Set(tasks.map((task) => sameWords(task.text)));
    const pending = kept?.filter((item) => !taken.has(sameWords(item.text)));
    return new Response(superjson.stringify({ tasks, projects, extraction, ...(pending ? { pending } : {}) } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
