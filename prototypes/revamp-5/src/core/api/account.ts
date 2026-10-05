import superjson from "superjson";
import { apiFetch } from "./apiFetch";
import { jsonHeaders, parseResponse } from "./parse";
import type { EntityType, NoteRecord, ProjectRecord, TaskRecord } from "../types";

export async function getPreferences(
  init?: RequestInit,
): Promise<{ usePersonalization: boolean }> {
  const result = await apiFetch("/_api/preferences", { method: "GET", ...init });
  return parseResponse(result);
}

export async function postPreferences(
  body: { usePersonalization: boolean },
  init?: RequestInit,
): Promise<{ usePersonalization: boolean }> {
  const result = await apiFetch("/_api/preferences", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postClearPersonalization(
  init?: RequestInit,
): Promise<{ cleared: true }> {
  const result = await apiFetch("/_api/account/clear_personalization", {
    method: "POST",
    body: superjson.stringify({}),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export type AccountExport = {
  exportedAt: Date;
  notes: NoteRecord[];
  entities: { noteId: string; type: EntityType; name: string; aliases: string[] }[];
  projects: ProjectRecord[];
  tasks: TaskRecord[];
};

export async function getAccountExport(init?: RequestInit): Promise<AccountExport> {
  const result = await apiFetch("/_api/account/export", { method: "GET", ...init });
  return parseResponse(result);
}

export async function postAccountDelete(init?: RequestInit): Promise<{ deleted: true }> {
  const result = await apiFetch("/_api/account/delete", {
    method: "POST",
    body: superjson.stringify({ confirm: true }),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}
