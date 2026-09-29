import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { parseProgress, summarizeTask, taskSummaryHash, type TaskSummaryInput } from "../../helpers/summarizeTask";
import { schema, type OutputType } from "./summary_POST.schema";

/**
 * The AI summary of a task: how it is going, from its linked notes and its
 * focus time. Made once and kept until one of those changes, so opening the
 * task's notes again costs nothing.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const task = await db
      .selectFrom("tasks")
      .select(["text", "description", "status", "completeBy"])
      .where("id", "=", input.taskId)
      .where("userId", "=", user.id)
      .where("deletedAt", "is", null)
      .executeTakeFirst();
    if (!task) return new Response(superjson.stringify({ error: "That task could not be found." }), { status: 404 });

    const [notes, sessions, cached] = await Promise.all([
      db
        .selectFrom("noteTasks")
        .innerJoin("notes", "notes.id", "noteTasks.noteId")
        .select(["notes.id as id", "notes.title as title", "notes.content as content", "notes.createdAt as createdAt", "notes.updatedAt as updatedAt"])
        .where("noteTasks.taskId", "=", input.taskId)
        .where("notes.userId", "=", user.id)
        .orderBy("notes.createdAt", "asc")
        .execute(),
      db
        .selectFrom("focusSessions")
        .select(["id", "startedAt", "focusedSeconds", "outcome", "firstStep", "leftOff"])
        .where("taskId", "=", input.taskId)
        .where("userId", "=", user.id)
        .orderBy("startedAt", "asc")
        .execute(),
      db
        .selectFrom("taskSummaries")
        .select(["inputHash", "summary", "progress", "createdAt"])
        .where("taskId", "=", input.taskId)
        .where("userId", "=", user.id)
        .executeTakeFirst(),
    ]);

    const counts = { noteCount: notes.length, sessionCount: sessions.length };
    if (notes.length === 0 && sessions.length === 0) {
      return new Response(superjson.stringify({ summary: null, progress: [], generatedAt: null, ...counts } satisfies OutputType));
    }

    const summaryInput: TaskSummaryInput = { task, notes, sessions };
    const inputHash = taskSummaryHash(summaryInput);
    if (cached && cached.inputHash === inputHash) {
      return new Response(
        superjson.stringify({
          summary: cached.summary,
          progress: parseProgress(cached.progress),
          generatedAt: cached.createdAt,
          ...counts,
        } satisfies OutputType),
      );
    }

    const made = await summarizeTask(summaryInput, input.currentDate);
    if (!made) {
      return new Response(superjson.stringify({ error: "The summary could not be made. Please try again." }), { status: 502 });
    }
    const now = new Date();
    await db
      .insertInto("taskSummaries")
      .values({ taskId: input.taskId, userId: user.id, inputHash, summary: made.summary, progress: JSON.stringify(made.progress), createdAt: now })
      .onConflict((conflict) =>
        conflict.column("taskId").doUpdateSet({ inputHash, summary: made.summary, progress: JSON.stringify(made.progress), createdAt: now }),
      )
      .execute();
    return new Response(superjson.stringify({ ...made, generatedAt: now, ...counts } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
