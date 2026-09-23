import superjson from "superjson";
import { apiFetch } from "./apiFetch";
import { jsonHeaders, parseResponse } from "./parse";
import type { ProjectRecord, SuggestedTask, TaskRecord, TaskStatus } from "../types";
import { dueDayAtLocalNoon, localIsoDay } from "../lib/dates";

export async function getTasksList(
  params: { noteId?: string } = {},
  init?: RequestInit,
): Promise<{
  tasks: TaskRecord[];
  projects: ProjectRecord[];
  extraction: { hasExtracted: boolean; needsRefresh: boolean } | null;
}> {
  const search = new URLSearchParams();
  if (params.noteId) search.set("noteId", params.noteId);
  const query = search.toString();
  const result = await apiFetch(`/_api/tasks/list${query ? `?${query}` : ""}`, {
    method: "GET",
    ...init,
  });
  return parseResponse(result);
}

export async function postTaskCreate(
  body: {
    text: string;
    projectId?: string;
    projectName?: string;
    completeBy?: Date | null;
    status?: TaskStatus;
    noteId?: string | null;
  },
  init?: RequestInit,
): Promise<{ task: TaskRecord }> {
  const result = await apiFetch("/_api/tasks/create", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postTaskUpdate(
  body: {
    id: string;
    text?: string;
    projectId?: string;
    completeBy?: Date | null;
    status?: TaskStatus;
  },
  init?: RequestInit,
): Promise<{ task: TaskRecord }> {
  const result = await apiFetch("/_api/tasks/update", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postTaskDelete(
  body: { id: string },
  init?: RequestInit,
): Promise<{ deleted: true }> {
  const result = await apiFetch("/_api/tasks/delete", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postTasksExtract(
  body: { noteId: string },
  init?: RequestInit,
): Promise<{ suggested: SuggestedTask[]; unchanged: boolean }> {
  const result = await apiFetch("/_api/tasks/extract", {
    method: "POST",
    // The phone's own date, so "Friday" in a note means this writer's Friday.
    body: superjson.stringify({ ...body, currentDate: localIsoDay(new Date()) }),
    ...init,
    headers: jsonHeaders(init),
  });
  const output = await parseResponse<{ suggested: SuggestedTask[]; unchanged: boolean }>(result);
  return {
    ...output,
    suggested: output.suggested.map((item) => ({
      ...item,
      completeBy: item.completeBy ? dueDayAtLocalNoon(item.completeBy) : null,
    })),
  };
}

export async function postTaskParse(
  body: { text: string; currentDate: string },
  init?: RequestInit,
): Promise<{ text: string; completeBy: string | null; datePhrase: string | null }> {
  const result = await apiFetch("/_api/tasks/parse", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postTasksAdd(
  body: {
    noteId: string;
    tasks: { text: string; projectName: string; completeBy?: Date | null }[];
  },
  init?: RequestInit,
): Promise<{ added: number; tasks: TaskRecord[] }> {
  const result = await apiFetch("/_api/tasks/add", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postTasksClearDone(
  body: { projectId?: string } = {},
  init?: RequestInit,
): Promise<{ cleared: number }> {
  const result = await apiFetch("/_api/tasks/clear_done", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postProjectCreate(
  body: { name: string },
  init?: RequestInit,
): Promise<{ project: ProjectRecord }> {
  const result = await apiFetch("/_api/projects/create", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postProjectUpdate(
  body: { id: string; name: string },
  init?: RequestInit,
): Promise<{ project: ProjectRecord }> {
  const result = await apiFetch("/_api/projects/update", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postProjectDelete(
  body: { id: string; moveTasksTo?: string },
  init?: RequestInit,
): Promise<{ deleted: true; movedTasks: number; removedTasks: number }> {
  const result = await apiFetch("/_api/projects/delete", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}
