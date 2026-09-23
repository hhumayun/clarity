import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType } from "./record_POST.schema";

/**
 * Save one finished focus session. Marking the task done after "I finished
 * it" goes through tasks/update like any other completion; this only keeps
 * the record of the time spent and where the person left off.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const task = await db
      .selectFrom("tasks")
      .select("id")
      .where("id", "=", input.taskId)
      .where("userId", "=", user.id)
      .where("deletedAt", "is", null)
      .executeTakeFirst();
    if (!task) {
      return new Response(superjson.stringify({ error: "That task could not be found." }), { status: 404 });
    }
    const row = await db
      .insertInto("focusSessions")
      .values({
        userId: user.id,
        taskId: input.taskId,
        plannedMinutes: input.plannedMinutes,
        focusedSeconds: input.focusedSeconds,
        firstStep: input.firstStep.trim().replace(/\s+/g, " "),
        outcome: input.outcome,
        leftOff: input.leftOff.trim(),
        startedAt: input.startedAt,
        endedAt: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return new Response(superjson.stringify({ recorded: true, id: row.id } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
