import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { extractTasks } from "../../helpers/extractTasks";
import { dueDayAsDate, validDate } from "../../helpers/parseExtractedTasks";
import { normalizeProjectName } from "../../helpers/normalizeProjectName";
import { taskContentHash } from "../../helpers/taskContentHash";
import { taskFingerprint } from "../../helpers/taskFingerprint";
import { dismissedFingerprints, pendingSuggestions, replacePendingSuggestions, sameWords } from "../../helpers/taskSuggestions";
import { schema, type OutputType } from "./extract_POST.schema";

/**
 * Look for tasks in a note and return them as suggestions. Nothing is
 * written to the tasks table here — the writer picks which suggestions to
 * add, and tasks/add_POST does the saving. The suggestions themselves are
 * kept until the writer decides (helpers/taskSuggestions), so an unchanged
 * note offers them again instead of nothing.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const [note, projects, existingTasks] = await Promise.all([
      db.selectFrom("notes").select(["title", "content"]).where("id", "=", input.noteId).where("userId", "=", user.id).executeTakeFirst(),
      db.selectFrom("projects").select(["id", "name", "normalizedName"]).where("userId", "=", user.id).execute(),
      // Found in this note, or linked to it from elsewhere.
      db.selectFrom("tasks").select(["text", "sourceFingerprint"]).where("userId", "=", user.id).where((eb) =>
        eb.or([
          eb("noteId", "=", input.noteId),
          eb.exists(eb.selectFrom("noteTasks").select("noteTasks.taskId").whereRef("noteTasks.taskId", "=", "tasks.id").where("noteTasks.noteId", "=", input.noteId)),
        ]),
      ).execute(),
    ]);
    if (!note) return new Response(superjson.stringify({ error: "That note could not be found." }), { status: 404 });

    // Only offer what is genuinely new: not already extracted from this note
    // (fingerprint) and not already added by hand with the same words.
    const knownFingerprints = new Set(
      existingTasks.map((t) => t.sourceFingerprint).filter(Boolean),
    );
    const knownTexts = new Set(existingTasks.map((t) => sameWords(t.text)));
    const isNew = (text: string) => !knownFingerprints.has(taskFingerprint(input.noteId, text)) && !knownTexts.has(sameWords(text));

    const contentHash = taskContentHash(note.title, note.content);
    const lastExtraction = await db
      .selectFrom("taskExtractions")
      .select("contentHash")
      .where("noteId", "=", input.noteId)
      .executeTakeFirst();
    if (lastExtraction?.contentHash === contentHash) {
      // Nothing new to find, but what was found last time and not yet
      // decided comes back. Told as new (`unchanged: false`), so a client
      // that shows a "Nothing new" notice for unchanged notes doesn't.
      const pending = (await pendingSuggestions(db, input.noteId, user.id)).filter((item) => isNew(item.text));
      return new Response(superjson.stringify({ suggested: pending, unchanged: pending.length === 0 } satisfies OutputType));
    }

    const proposed = await extractTasks({
      title: note.title,
      content: note.content,
      projectNames: projects.map((project) => project.name),
      currentDate: validDate(input.currentDate) ?? new Date().toISOString().slice(0, 10),
    });

    // Nor anything the writer has already turned down for this note.
    const dismissed = await dismissedFingerprints(db, input.noteId, user.id);
    const suggested = proposed
      .filter((item) => isNew(item.text) && !dismissed.has(taskFingerprint(input.noteId, item.text)))
      .map((item) => ({
        text: item.text,
        projectName: item.projectName,
        // The parser yields YYYY-MM-DD. Midnight UTC would read as the day
        // before anywhere west of UTC, so send noon and let the client pin
        // it to its own local noon.
        completeBy: item.completeBy ? dueDayAsDate(item.completeBy) : null,
      }));

    const now = new Date();
    await db.transaction().execute(async (trx) => {
      await replacePendingSuggestions(trx, input.noteId, user.id, suggested);
      await trx.insertInto("taskExtractions").values({
        noteId: input.noteId, userId: user.id, contentHash, extractedAt: now,
      }).onConflict((conflict) => conflict.column("noteId").doUpdateSet({
        userId: user.id, contentHash, extractedAt: now,
      })).execute();
    });

    return new Response(superjson.stringify({ suggested, unchanged: false } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
