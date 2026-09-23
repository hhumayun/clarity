import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { suggestFirstSteps } from "../../helpers/focusFirstSteps";
import { schema, type OutputType } from "./first_steps_POST.schema";

/**
 * Suggest a first small step for a task, for the focus-time setup. A model
 * failure returns no steps rather than an error: the setup screen works
 * perfectly well without suggestions.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const task = await db
      .selectFrom("tasks")
      .innerJoin("projects", "projects.id", "tasks.projectId")
      .select(["tasks.text as text", "projects.name as projectName"])
      .where("tasks.id", "=", input.taskId)
      .where("tasks.userId", "=", user.id)
      .where("tasks.deletedAt", "is", null)
      .executeTakeFirst();
    if (!task) {
      return new Response(superjson.stringify({ error: "That task could not be found." }), { status: 404 });
    }
    const last = await db
      .selectFrom("focusSessions")
      .select("leftOff")
      .where("taskId", "=", input.taskId)
      .where("userId", "=", user.id)
      .orderBy("endedAt", "desc")
      .limit(1)
      .executeTakeFirst();

    let steps: string[] = [];
    try {
      steps = await suggestFirstSteps({ ...task, lastLeftOff: last?.leftOff });
    } catch (error) {
      console.warn("first steps failed", error instanceof Error ? error.message : error);
    }
    return new Response(superjson.stringify({ steps } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
