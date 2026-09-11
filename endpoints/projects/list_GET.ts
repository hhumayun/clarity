import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import type { OutputType } from "./list_GET.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const projects = await db
      .selectFrom("projects")
      .select(["id", "name", "createdAt", "updatedAt"])
      .where("userId", "=", user.id)
      .orderBy("updatedAt", "desc")
      .execute();
    return new Response(superjson.stringify({ projects } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
