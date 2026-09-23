import superjson from "superjson";
import { apiFetch } from "./apiFetch";
import { jsonHeaders, parseResponse } from "./parse";
import type { TaskFocusSummary } from "../types";

export async function getFocusSummary(
  params: { since: Date },
  init?: RequestInit,
): Promise<{ todaySeconds: number; tasks: TaskFocusSummary[] }> {
  const since = encodeURIComponent(params.since.toISOString());
  const result = await apiFetch(`/_api/focus/summary?since=${since}`, { method: "GET", ...init });
  return parseResponse(result);
}

export async function postFocusRecord(
  body: {
    taskId: string;
    plannedMinutes: number;
    focusedSeconds: number;
    firstStep: string;
    outcome: "finished" | "progress" | "stuck";
    leftOff: string;
    startedAt: Date;
  },
  init?: RequestInit,
): Promise<{ recorded: true; id: string }> {
  const result = await apiFetch("/_api/focus/record", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postTaskFirstSteps(
  body: { taskId: string },
  init?: RequestInit,
): Promise<{ steps: string[] }> {
  const result = await apiFetch("/_api/tasks/first_steps", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}
