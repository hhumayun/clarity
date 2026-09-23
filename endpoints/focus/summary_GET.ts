import superjson from "superjson";
import { sql } from "kysely";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType, type TaskFocusSummary } from "./summary_GET.schema";

/**
 * Focus time so far today, and per task: how many sessions, how long, and
 * the most recent session's "where you left off".
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const input = schema.parse({ since: url.searchParams.get("since") ?? undefined });

    const [today, totals, latest] = await Promise.all([
      db
        .selectFrom("focusSessions")
        .select(sql<string>`coalesce(sum(focused_seconds), 0)`.as("seconds"))
        .where("userId", "=", user.id)
        .where("endedAt", ">=", input.since)
        .executeTakeFirst(),
      db
        .selectFrom("focusSessions")
        .select([
          "taskId",
          sql<string>`count(*)`.as("sessions"),
          sql<string>`sum(focused_seconds)`.as("totalSeconds"),
        ])
        .where("userId", "=", user.id)
        .groupBy("taskId")
        .execute(),
      db
        .selectFrom("focusSessions")
        .distinctOn("taskId")
        .select(["taskId", "leftOff", "outcome", "plannedMinutes", "endedAt"])
        .where("userId", "=", user.id)
        .orderBy("taskId")
        .orderBy("endedAt", "desc")
        .execute(),
    ]);

    const lastByTask = new Map(latest.map((row) => [row.taskId, row]));
    const tasks: TaskFocusSummary[] = totals.flatMap((row) => {
      const last = lastByTask.get(row.taskId);
      if (!last) return [];
      return [
        {
          taskId: row.taskId,
          sessions: Number(row.sessions),
          totalSeconds: Number(row.totalSeconds),
          lastLeftOff: last.leftOff,
          lastOutcome: last.outcome,
          lastPlannedMinutes: last.plannedMinutes,
          lastEndedAt: last.endedAt,
        },
      ];
    });

    return new Response(
      superjson.stringify({ todaySeconds: Number(today?.seconds ?? 0), tasks } satisfies OutputType),
    );
  } catch (error) {
    return endpointError(error);
  }
}
