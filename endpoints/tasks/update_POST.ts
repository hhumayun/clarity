import superjson from "superjson";
import { db } from "../../helpers/db";
import { selectTaskRecords } from "../../helpers/taskRecords";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType } from "./update_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    if (input.projectId) {
      const project = await db.selectFrom("projects").select("id").where("id", "=", input.projectId).where("userId", "=", user.id).executeTakeFirst();
      if (!project) return new Response(superjson.stringify({ error: "That project could not be found." }), { status: 404 });
    }
    const values: {
      text?: string;
      description?: string;
      projectId?: string;
      completeBy?: Date | null;
      dueTime?: string | null;
      remindBefore?: number | null;
      remindRepeat?: typeof input.remindRepeat;
      status?: typeof input.status;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (input.text !== undefined) values.text = input.text.trim();
    if (input.description !== undefined) values.description = input.description.trim();
    if (input.projectId !== undefined) values.projectId = input.projectId;
    if (input.completeBy !== undefined) values.completeBy = input.completeBy;
    if (input.dueTime !== undefined) values.dueTime = input.dueTime;
    // A time goes with a day: taking the day away takes the time too.
    if (input.completeBy === null) values.dueTime = null;
    if (input.remindBefore !== undefined) values.remindBefore = input.remindBefore;
    if (input.remindRepeat !== undefined) values.remindRepeat = input.remindRepeat;
    if (input.status !== undefined) values.status = input.status;
    const updated = await db.updateTable("tasks").set(values).where("id", "=", input.id).where("userId", "=", user.id).where("deletedAt", "is", null).returning("id").executeTakeFirst();
    if (!updated) return new Response(superjson.stringify({ error: "That task could not be found." }), { status: 404 });
    const task = await selectTaskRecords(db, user.id).where("tasks.id", "=", input.id).executeTakeFirstOrThrow();
    return new Response(superjson.stringify({ task } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
